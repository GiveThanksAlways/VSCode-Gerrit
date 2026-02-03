import {
	AddToBatchMessage,
	BatchReviewWebviewMessage,
	GetFilesForChangeMessage,
	GetPeopleMessage,
	OpenChangeOnlineMessage,
	OpenFileDiffMessage,
	RemoveFromBatchMessage,
	ReorderChangesMessage,
	SetFileViewModeMessage,
	SubmitBatchVoteMessage,
} from './batchReview/messaging';
import {
	commands as vscodeCommands,
	Disposable,
	env,
	ExtensionContext,
	Uri,
	ViewColumn,
	window,
} from 'vscode';
import {
	BatchReviewChange,
	BatchReviewFileInfo,
	TypedWebviewPanel,
	SeverityLevel,
} from './batchReview/types';
import {
	createBatchReviewApiServer,
	BatchReviewApiServer,
	ScoreMap,
} from '../../lib/batchReviewApi/server';
import {
	getOrderedBatch,
	isChangeChained,
	ChainInfoResult,
} from './batchReview/chainUtils';
import {
	DefaultChangeFilter,
	GerritChangeFilter,
} from '../../lib/gerrit/gerritAPI/filters';
import { FileTreeView } from '../activityBar/changes/changeTreeView/fileTreeView';
import { GerritRevisionFileStatus } from '../../lib/gerrit/gerritAPI/types';
import { BatchReviewState, BatchReviewPerson } from './batchReview/state';
import { GerritChange } from '../../lib/gerrit/gerritAPI/gerritChange';
import { GerritGroup } from '../../lib/gerrit/gerritAPI/gerritGroup';
import { GerritUser } from '../../lib/gerrit/gerritAPI/gerritUser';
import { GerritAPIWith } from '../../lib/gerrit/gerritAPI/api';
import { Repository } from '../../types/vscode-extension-git';
import { getAPI } from '../../lib/gerrit/gerritAPI';
import { getHTML } from './batchReview/html';

class BatchReviewProvider implements Disposable {
	private _panel: TypedWebviewPanel<BatchReviewWebviewMessage> | null = null;
	private readonly _disposables: Disposable[] = [];
	private _state: BatchReviewState = {
		incomingChanges: [],
		batchChanges: [],
		loading: false,
		fileViewMode: 'tree',
	};
	private _apiServer: BatchReviewApiServer | null = null;
	// Cache chain info to avoid repeated API calls
	private _chainInfoCache: Map<string, ChainInfoResult> = new Map();

	private constructor(
		private readonly _gerritRepo: Repository,
		private readonly _context: ExtensionContext
	) {}

	public static async create(
		gerritRepo: Repository,
		context: ExtensionContext
	): Promise<BatchReviewProvider> {
		const provider = new this(gerritRepo, context);
		// Immediately load Incoming Reviews on creation
		await provider._handleGetIncomingReviews();
		return provider;
	}

	private async _getYourTurnChanges(): Promise<BatchReviewChange[]> {
		// Query changes matching "Your Turn" criteria
		const filters: (DefaultChangeFilter | GerritChangeFilter)[] = [
			DefaultChangeFilter.IS_OPEN,
			DefaultChangeFilter.REVIEWER_SELF,
			DefaultChangeFilter.ATTENTION_SELF,
		];

		const subscription = await GerritChange.getChanges(
			[filters],
			{ offset: 0, count: 100 },
			undefined,
			GerritAPIWith.DETAILED_ACCOUNTS
		);

		if (!subscription) {
			return [];
		}

		const changes = await subscription.getValue();
		if (!changes) {
			return [];
		}

		const api = await getAPI();
		return Promise.all(
			changes.map(async (change) => {
				const ownerName: string =
					'name' in change.owner
						? (change.owner.name as string)
						: `Account ${change.owner._account_id}`;
				let gerritUrl: string | undefined = undefined;
				if (api && change.project && change.number) {
					gerritUrl =
						api.getPublicUrl(
							`c/${change.project}/+/${change.number}`
						) || undefined;
				}
				// Check if change has Code-Review +2
				const hasCodeReviewPlus2 = this._hasCodeReviewPlus2(change);

				return {
					changeId: change.change_id, // Gerrit Change-Id (Ixxxx...)
					changeID: `${change.project}~${change.branch}~${change.change_id}`,
					number: change.number,
					subject: change.subject,
					project: change.project,
					branch: change.branch,
					owner: {
						name: ownerName,
						accountID: change.owner._account_id,
					},
					updated: change.updated,
					submittable: (change as any).submittable ?? false,
					hasCodeReviewPlus2,
					gerritUrl,
				} as BatchReviewChange;
			})
		);
	}

	/**
	 * Get "Incoming Reviews" - all open changes where you are a reviewer but not the owner.
	 * Unlike "Your Turn", these stay visible until reviewed AND submitted.
	 */
	private async _getIncomingReviews(): Promise<BatchReviewChange[]> {
		// Query: is:open reviewer:self -owner:self (open changes where I'm reviewer but not owner)
		const filters: (DefaultChangeFilter | GerritChangeFilter)[] = [
			DefaultChangeFilter.IS_OPEN,
			DefaultChangeFilter.REVIEWER_SELF,
			'-owner:self' as GerritChangeFilter,
		];

		// Only pass defined options to avoid &o=undefined in the query
		const options: GerritAPIWith[] = [
			GerritAPIWith.DETAILED_ACCOUNTS,
			GerritAPIWith.DETAILED_LABELS,
		];
		if ((GerritAPIWith as any).SUBMITTABLE as GerritAPIWith) {
			options.push((GerritAPIWith as any).SUBMITTABLE as GerritAPIWith);
		}
		let subscription;
		if (options.length > 0) {
			subscription = await GerritChange.getChanges.apply(GerritChange, [
				[filters],
				{ offset: 0, count: 100 },
				undefined,
				...options,
			]);
		} else {
			subscription = await GerritChange.getChanges(
				[filters],
				{ offset: 0, count: 100 },
				undefined
			);
		}

		if (!subscription) {
			return [];
		}

		const changes = await subscription.getValue();
		if (!changes) {
			return [];
		}

		const api = await getAPI();
		return Promise.all(
			changes.map(async (change) => {
				const ownerName: string =
					'name' in change.owner
						? (change.owner.name as string)
						: `Account ${change.owner._account_id}`;

				// Check if change has Code-Review +2
				const hasCodeReviewPlus2 = this._hasCodeReviewPlus2(change);

				let gerritUrl: string | undefined = undefined;
				if (api && change.project && change.number) {
					gerritUrl =
						api.getPublicUrl(
							`c/${change.project}/+/${change.number}`
						) || undefined;
				}

				return {
					changeId: change.change_id, // Gerrit Change-Id (Ixxxx...)
					changeID: `${change.project}~${change.branch}~${change.change_id}`, // REST id (project~branch~Ixxxx)
					number: change.number,
					subject: change.subject,
					project: change.project,
					branch: change.branch,
					owner: {
						name: ownerName,
						accountID: change.owner._account_id,
					},
					updated: change.updated,
					submittable: (change as any).submittable ?? false,
					hasCodeReviewPlus2,
					gerritUrl,
				} as BatchReviewChange;
			})
		);
	}

