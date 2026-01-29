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
	createBatchReviewApiServer,
	BatchReviewApiServer,
	ScoreMap,
} from '../../lib/batchReviewApi/server';
import {
	BatchReviewChange,
	BatchReviewFileInfo,
	TypedWebviewPanel,
} from './batchReview/types';
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
		yourTurnChanges: [],
		batchChanges: [],
		loading: false,
		fileViewMode: 'tree',
	};
	private _apiServer: BatchReviewApiServer | null = null;

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

		return changes.map((change) => {
			const ownerName: string =
				'name' in change.owner
					? (change.owner.name as string)
					: `Account ${change.owner._account_id}`;
			return {
				changeID: change.changeID,
				number: change.number,
				subject: change.subject,
				project: change.project,
				branch: change.branch,
				owner: {
					name: ownerName,
					accountID: change.owner._account_id,
				},
				updated: change.updated,
			};
		});
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
		this._state.yourTurnChanges = changes.filter(
			(change) => !batchChangeIDs.has(change.changeID)
		);

		this._state.loading = false;
		await this._updateView();
	}

	private async _handleAddToBatch(
		msg: AddToBatchMessage,
		scores?: ScoreMap
	): Promise<void> {
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
				// Apply score if provided
				if (scores && scores[change.changeID] !== undefined) {
					change.score = scores[change.changeID];
				}
				this._state.batchChanges.push(change);
			}
		}

		// Sort batch changes by score (highest first)
		this._state.batchChanges.sort((a, b) => {
			const scoreA = a.score ?? 0;
			const scoreB = b.score ?? 0;
			return scoreB - scoreA;
		});

		// Fetch labels if this is the first item added to batch
		if (changesToAdd.length > 0 && !this._state.labels) {
			await this._fetchLabels();
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
					labels: msg.body.labels,
					message: msg.body.message || undefined,
					resolved: msg.body.resolved,
					publishDrafts: false,
					reviewers: msg.body.reviewers ?? [],
					cc: msg.body.cc ?? [],
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

		for (const change of this._state.batchChanges) {
			const success = await api.submit(change.changeID);
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
		let changeIndex = this._state.yourTurnChanges.findIndex(
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
			const existingChange = this._state.yourTurnChanges[changeIndex];
			const updatedChange = {
				...existingChange,
				files,
				filesLoaded: true,
			};
			this._state.yourTurnChanges = [
				...this._state.yourTurnChanges.slice(0, changeIndex),
				updatedChange,
				...this._state.yourTurnChanges.slice(changeIndex + 1),
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
			await vscodeCommands.executeCommand(
				diffCommand.command,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				...(diffCommand.arguments ?? [])
			);
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
				getYourTurn: () => this.getYourTurnChanges(),
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
			case 'ready':
				await this._handleGetYourTurnChanges();
				// Send initial automation status
				await this._sendAutomationStatus(
					this._apiServer?.isRunning() ?? false,
					this._apiServer?.getPort() ?? null
				);
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
				: this._state.yourTurnChanges;

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
			this._state.yourTurnChanges = newArray;
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
		return [...this._state.yourTurnChanges];
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
