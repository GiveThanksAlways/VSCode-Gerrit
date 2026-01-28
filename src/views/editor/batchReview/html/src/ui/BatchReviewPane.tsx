import React, { VFC, useState, useEffect } from 'react';
import { BatchReviewState } from '../../../state';
import { BatchReviewChange } from '../../../types';
import { vscode } from '../lib/api';

interface ChangeListProps {
	changes: BatchReviewChange[];
	selectedChanges: Set<string>;
	onSelectionChange: (changeID: string, selected: boolean) => void;
	onSelectAll: (selected: boolean) => void;
	title: string;
}

const ChangeList: VFC<ChangeListProps> = ({
	changes,
	selectedChanges,
	onSelectionChange,
	onSelectAll,
	title,
}) => {
	const allSelected =
		changes.length > 0 && changes.every((c) => selectedChanges.has(c.changeID));

	return (
		<div className="change-list">
			<div className="list-header">
				<h2>{title}</h2>
				{changes.length > 0 && (
					<label className="checkbox-label">
						<input
							type="checkbox"
							checked={allSelected}
							onChange={(e) => onSelectAll(e.target.checked)}
						/>
						<span>Select All ({changes.length})</span>
					</label>
				)}
			</div>
			<div className="changes-container">
				{changes.length === 0 ? (
					<div className="empty-message">No changes</div>
				) : (
					changes.map((change) => (
						<div
							key={change.changeID}
							className={`change-item ${
								selectedChanges.has(change.changeID) ? 'selected' : ''
							}`}
						>
							<label className="change-checkbox">
								<input
									type="checkbox"
									checked={selectedChanges.has(change.changeID)}
									onChange={(e) =>
										onSelectionChange(change.changeID, e.target.checked)
									}
								/>
								<div className="change-info">
									<div className="change-header">
										<span className="change-number">#{change.number}</span>
										<span className="change-subject">{change.subject}</span>
									</div>
									<div className="change-details">
										<span className="change-project">{change.project}</span>
										<span className="change-branch">{change.branch}</span>
										<span className="change-owner">{change.owner.name}</span>
									</div>
								</div>
							</label>
						</div>
					))
				)}
			</div>
		</div>
	);
};