	/**
	 * Check if a change has Code-Review +2.
	 */
	private _hasCodeReviewPlus2(change: GerritChange): boolean {
		if (!change.labels) {
			return false;
		}
		const codeReviewLabel =
			(change.labels && (change.labels as any)['Code-Review']) ||
			undefined;
		if (!codeReviewLabel) {
			return false;
		}
		// Check if there's an approved value or all.value includes +2
		if ((codeReviewLabel as any).approved) {
			return true;
		}
		// Check all votes for +2
		if ((codeReviewLabel as any).all) {
			return (codeReviewLabel as any).all.some(
				(vote: any) => vote.value === 2
			);
		}
		return false;
	}

	private async _handleGetIncomingReviews(): Promise<void> {
		if (!this._panel) {
			return;
		}

		this._state.loading = true;
		await this._updateView();

		const changes = await this._getIncomingReviews();

		// Filter out changes that are already in the batch to avoid duplicates
		const batchChangeIDs = new Set(
			this._state.batchChanges.map((c) => c.changeID)
		);
		this._state.incomingChanges = changes.filter(
			(change) => !batchChangeIDs.has(change.changeID)
		);

		this._state.loading = false;
		await this._updateView();
	}

	private async _handleGetYourTurnChanges(): Promise<void> {
		if (!this._panel) {
			return;
		}

		this._state.loading = true;
		await this._updateView();

		const changes = await this._getYourTurnChanges();

		// Filter out changes that are already in the batch to avoid duplicates
		const batchChangeIDs = new Set(
			this._state.batchChanges.map((c) => c.changeID)
		);
		this._state.incomingChanges = changes.filter(
			(change) => !batchChangeIDs.has(change.changeID)
		);

		this._state.loading = false;
		await this._updateView();
	}

	private async _handleAddToBatch(
		msg: AddToBatchMessage,
		scores?: ScoreMap
	): Promise<void> {
		console.log('[BatchReview] _handleAddToBatch called with:', {
			changeIDs: msg.body.changeIDs,
			scores,
		});

		// Find the actual BatchReviewChange objects in incomingChanges
		const changesToAdd = this._state.incomingChanges.filter((change) =>
			msg.body.changeIDs.includes(change.changeID)
		);

		console.log(
			'[BatchReview] Changes to add:',
			changesToAdd.map((c) => ({
				changeID: c.changeID,
				severity: c.severity,
			}))
		);

		// Remove from incomingChanges
		this._state.incomingChanges = this._state.incomingChanges.filter(
			(change) => !msg.body.changeIDs.includes(change.changeID)
		);

		console.log(
			'[BatchReview] incomingChanges after removal:',
			this._state.incomingChanges.map((c) => c.changeID)
		);

		// Prepare changes to insert (avoid duplicates, apply severities)
		const newChanges: BatchReviewChange[] = [];
		for (const change of changesToAdd) {
			if (
				!this._state.batchChanges.some(
					(c) => c.changeID === change.changeID
				)
			) {
				// Apply severity if provided from API
				if (scores && scores[change.changeID] !== undefined) {
					console.log(
						`[BatchReview] Setting severity for ${change.changeID}:`,
						scores[change.changeID]
					);
					change.severity = scores[change.changeID];
				} else {
					// If no severity provided, keep existing or leave undefined
					change.severity = change.severity ?? undefined;
				}
				newChanges.push(change);
			} else {
				console.log(
					`[BatchReview] Skipping duplicate in batch: ${change.changeID}`
				);
			}
		}

		// Insert at dropIndex if provided, otherwise append
		if (
			msg.body.dropIndex !== undefined &&
			msg.body.dropIndex >= 0 &&
			newChanges.length > 0
		) {
			const insertAt = Math.min(
				msg.body.dropIndex,
				this._state.batchChanges.length
			);
			console.log(`[BatchReview] Inserting at index ${insertAt}`);
			this._state.batchChanges.splice(insertAt, 0, ...newChanges);
		} else {
			this._state.batchChanges.push(...newChanges);
		}

		// Log state after processing
		console.log('[BatchReview] State after add:', {
			incoming: this._state.incomingChanges.map((c) => c.changeID),
			batch: this._state.batchChanges.map((c) => ({
				changeID: c.changeID,
				severity: c.severity,
			})),
		});

		// Fetch labels if this is the first item added to batch
		if (newChanges.length > 0 && !this._state.labels) {
			await this._fetchLabels();
		}

		// Update view immediately (don't wait for chain ordering)
		await this._updateView();

		// Then organize chains in background (async, don't block)
		this._organizeChainGroupsAsync();
	}

