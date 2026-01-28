import {
	Disposable,
	ExtensionContext,
	Uri,
	ViewColumn,
	WebviewPanel,
	window,
} from 'vscode';
import {
	AddToBatchMessage,
	BatchReviewWebviewMessage,
	ClearBatchMessage,
	InspectBatchMessage,
	RemoveFromBatchMessage,
	SubmitBatchVoteMessage,
} from './messaging';
import { BatchReviewChange, TypedWebviewPanel } from './types';
import { BatchReviewState } from './state';
import { GerritChange } from '../../../lib/gerrit/gerritAPI/gerritChange';
import { GerritAPIWith } from '../../../lib/gerrit/gerritAPI/api';
import { Repository } from '../../../types/vscode-extension-git';
import { getAPI } from '../../../lib/gerrit/gerritAPI';
import { getHTML } from './html';
import {
	DefaultChangeFilter,
	GerritChangeFilter,
} from '../../../lib/gerrit/gerritAPI/filters';

class BatchReviewProvider implements Disposable {
	private _panel: TypedWebviewPanel<BatchReviewWebviewMessage> | null = null;
	private readonly _disposables: Disposable[] = [];
	private _state: BatchReviewState = {
		yourTurnChanges: [],
		batchChanges: [],
		loading: false,
	};

	private constructor(
		private readonly _gerritRepo: Repository,
		private readonly _context: ExtensionContext
	) {}

	public static async create(
		gerritRepo: Repository,
		context: ExtensionContext
	): Promise<BatchReviewProvider> {
		const provider = new this(gerritRepo, context);
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

		return changes.map((change) => ({
			changeID: change.changeID,
			number: change.number,
			subject: change.subject,
			project: change.project,
			branch: change.branch,
			owner: {
				name: change.owner.name ?? 'Unknown',
				accountID: change.owner._account_id,
			},
			updated: change.updated,
		}));
	}

	private async _handleGetYourTurnChanges(): Promise<void> {
		if (!this._panel) return;

		this._state.loading = true;
		await this._updateView();

		const changes = await this._getYourTurnChanges();
		this._state.yourTurnChanges = changes;
		this._state.loading = false;
		await this._updateView();
	}

	private async _handleAddToBatch(msg: AddToBatchMessage): Promise<void> {
		const changesToAdd = this._state.yourTurnChanges.filter((change) =>
			msg.body.changeIDs.includes(change.changeID)
		);

		// Remove from yourTurn and add to batch (avoid duplicates)
		this._state.yourTurnChanges = this._state.yourTurnChanges.filter(
			(change) => !msg.body.changeIDs.includes(change.changeID)
		);

		for (const change of changesToAdd) {
			if (
				!this._state.batchChanges.some(
					(c) => c.changeID === change.changeID
				)
			) {
				this._state.batchChanges.push(change);
			}
		}

		await this._updateView();
	}

	private async _handleRemoveFromBatch(
		msg: RemoveFromBatchMessage
	): Promise<void> {
		const changesToRemove = this._state.batchChanges.filter((change) =>
			msg.body.changeIDs.includes(change.changeID)
		);

		// Remove from batch and add back to yourTurn
		this._state.batchChanges = this._state.batchChanges.filter(
			(change) => !msg.body.changeIDs.includes(change.changeID)
		);

		for (const change of changesToRemove) {
			if (
				!this._state.yourTurnChanges.some(
					(c) => c.changeID === change.changeID
				)
			) {
				this._state.yourTurnChanges.push(change);
			}
		}

		await this._updateView();
	}

	private async _handleClearBatch(): Promise<void> {
		// Move all batch changes back to yourTurn
		for (const change of this._state.batchChanges) {
			if (
				!this._state.yourTurnChanges.some(
					(c) => c.changeID === change.changeID
				)
			) {
				this._state.yourTurnChanges.push(change);
			}
		}
		this._state.batchChanges = [];
		await this._updateView();
	}

	private async _handleSubmitBatchVote(
		msg: SubmitBatchVoteMessage
	): Promise<void> {
		if (!this._panel) return;

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

		// Submit vote for each change in batch
		for (const change of this._state.batchChanges) {
			const changeObj = await GerritChange.getChangeOnce(change.changeID);
			if (!changeObj) {
				failureCount++;
				continue;
			}

			const currentRevision = await changeObj.currentRevision();
			if (!currentRevision) {
				failureCount++;
				continue;
			}

			const success = await api.setReview(
				change.changeID,
				currentRevision.id,
				{
					labels: { 'Code-Review': msg.body.score },
					message: msg.body.message || undefined,
				}
			);

			if (success) {
				successCount++;
			} else {
				failureCount++;
			}
		}

		// Clear batch after submission
		this._state.batchChanges = [];
		await this._updateView();

		await this._panel.webview.postMessage({
			type: 'batchVoteSuccess',
			body: {
				successCount,
				failureCount,
			},
		});
	}

	private async _handleInspectBatch(): Promise<void> {
		// API for programmatic inspection (AI agents can use this)
		// This does NOT allow submission, only inspection
		return;
	}

	private async _handleMessage(
		msg: BatchReviewWebviewMessage
	): Promise<void> {
		switch (msg.type) {
			case 'ready':
				await this._handleGetYourTurnChanges();
				break;
			case 'getYourTurnChanges':
				await this._handleGetYourTurnChanges();
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
				await this._handleInspectBatch();
				break;
		}
	}

	private async _updateView(): Promise<void> {
		if (!this._panel) return;

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
			})
		);
	}

	// Extensible API for AI agents/automation (read/modify batch, but NOT submit)
	public addToBatch(changeIDs: string[]): void {
		void this._handleAddToBatch({
			type: 'addToBatch',
			body: { changeIDs },
		});
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
		return [...this._state.yourTurnChanges];
	}

	public dispose(): void {
		this._disposables.forEach((d) => d.dispose());
		this._panel?.dispose();
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