export const BatchReviewPane: VFC = () => {
	const [state, setState] = useState<BatchReviewState>({
		yourTurnChanges: [],
		batchChanges: [],
		loading: true,
	});
	const [selectedYourTurn, setSelectedYourTurn] = useState<Set<string>>(
		new Set()
	);
	const [selectedBatch, setSelectedBatch] = useState<Set<string>>(new Set());
	const [voteMessage, setVoteMessage] = useState<string>('');
	const [automationStatus, setAutomationStatus] = useState<{
		running: boolean;
		port: number | null;
	}>({ running: false, port: null });

	useEffect(() => {
		const messageHandler = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === 'stateToView') {
				setState(message.body.state);
			} else if (message.type === 'batchVoteSuccess') {
				const { successCount, failureCount } = message.body;
				alert(
					`Batch review completed!\nSuccess: ${successCount}\nFailed: ${failureCount}`
				);
				setVoteMessage('');
			} else if (message.type === 'batchVoteFailed') {
				alert('Batch review failed. Please try again.');
			} else if (message.type === 'automationStatus') {
				setAutomationStatus(message.body);
			}
		};

		window.addEventListener('message', messageHandler);
		vscode.postMessage({ type: 'ready' });

		return () => window.removeEventListener('message', messageHandler);
	}, []);

	const handleYourTurnSelection = (changeID: string, selected: boolean) => {
		const newSet = new Set(selectedYourTurn);
		if (selected) {
			newSet.add(changeID);
		} else {
			newSet.delete(changeID);
		}
		setSelectedYourTurn(newSet);
	};

	const handleYourTurnSelectAll = (selected: boolean) => {
		if (selected) {
			setSelectedYourTurn(
				new Set(state.yourTurnChanges.map((c) => c.changeID))
			);
		} else {
			setSelectedYourTurn(new Set());
		}
	};

	const handleBatchSelection = (changeID: string, selected: boolean) => {
		const newSet = new Set(selectedBatch);
		if (selected) {
			newSet.add(changeID);
		} else {
			newSet.delete(changeID);
		}
		setSelectedBatch(newSet);
	};

	const handleBatchSelectAll = (selected: boolean) => {
		if (selected) {
			setSelectedBatch(new Set(state.batchChanges.map((c) => c.changeID)));
		} else {
			setSelectedBatch(new Set());
		}
	};

	const handleAddToBatch = () => {
		if (selectedYourTurn.size === 0) return;
		vscode.postMessage({
			type: 'addToBatch',
			body: { changeIDs: Array.from(selectedYourTurn) },
		});
		setSelectedYourTurn(new Set());
	};

	const handleRemoveFromBatch = () => {
		if (selectedBatch.size === 0) return;
		vscode.postMessage({
			type: 'removeFromBatch',
			body: { changeIDs: Array.from(selectedBatch) },
		});
		setSelectedBatch(new Set());
	};

	const handleClearBatch = () => {
		if (state.batchChanges.length === 0) return;
		vscode.postMessage({ type: 'clearBatch' });
		setSelectedBatch(new Set());
	};

	const handleSubmitVote = (score: number) => {
		if (state.batchChanges.length === 0) {
			alert('No changes in batch to review');
			return;
		}

		vscode.postMessage({
			type: 'submitBatchVote',
			body: {
				score,
				message: voteMessage.trim() || undefined,
			},
		});
	};

	const handleRefresh = () => {
		vscode.postMessage({ type: 'getYourTurnChanges' });
	};

	const handleStartAutomation = () => {
		vscode.postMessage({ type: 'startAutomation' });
	};

	const handleStopAutomation = () => {
		vscode.postMessage({ type: 'stopAutomation' });
	};

	if (state.loading) {
		return (
			<div className="loading-container">
				<div className="codicon codicon-loading codicon-modifier-spin"></div>
				<span>Loading changes...</span>
			</div>
		);
	}

	return (
		<div className="batch-review-container">
			<div className="header">
				<h1>Batch Review</h1>
				<div className="header-buttons">
					<button
						className="refresh-button"
						onClick={handleRefresh}
						title="Refresh Your Turn changes"
					>
						<span className="codicon codicon-refresh"></span>
						Refresh
					</button>
					{automationStatus.running ? (
						<button
							className="automation-button automation-stop"
							onClick={handleStopAutomation}
							title="Stop local API server"
						>
							<span className="codicon codicon-debug-stop"></span>
							Stop API (:{automationStatus.port})
						</button>
					) : (
						<button
							className="automation-button automation-start"
							onClick={handleStartAutomation}
							title="Start local API server for AI/script automation"
						>
							<span className="codicon codicon-rocket"></span>
							AI Automate Batch List
						</button>
					)}
				</div>
			</div>

			{automationStatus.running && (
				<div className="automation-status">
					<span className="codicon codicon-broadcast"></span>
					<span>
						Local API running at{' '}
						<code>http://127.0.0.1:{automationStatus.port}</code>
					</span>
				</div>
			)}

			<div className="lists-container">
				<div className="your-turn-section">
					<ChangeList
						changes={state.yourTurnChanges}
						selectedChanges={selectedYourTurn}
						onSelectionChange={handleYourTurnSelection}
						onSelectAll={handleYourTurnSelectAll}
						title="Your Turn"
					/>
					<div className="action-buttons">
						<button
							onClick={handleAddToBatch}
							disabled={selectedYourTurn.size === 0}
							className="button-primary"
						>
							<span className="codicon codicon-arrow-down"></span>
							Add to Batch ({selectedYourTurn.size})
						</button>
					</div>
				</div>

				<div className="batch-section">
					<ChangeList
						changes={state.batchChanges}
						selectedChanges={selectedBatch}
						onSelectionChange={handleBatchSelection}
						onSelectAll={handleBatchSelectAll}
						title="Batch"
					/>
					<div className="batch-actions">
						<div className="action-buttons">
							<button
								onClick={handleRemoveFromBatch}
								disabled={selectedBatch.size === 0}
								className="button-secondary"
							>
								<span className="codicon codicon-arrow-up"></span>
								Remove ({selectedBatch.size})
							</button>
							<button
								onClick={handleClearBatch}
								disabled={state.batchChanges.length === 0}
								className="button-secondary"
							>
								<span className="codicon codicon-clear-all"></span>
								Clear All
							</button>
						</div>
						<div className="vote-section">
							<textarea
								className="vote-message"
								placeholder="Optional message for batch review..."
								value={voteMessage}
								onChange={(e) => setVoteMessage(e.target.value)}
								rows={3}
							/>
							<div className="vote-buttons">
								<button
									onClick={() => handleSubmitVote(1)}
									disabled={state.batchChanges.length === 0}
									className="button-vote vote-plus-one"
									title="Submit Code-Review +1 to all changes in batch"
								>
									<span className="codicon codicon-thumbsup"></span>
									+1 ({state.batchChanges.length})
								</button>
								<button
									onClick={() => handleSubmitVote(2)}
									disabled={state.batchChanges.length === 0}
									className="button-vote vote-plus-two"
									title="Submit Code-Review +2 to all changes in batch"
								>
									<span className="codicon codicon-verified"></span>
									+2 ({state.batchChanges.length})
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