	/**
	 * Get chain info for a change, using cache when available.
	 * This avoids repeated API calls for the same change.
	 */
	private async _getCachedChainInfo(
		changeId: string
	): Promise<ChainInfoResult> {
		// Check cache first
		const cached = this._chainInfoCache.get(changeId);
		if (cached) {
			return cached;
		}

		// Fetch and cache
		const info = await isChangeChained(changeId);
		this._chainInfoCache.set(changeId, info);
		return info;
	}

	/**
	 * Reorganize batch changes to group chain items together in proper order.
	 * This runs asynchronously in the background and updates the view when done.
	 * Chain items are grouped by their chain base and ordered by position.
	 */
	private async _organizeChainGroupsAsync(): Promise<void> {
		console.log('[BatchReview] Starting async chain organization...');

		// Fetch chain info for all batch items (using cache)
		const chainInfos = new Map<
			string,
			{ position: number; chainBase: string }
		>();

		// Process in parallel to speed up
		const promises = this._state.batchChanges.map(async (change) => {
			const chainInfo = await this._getCachedChainInfo(change.changeId);
			if (chainInfo.inChain && chainInfo.chainBaseChangeId) {
				return {
					changeID: change.changeID,
					position: chainInfo.position ?? 999,
					chainBase: chainInfo.chainBaseChangeId,
				};
			}
			return null;
		});

		const results = await Promise.all(promises);
		for (const result of results) {
			if (result) {
				chainInfos.set(result.changeID, {
					position: result.position,
					chainBase: result.chainBase,
				});
			}
		}

		// Group by chain base
		const chainGroups = new Map<
			string,
			{ change: BatchReviewChange; position: number }[]
		>();
		const standaloneChanges: BatchReviewChange[] = [];

		for (const change of this._state.batchChanges) {
			const info = chainInfos.get(change.changeID);
			if (info) {
				const group = chainGroups.get(info.chainBase) ?? [];
				group.push({ change, position: info.position });
				chainGroups.set(info.chainBase, group);
			} else {
				standaloneChanges.push(change);
			}
		}

		// Severity priority order: CRITICAL (highest) > HIGH > MEDIUM > LOW > APPROVED (lowest)
		const severityPriority = (
			severity: SeverityLevel | undefined
		): number => {
			switch (severity) {
				case 'CRITICAL':
					return 5;
				case 'HIGH':
					return 4;
				case 'MEDIUM':
					return 3;
				case 'LOW':
					return 2;
				case 'APPROVED':
					return 1;
				default:
					return 0; // No severity = lowest priority
			}
		};

		// Sort standalone by severity (highest priority first)
		standaloneChanges.sort(
			(a, b) =>
				severityPriority(b.severity) - severityPriority(a.severity)
		);

		// Sort each chain by position (base first = position 1)
		const chainArrays: BatchReviewChange[][] = [];
		for (const [, group] of chainGroups) {
			group.sort((a, b) => a.position - b.position);
			chainArrays.push(group.map((g) => g.change));
		}

		// Sort chain groups by the highest severity within each chain (to prioritize)
		chainArrays.sort((a, b) => {
			const maxPriorityA = Math.max(
				...a.map((c) => severityPriority(c.severity))
			);
			const maxPriorityB = Math.max(
				...b.map((c) => severityPriority(c.severity))
			);
			return maxPriorityB - maxPriorityA;
		});

		// Combine: standalone first, then chains in order
		const newOrder = [...standaloneChanges, ...chainArrays.flat()];

		// Only update if order actually changed
		const orderChanged = newOrder.some(
			(c, i) => this._state.batchChanges[i]?.changeID !== c.changeID
		);

		if (orderChanged) {
			console.log(
				'[BatchReview] Chain organization complete, updating view'
			);
			this._state.batchChanges = newOrder;
			await this._updateView();
		} else {
			console.log(
				'[BatchReview] Chain organization complete, no changes needed'
			);
		}
	}

	private async _handleRemoveFromBatch(
		msg: RemoveFromBatchMessage
	): Promise<void> {
		console.log(
			'[BatchReview] incomingChanges IDs:',
			this._state.incomingChanges.map((c) => c.changeID)
		);
		console.log('[BatchReview] msg.body.changeIDs:', msg.body.changeIDs);

		const changesToRemove = this._state.batchChanges.filter((change) =>
			msg.body.changeIDs.includes(change.changeID)
		);

		// Remove from batch
		this._state.batchChanges = this._state.batchChanges.filter(
			(change) => !msg.body.changeIDs.includes(change.changeID)
		);

		// Filter out duplicates before adding back to yourTurn
		const newChanges = changesToRemove.filter(
			(change) =>
				!this._state.incomingChanges.some(
					(c) => c.changeID === change.changeID
				)
		);

		// Insert at dropIndex if provided, otherwise append
		if (
			msg.body.dropIndex !== undefined &&
			msg.body.dropIndex >= 0 &&
			newChanges.length > 0
		) {
			const insertAt = Math.min(
				msg.body.dropIndex,
				this._state.incomingChanges.length
			);
			this._state.incomingChanges.splice(insertAt, 0, ...newChanges);
		} else {
			this._state.incomingChanges.push(...newChanges);
		}

		// Clear the hasCodeReviewPlus2 flag - the green checkmark should only show in batch view
		for (const change of changesToRemove) {
			change.hasCodeReviewPlus2 = false;
		}

		await this._updateView();
	}

	private async _handleClearBatch(): Promise<void> {
		// Move all batch changes back to yourTurn
		for (const change of this._state.batchChanges) {
			if (
				!this._state.incomingChanges.some(
					(c) => c.changeID === change.changeID
				)
			) {
				this._state.incomingChanges.push(change);
			}
			// Clear the hasCodeReviewPlus2 flag - the green checkmark should only show in batch view
			change.hasCodeReviewPlus2 = false;
		}
		this._state.batchChanges = [];
		await this._updateView();
	}

