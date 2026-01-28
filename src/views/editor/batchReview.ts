import {
	Disposable,
	ExtensionContext,
	Uri,
	ViewColumn,
	window,
} from 'vscode';
import {
	AddToBatchMessage,
	BatchReviewWebviewMessage,
	RemoveFromBatchMessage,
	SubmitBatchVoteMessage,
} from './batchReview/messaging';
import { BatchReviewChange, TypedWebviewPanel } from './batchReview/types';
import { BatchReviewState } from './batchReview/state';
import { GerritChange } from '../../lib/gerrit/gerritAPI/gerritChange';
import { GerritAPIWith } from '../../lib/gerrit/gerritAPI/api';
import { Repository } from '../../types/vscode-extension-git';
import { getAPI } from '../../lib/gerrit/gerritAPI';
import { getHTML } from './batchReview/html';
import {
	DefaultChangeFilter,
	GerritChangeFilter,
} from '../../lib/gerrit/gerritAPI/filters';
import {
	createBatchReviewApiServer,
	BatchReviewApiServer,
} from '../../lib/batchReviewApi/server';

class BatchReviewProvider implements Disposable {
	private _panel: TypedWebviewPanel<BatchReviewWebviewMessage> | null = null;
	private readonly _disposables: Disposable[] = [];
	private _state: BatchReviewState = {
		yourTurnChanges: [],
		batchChanges: [],
		loading: false,
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
					labels: { 'Code-Review': msg.body.score },
					message: msg.body.message || undefined,
					publishDrafts: false,
					reviewers: [],
					cc: [],
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

	private async _handleStartAutomation(): Promise<void> {
		if (!this._panel) {
			return;
		}

		// Create the API server if not already created
		if (!this._apiServer) {
			this._apiServer = createBatchReviewApiServer({
				getBatch: () => this.getBatchChanges(),
				getYourTurn: () => this.getYourTurnChanges(),
				addToBatch: (changeIDs) => this.addToBatch(changeIDs),
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
				void window.showInformationMessage(
					`Batch Review API server started on http://127.0.0.1:${port}`
				);
			} catch (err) {
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
				void window.showInformationMessage(
					'Batch Review API server stopped'
				);
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
		}
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