	/**
	 * Apply Code-Review +2 to all changes in the batch, in dependency order, but do NOT submit.
	 * Used for the dedicated +2 button.
	 */
	private async _handlePlus2All(): Promise<void> {
		if (!this._panel) {
			return;
		}
		const api = await getAPI();
		if (!api) {
			void window.showErrorMessage('Gerrit API not available.');
			return;
		}
		if (this._state.batchChanges.length === 0) {
			void window.showInformationMessage('No changes in batch to +2.');
			return;
		}
		// Map REST IDs to Gerrit Change-Ids (camelCase)
		const batchChangeIDToChangeId = Object.fromEntries(
			this._state.batchChanges.map((c) => [c.changeID, c.changeId])
		);
		const changeIdToBatchChangeID = Object.fromEntries(
			this._state.batchChanges.map((c) => [c.changeId, c.changeID])
		);
		const batchChangeIds = this._state.batchChanges.map((c) => c.changeId);
		// Order by Gerrit Change-Id (camelCase)
		const orderedChangeIds = await getOrderedBatch(batchChangeIds);
		// Map back to REST IDs
		const orderedIDs = orderedChangeIds
			.map((id) => changeIdToBatchChangeID[id])
			.filter(Boolean);
		const orderedChanges = orderedIDs
			.map((id) =>
				this._state.batchChanges.find((c) => c.changeID === id)
			)
			.filter(Boolean);
		let plus2Success = 0;
		let plus2Fail = 0;
		const errors: string[] = [];
		for (const change of orderedChanges) {
			const changeObj = await GerritChange.getChangeOnce(
				change!.changeID
			);
			if (!changeObj) {
				plus2Fail++;
				errors.push(`Change ${change!.number}: Not found`);
				continue;
			}
			const currentRevision = await changeObj.currentRevision();
			if (!currentRevision) {
				plus2Fail++;
				errors.push(`Change ${change!.number}: No current revision`);
				continue;
			}
			const result = await api.setLabelsOnly(
				change!.changeID,
				currentRevision.id,
				{ 'Code-Review': 2 }
			);
			if (result.success) {
				plus2Success++;
				change!.hasCodeReviewPlus2 = true;
			} else {
				plus2Fail++;
				errors.push(
					`Change ${change!.number}: ${result.error || 'Unknown error'}`
				);
			}
		}
		await this._updateView();
		if (plus2Fail > 0) {
			void window.showErrorMessage(
				`+2 failed for ${plus2Fail} change(s):\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`
			);
		} else {
			void window.showInformationMessage(
				`Successfully +2’d ${plus2Success} change(s).`
			);
		}
	}

	private async _handleSubmitBatchVote(
		msg: SubmitBatchVoteMessage
	): Promise<void> {
		if (!this._panel) {
			return;
		}

		// CRITICAL: This is human-only submission
		// Verify this is a real user action, not programmatic
		const api = await getAPI();
		if (!api) {
			await this._panel.webview.postMessage({
				type: 'batchVoteFailed',
			});
			return;
		}

		let successCount = 0;
		let failureCount = 0;
		const errors: string[] = [];

		// Submit vote for each change in batch
		for (const change of this._state.batchChanges) {
			const changeObj = await GerritChange.getChangeOnce(change.changeID);
			if (!changeObj) {
				failureCount++;
				errors.push(`Change ${change.number}: Could not fetch change`);
				continue;
			}

			const currentRevision = await changeObj.currentRevision();
			if (!currentRevision) {
				failureCount++;
				errors.push(
					`Change ${change.number}: Could not get current revision`
				);
				continue;
			}

			// Use the enhanced method with detailed error reporting
			const result = await api.setReviewWithDetails(
				change.changeID,
				currentRevision.id,
				{
					labels: msg.body.labels,
					message: msg.body.message || undefined,
					resolved: msg.body.resolved,
					publishDrafts: false,
					reviewers: msg.body.reviewers ?? [],
					cc: msg.body.cc ?? [],
				}
			);

			if (result.success) {
				successCount++;
			} else {
				failureCount++;
				errors.push(`Change ${change.number}: ${result.error}`);
			}
		}

		// Clear batch after submission
		this._state.batchChanges = [];
		await this._updateView();

		// Show detailed error message if there were failures
		if (errors.length > 0) {
			void window.showErrorMessage(
				`Failed to +2 some changes:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`
			);
		} else {
			void window.showInformationMessage(
				`Successfully +2'd ${successCount} change(s)`
			);
		}
	}

	/**
	 * Apply Code-Review +2 to all changes, then submit all that are submittable.
	 */
	private async _handlePlus2AllAndSubmit(): Promise<void> {
		console.log('[BatchReview] +2 & Submit combo button triggered');
		if (!this._panel) {
			return;
		}

		const api = await getAPI();
		if (!api) {
			void window.showErrorMessage('Gerrit API not available');
			return;
		}
		if (this._state.batchChanges.length === 0) {
			void window.showInformationMessage('No changes in batch');
			return;
		}

		// Step 1: +2 all changes in dependency order
		let plus2Success = 0;
		let plus2Fail = 0;
		// Map REST IDs to Gerrit Change-Ids (camelCase)
		const batchChangeIDToChangeId = Object.fromEntries(
			this._state.batchChanges.map((c) => [c.changeID, c.changeId])
		);
		const changeIdToBatchChangeID = Object.fromEntries(
			this._state.batchChanges.map((c) => [c.changeId, c.changeID])
		);
		const batchChangeIDs = this._state.batchChanges.map((c) => c.changeID);
		const batchChangeIds = this._state.batchChanges.map((c) => c.changeId);
		console.log('[BatchReview] Batch changeIDs:', batchChangeIDs);
		console.log('[BatchReview] Batch changeIds:', batchChangeIds);
		// Order by Gerrit Change-Id (camelCase)
		const orderedChangeIds = await getOrderedBatch(batchChangeIds);
		console.log(
			'[BatchReview] getOrderedBatch returned:',
			orderedChangeIds
		);
		// Map back to REST IDs
		const orderedIDs = orderedChangeIds
			.map((id) => changeIdToBatchChangeID[id])
			.filter(Boolean);
		const orderedChanges = orderedIDs
			.map((id) => {
				const found = this._state.batchChanges.find(
					(c) => c.changeID === id
				);
				if (!found) {
					console.warn(
						'[BatchReview] No batch change found for ordered id:',
						id
					);
				}
				return found;
			})
			.filter(Boolean);
		console.log(
			'[BatchReview] Applying +2 to all batch changes (ordered):',
			orderedIDs,
			'orderedChanges:',
			orderedChanges.map((c) => c?.changeID)
		);
		for (const change of orderedChanges) {
			const changeObj = await GerritChange.getChangeOnce(
				change!.changeID
			);
			if (!changeObj) {
				plus2Fail++;
				continue;
			}
			const currentRevision = await changeObj.currentRevision();
			if (!currentRevision) {
				plus2Fail++;
				continue;
			}
			const result = await api.setLabelsOnly(
				change!.changeID,
				currentRevision.id,
				{ 'Code-Review': 2 }
			);
			if (result.success) {
				plus2Success++;
				change!.hasCodeReviewPlus2 = true;
			} else {
				plus2Fail++;
			}
		}
		// Step 2: Submit all changes in the batch (ordered)
		let submitSuccess = 0;
		let submitFail = 0;
		const submitErrors: string[] = [];
		console.log(
			'[BatchReview] Submitting all batch changes (ordered):',
			orderedIDs
		);
		for (const change of orderedChanges) {
			try {
				// Optionally, re-fetch to ensure submittable
				const changeObj = await GerritChange.getChangeOnce(
					change!.changeID
				);
				if (!changeObj) {
					submitFail++;
					submitErrors.push(`Change not found: ${change!.changeID}`);
					continue;
				}
				if (!(changeObj as any).submittable) {
					submitFail++;
					// Log requirements and label status for debugging
					const requirements = (changeObj as any).requirements || [];
					const labels = (changeObj as any).labels || {};
					console.warn(
						`[BatchReview] Not submittable: ${change!.changeID}`
					);
					console.warn(`[BatchReview] Requirements:`, requirements);
					console.warn(`[BatchReview] Labels:`, labels);
					{
						// Try to build a Gerrit URL if possible
						let url = '';
						try {
							const api = await getAPI();
							if (api && change!.project && change!.number) {
								url =
									api.getPublicUrl(
										`c/${change!.project}/+/${change!.number}`
									) || '';
							}
						} catch {}
						const changeLine = `#${change!.number}  ${change!.subject}`;
						const urlLine = url ? `\n[View in Gerrit](${url})` : '';
						const msg =
							`${changeLine}${urlLine}` +
							`\n\nThis change is not submittable. This may be due to relation chain dependencies.` +
							(requirements.length > 0
								? `\n\nRequirements:\n${requirements.map((r: any) => `- ${r.status}: ${r.fallback_text}`).join('\n')}`
								: '');
						void window.showWarningMessage(msg, { modal: false });
					}
					continue;
				}
				const result = await api.submitWithDetails(change!.changeID);
				if (result && result.success) {
					submitSuccess++;
					console.log(
						`[BatchReview] Submitted change: ${change!.changeID}`
					);
				} else {
					submitFail++;
					const errMsg =
						result && result.error ? result.error : 'Unknown error';
					submitErrors.push(
						`Failed to submit ${change!.changeID}: ${errMsg}`
					);
					console.warn(
						`[BatchReview] Failed to submit change: ${change!.changeID}`,
						result
					);
				}
			} catch (err: any) {
				submitFail++;
				submitErrors.push(
					`Exception for ${change!.changeID}: ${err?.message || err}`
				);
				console.error(
					`[BatchReview] Exception submitting change: ${change!.changeID}`,
					err
				);
			}
		}
		// Clear batch after submission (for UX, same as _handleSubmitBatch)
		this._state.batchChanges = [];
		await this._updateView();

		// Show summary
		const messages: string[] = [];
		if (plus2Success > 0) {
			messages.push(`+2'd ${plus2Success} change(s)`);
		}
		if (submitSuccess > 0) {
			messages.push(`Submitted ${submitSuccess} change(s)`);
		}
		if (submitFail > 0) {
			messages.push(`${submitFail} submit failure(s)`);
		}

		if (submitErrors.length > 0) {
			void window.showErrorMessage(
				`Failed to submit ${submitFail} change(s):\n${submitErrors.slice(0, 5).join('\n')}${submitErrors.length > 5 ? `\n...and ${submitErrors.length - 5} more` : ''}`
			);
		} else if (messages.length > 0) {
			void window.showInformationMessage(messages.join(', '));
		}
	}

	/**
	 * Refresh the submittable status for all changes in batch.
	 */
	private async _refreshBatchStatus(): Promise<void> {
		for (const change of this._state.batchChanges) {
			const changeObj = await GerritChange.getChangeOnce(
				change.changeID,
				[GerritAPIWith.SUBMITTABLE, GerritAPIWith.DETAILED_LABELS]
			);
			if (changeObj) {
				(change as any).submittable =
					(changeObj as any).submittable ?? false;
				(change as any).hasCodeReviewPlus2 =
					this._hasCodeReviewPlus2(changeObj);
			}
		}
	}

	private _userOrGroupToPeople(
		value: (GerritUser | GerritGroup)[]
	): BatchReviewPerson[] {
		return value
			.map((person) => ({
				id: person instanceof GerritUser ? person.accountID : person.id,
				name:
					person instanceof GerritUser
						? person.getName(true)
						: person.name,
				shortName: person.shortName(),
			}))
			.filter((p) => !!p.id) as BatchReviewPerson[];
	}

	private async _handleGetPeople(msg: GetPeopleMessage): Promise<void> {
		const api = await getAPI();
		if (!api) {
			return;
		}

		// Use the first batch change to get suggestions, or fall back to empty
		const firstChange = this._state.batchChanges[0];
		if (!firstChange) {
			return;
		}

		const fn = msg.body.isCC
			? api.suggestCC.bind(api)
			: api.suggestReviewers.bind(api);
		const people = await fn(firstChange.changeID, msg.body.query);

		if (msg.body.isCC) {
			this._state.suggestedCC = this._userOrGroupToPeople(people);
		} else {
			this._state.suggestedReviewers = this._userOrGroupToPeople(people);
		}

		await this._updateView();
	}

	private async _handleSubmitBatch(): Promise<void> {
		if (!this._panel) {
			return;
		}

		const api = await getAPI();
		if (!api) {
			await this._panel.webview.postMessage({
				type: 'batchVoteFailed',
			});
			return;
		}

		let successCount = 0;
		let failureCount = 0;
		const errors: string[] = [];

		// Map REST IDs to Gerrit Change-Ids (camelCase)
		const batchChangeIDToChangeId = Object.fromEntries(
			this._state.batchChanges.map((c) => [c.changeID, c.changeId])
		);
		const changeIdToBatchChangeID = Object.fromEntries(
			this._state.batchChanges.map((c) => [c.changeId, c.changeID])
		);
		const batchChangeIds = this._state.batchChanges.map((c) => c.changeId);
		// Order by Gerrit Change-Id (camelCase)
		const orderedChangeIds = await getOrderedBatch(batchChangeIds);
		// Map back to REST IDs
		const orderedIDs = orderedChangeIds
			.map((id) => changeIdToBatchChangeID[id])
			.filter(Boolean);
		const orderedChanges = orderedIDs
			.map((id) =>
				this._state.batchChanges.find((c) => c.changeID === id)
			)
			.filter(Boolean);

		for (const change of orderedChanges) {
			// Use the enhanced method with detailed error reporting
			const result = await api.submitWithDetails(change!.changeID);
			if (result.success) {
				successCount++;
			} else {
				failureCount++;
				errors.push(`Change ${change!.number}: ${result.error}`);
			}
		}

		// Clear batch after submission (only successful ones are merged, but clear all for UX)
		this._state.batchChanges = [];
		await this._updateView();

		// Show detailed error message if there were failures
		if (errors.length > 0) {
			void window.showErrorMessage(
				`Failed to submit ${failureCount} change(s):\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`
			);
		}

		await this._panel.webview.postMessage({
			type: 'batchVoteSuccess',
			body: {
				successCount,
				failureCount,
			},
		});
	}

	private async _fetchLabels(): Promise<void> {
		const api = await getAPI();
		if (!api) {
			return;
		}

		// Use the first batch change to get label info
		const firstChange = this._state.batchChanges[0];
		if (!firstChange) {
			// Provide default Code-Review label
			this._state.labels = [
				{
					name: 'Code-Review',
					possibleValues: [
						{
							score: '-2',
							description: 'This shall not be merged',
						},
						{
							score: '-1',
							description:
								'I would prefer this is not merged as is',
						},
						{ score: ' 0', description: 'No score' },
						{
							score: '+1',
							description:
								'Looks good to me, but someone else must approve',
						},
						{
							score: '+2',
							description: 'Looks good to me, approved',
						},
					],
				},
			];
			return;
		}

		const detail = await api.getChangeDetail(firstChange.changeID);
		if (!detail) {
			return;
		}

		this._state.labels = Object.entries(detail.labels)
			.filter(([name]) => detail.permittedLabels[name])
			.map(([name, value]) => ({
				name,
				possibleValues: Object.entries(value.values)
					.filter(([k]) => detail.permittedLabels[name].includes(k))
					.map(([k, v]) => ({
						score: k,
						description: v,
					})),
			}));
	}

	private async _handleGetFilesForChange(
		msg: GetFilesForChangeMessage
	): Promise<void> {
		const changeID = msg.body.changeID;

		// Find the index of change in either yourTurn or batch
		let changeIndex = this._state.incomingChanges.findIndex(
			(c) => c.changeID === changeID
		);
		let changeList: 'yourTurn' | 'batch' = 'yourTurn';
		if (changeIndex === -1) {
			changeIndex = this._state.batchChanges.findIndex(
				(c) => c.changeID === changeID
			);
			changeList = 'batch';
		}

		if (changeIndex === -1) {
			return;
		}

		// Fetch files from Gerrit API
		const gerritChange = await GerritChange.getChangeOnce(changeID);
		if (!gerritChange) {
			void window.showErrorMessage(
				`Could not fetch files for change ${changeID}`
			);
			return;
		}

		const currentRevision = await gerritChange.getCurrentRevision();
		if (!currentRevision) {
			void window.showErrorMessage(
				`Could not fetch current revision for change ${changeID}`
			);
			return;
		}

		const filesSubscription = await currentRevision.files(null);
		const filesRecord = await filesSubscription.getValue();

		const files: BatchReviewFileInfo[] = Object.entries(filesRecord).map(
			([filePath, gerritFile]) => ({
				filePath,
				status: this._mapFileStatus(gerritFile.status),
				linesInserted: gerritFile.linesInserted ?? 0,
				linesDeleted: gerritFile.linesDeleted ?? 0,
			})
		);

		// Create a new change object with files info (immutable update)
		if (changeList === 'yourTurn') {
			const existingChange = this._state.incomingChanges[changeIndex];
			const updatedChange = {
				...existingChange,
				files,
				filesLoaded: true,
			};
			this._state.incomingChanges = [
				...this._state.incomingChanges.slice(0, changeIndex),
				updatedChange,
				...this._state.incomingChanges.slice(changeIndex + 1),
			];
		} else {
			const existingChange = this._state.batchChanges[changeIndex];
			const updatedChange = {
				...existingChange,
				files,
				filesLoaded: true,
			};
			this._state.batchChanges = [
				...this._state.batchChanges.slice(0, changeIndex),
				updatedChange,
				...this._state.batchChanges.slice(changeIndex + 1),
			];
		}

		await this._updateView();
	}

	private _mapFileStatus(
		status: GerritRevisionFileStatus | null
	): BatchReviewFileInfo['status'] {
		if (!status) {
			return 'M'; // Default to modified
		}
		switch (status) {
			case GerritRevisionFileStatus.ADDED:
				return 'A';
			case GerritRevisionFileStatus.DELETED:
				return 'D';
			case GerritRevisionFileStatus.RENAMED:
				return 'R';
			default:
				return 'M';
		}
	}

	private async _handleOpenFileDiff(msg: OpenFileDiffMessage): Promise<void> {
		const { changeID, filePath } = msg.body;

		// Get the change from Gerrit
		const gerritChange = await GerritChange.getChangeOnce(changeID);
		if (!gerritChange) {
			void window.showErrorMessage(`Could not find change ${changeID}`);
			return;
		}

		const currentRevision = await gerritChange.getCurrentRevision();
		if (!currentRevision) {
			void window.showErrorMessage(
				`Could not find current revision for ${changeID}`
			);
			return;
		}

		const filesSubscription = await currentRevision.files(null);
		const filesRecord = await filesSubscription.getValue();

		const gerritFile = filesRecord[filePath];
		if (!gerritFile) {
			void window.showErrorMessage(`Could not find file ${filePath}`);
			return;
		}

		// Use FileTreeView.createDiffCommand to create the diff command
		const diffCommand = await FileTreeView.createDiffCommand(
			this._gerritRepo,
			gerritFile,
			null
		);

		if (diffCommand) {
			if (
				Array.isArray(diffCommand.arguments) &&
				diffCommand.arguments.every((arg) => typeof arg !== 'undefined')
			) {
				// Optionally, you can add a more specific type check here if you know the expected argument types
				await vscodeCommands.executeCommand(
					diffCommand.command,
					...(diffCommand.arguments as unknown[])
				);
			} else {
				await vscodeCommands.executeCommand(diffCommand.command);
			}
		}
	}

	private async _handleStartAutomation(): Promise<void> {
		if (!this._panel) {
			return;
		}

		// Create the API server if not already created
		if (!this._apiServer) {
			this._apiServer = createBatchReviewApiServer({
				getBatch: () => this.getBatchChanges(),
				addToBatch: (changeIDs, scores) =>
					this.addToBatch(changeIDs, scores),
				clearBatch: () => {
					void this._handleClearBatch();
				},
			});
		}

		// Start the server if not already running
		if (!this._apiServer.isRunning()) {
			try {
				const port = await this._apiServer.start();
				await this._sendAutomationStatus(true, port);
				// No notification - status indicator in UI is sufficient
			} catch (err) {
				// Only show error notification, not success
				void window.showErrorMessage(
					`Failed to start Batch Review API server: ${err instanceof Error ? err.message : String(err)}`
				);
				await this._sendAutomationStatus(false, null);
			}
		} else {
			// Already running, just send current status
			await this._sendAutomationStatus(true, this._apiServer.getPort());
		}
	}

	private async _handleStopAutomation(): Promise<void> {
		if (this._apiServer?.isRunning()) {
			try {
				await this._apiServer.stop();
				await this._sendAutomationStatus(false, null);
				// No notification - status indicator in UI is sufficient
			} catch (err) {
				void window.showErrorMessage(
					`Failed to stop Batch Review API server: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		} else {
			await this._sendAutomationStatus(false, null);
		}
	}

	private async _sendAutomationStatus(
		running: boolean,
		port: number | null
	): Promise<void> {
		if (!this._panel) {
			return;
		}

		await this._panel.webview.postMessage({
			type: 'automationStatus',
			body: {
				running,
				port,
			},
		});
	}

	private async _handleMessage(
		msg: BatchReviewWebviewMessage
	): Promise<void> {
		switch (msg.type) {
			case 'getChainInfo': {
				// msg.body.changeID is the REST id (project~branch~Ixxxx...)
				const { changeID } = msg.body;
				let gerritChangeId: string | undefined = undefined;
				// Try to find in batchChanges first
				const found = this._state.batchChanges.find(
					(c) => c.changeID === changeID
				);
				if (found) {
					gerritChangeId = found.changeId;
				} else {
					// Try incomingChanges
					const foundIncoming = this._state.incomingChanges.find(
						(c) => c.changeID === changeID
					);
					if (foundIncoming) {
						gerritChangeId = foundIncoming.changeId;
					} else {
						// If not found, fetch detail to get Gerrit Change-Id
						const api = await getAPI();
						if (api) {
							try {
								const detailResp = await api['_tryRequest']({
									path: `changes/${changeID}/detail/`,
									method: 'GET',
								});
								if (
									detailResp &&
									api['_assertRequestSucceeded'](detailResp)
								) {
									const detailJson = api['_tryParseJSON']<{
										change_id: string;
									}>(detailResp.strippedBody);
									gerritChangeId = detailJson?.change_id;
								}
							} catch (err) {
								console.warn(
									'[batchReview] Error fetching change detail for chain info',
									{ changeID, err }
								);
							}
						}
					}
				}
				if (!gerritChangeId) {
					console.warn(
						'[batchReview] No Gerrit Change-Id (changeId) found for chain info',
						{ changeID }
					);
					await this._panel?.webview.postMessage({
						type: 'chainInfo',
						body: { changeID, inChain: false },
					});
					break;
				}
				// Use cached chain info
				const info = await this._getCachedChainInfo(gerritChangeId);
				await this._panel?.webview.postMessage({
					type: 'chainInfo',
					body: { changeID, ...info },
				});
				break;
			}
			case 'ready':
				// On ready, load Incoming Reviews instead of Your Turn
				await this._handleGetIncomingReviews();
				// Send initial automation status
				await this._sendAutomationStatus(
					this._apiServer?.isRunning() ?? false,
					this._apiServer?.getPort() ?? null
				);
				break;
			case 'getYourTurnChanges':
				// Legacy: use getIncomingReviews instead
				await this._handleGetIncomingReviews();
				break;
			case 'getIncomingReviews':
				await this._handleGetIncomingReviews();
				break;
			case 'plus2All':
				await this._handlePlus2All();
				break;
			case 'plus2AllAndSubmit':
				await this._handlePlus2AllAndSubmit();
				break;
			case 'addToBatch':
				await this._handleAddToBatch(msg);
				break;
			case 'removeFromBatch':
				await this._handleRemoveFromBatch(msg);
				break;
			case 'clearBatch':
				await this._handleClearBatch();
				break;
			case 'submitBatchVote':
				await this._handleSubmitBatchVote(msg);
				break;
			case 'inspectBatch':
				// Method not implemented, show info or ignore
				void window.showInformationMessage(
					'inspectBatch is not implemented.'
				);
				break;
			case 'startAutomation':
				await this._handleStartAutomation();
				break;
			case 'stopAutomation':
				await this._handleStopAutomation();
				break;
			case 'getFilesForChange':
				await this._handleGetFilesForChange(msg);
				break;
			case 'openFileDiff':
				await this._handleOpenFileDiff(msg);
				break;
			case 'getPeople':
				await this._handleGetPeople(msg);
				break;
			case 'submitBatch':
				await this._handleSubmitBatch();
				break;
			case 'setFileViewMode':
				this._handleSetFileViewMode(msg);
				break;
			case 'openChangeOnline':
				await this._handleOpenChangeOnline(msg);
				break;
			case 'reorderChanges':
				await this._handleReorderChanges(msg);
				break;
		}
	}

	private _handleSetFileViewMode(msg: SetFileViewModeMessage): void {
		this._state.fileViewMode = msg.body.mode;
		void this._updateView();
	}

	private async _handleOpenChangeOnline(
		msg: OpenChangeOnlineMessage
	): Promise<void> {
		const api = await getAPI();
		if (!api) {
			void window.showErrorMessage('Failed to connect to Gerrit API');
			return;
		}
		const url = api.getPublicUrl(
			`c/${msg.body.project}/+/${msg.body.number}`
		);
		if (!url) {
			void window.showErrorMessage('Could not determine Gerrit URL');
			return;
		}
		await env.openExternal(Uri.parse(url));
	}

	private async _handleReorderChanges(
		msg: ReorderChangesMessage
	): Promise<void> {
		const { changeIDs, targetList, dropIndex } = msg.body;

		// Get the target array
		const targetArray =
			targetList === 'batch'
				? this._state.batchChanges
				: this._state.incomingChanges;

		// Build a set of IDs being moved
		const movingSet = new Set(changeIDs);

		// Separate items: those being moved and those staying
		// Filter preserves the original order from targetArray
		const movingItems = targetArray.filter((c) =>
			movingSet.has(c.changeID)
		);
		const remainingItems = targetArray.filter(
			(c) => !movingSet.has(c.changeID)
		);

		// Calculate adjusted drop index (items before the drop point that are NOT being moved)
		let adjustedIndex = 0;
		for (
			let i = 0;
			i < targetArray.length && adjustedIndex < dropIndex;
			i++
		) {
			if (!movingSet.has(targetArray[i].changeID)) {
				adjustedIndex++;
			}
		}

		// Insert moving items at the adjusted position
		const newArray = [
			...remainingItems.slice(0, adjustedIndex),
			...movingItems,
			...remainingItems.slice(adjustedIndex),
		];

		// Update state
		if (targetList === 'batch') {
			this._state.batchChanges = newArray;
		} else {
			this._state.incomingChanges = newArray;
		}

		await this._updateView();
	}

	private async _updateView(): Promise<void> {
		if (!this._panel) {
			return;
		}

		await this._panel.webview.postMessage({
			type: 'stateToView',
			body: {
				state: this._state,
			},
		});
	}

	public async openBatchReview(): Promise<void> {
		if (this._panel) {
			this._panel.reveal(ViewColumn.One);
			return;
		}

		this._panel = window.createWebviewPanel(
			'gerritBatchReview',
			'Gerrit Batch Review',
			ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this._context.extensionUri],
			}
		) as TypedWebviewPanel<BatchReviewWebviewMessage>;

		this._panel.iconPath = Uri.joinPath(
			this._context.extensionUri,
			'src/images/gerrit.png'
		);

		this._panel.webview.html = getHTML(
			this._context.extensionUri,
			this._panel.webview
		);

		this._disposables.push(
			this._panel.webview.onDidReceiveMessage((msg) =>
				this._handleMessage(msg)
			)
		);

		this._disposables.push(
			this._panel.onDidDispose(() => {
				this._panel = null;
				// Stop the API server when the panel is closed
				if (this._apiServer?.isRunning()) {
					this._apiServer.stop().catch(() => {
						// Silently ignore stop errors on panel close
					});
				}
			})
		);

		// Auto-start the API server when the panel opens
		void this._handleStartAutomation();
	}

	// Extensible API for AI agents/automation (read/modify batch, but NOT submit)
	public addToBatch(changeIDs: string[], scores?: ScoreMap): void {
		void this._handleAddToBatch(
			{
				type: 'addToBatch',
				body: { changeIDs },
			},
			scores
		);
	}

	public removeFromBatch(changeIDs: string[]): void {
		void this._handleRemoveFromBatch({
			type: 'removeFromBatch',
			body: { changeIDs },
		});
	}

	public getBatchChanges(): BatchReviewChange[] {
		return [...this._state.batchChanges];
	}

	public getYourTurnChanges(): BatchReviewChange[] {
		return [...this._state.incomingChanges];
	}

	public dispose(): void {
		this._disposables.forEach((d) => d.dispose());
		this._panel?.dispose();
		// Stop the API server on disposal
		if (this._apiServer?.isRunning()) {
			this._apiServer.stop().catch(() => {
				// Silently ignore stop errors on disposal
			});
		}
	}
}

let batchReviewProvider: BatchReviewProvider | null = null;

export async function getOrCreateBatchReviewProvider(
	gerritRepo: Repository,
	context: ExtensionContext
): Promise<BatchReviewProvider> {
	if (batchReviewProvider) {
		return batchReviewProvider;
	}
	return (batchReviewProvider = await BatchReviewProvider.create(
		gerritRepo,
		context
	));
}

export function getBatchReviewProvider(): BatchReviewProvider | null {
	return batchReviewProvider;
}
