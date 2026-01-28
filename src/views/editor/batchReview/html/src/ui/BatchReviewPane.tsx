import React, { VFC, useState, useEffect } from 'react';
import { BatchReviewState } from '../../../state';
import { BatchReviewChange, BatchReviewFileInfo } from '../../../types';
import { vscode } from '../lib/api';

interface FileItemProps {
	file: BatchReviewFileInfo;
	changeID: string;
}

const FileItem: VFC<FileItemProps> = ({ file, changeID }) => {
	const handleFileClick = () => {
		vscode.postMessage({
			type: 'openFileDiff',
			body: {
				changeID,
				filePath: file.filePath,
			},
		});
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleFileClick();
		}
	};

	const getStatusIcon = (status: BatchReviewFileInfo['status']) => {
		switch (status) {
			case 'A':
				return <span className="file-status file-status-added">A</span>;
			case 'D':
				return <span className="file-status file-status-deleted">D</span>;
			case 'R':
				return <span className="file-status file-status-renamed">R</span>;
			case 'M':
			default:
				return <span className="file-status file-status-modified">M</span>;
		}
	};

	return (
		<div
			className="file-item"
			onClick={handleFileClick}
			onKeyDown={handleKeyDown}
			tabIndex={0}
			role="button"
			aria-label={`Open diff for ${file.filePath}`}
		>
			<span className="codicon codicon-file"></span>
			{getStatusIcon(file.status)}
			<span className="file-path">{file.filePath}</span>
			<span className="file-stats">
				{file.linesInserted > 0 && (
					<span className="file-additions">+{file.linesInserted}</span>
				)}
				{file.linesDeleted > 0 && (
					<span className="file-deletions">-{file.linesDeleted}</span>
				)}
			</span>
		</div>
	);
};

interface ExpandableChangeItemProps {
	change: BatchReviewChange;
	selected: boolean;
	onSelectionChange: (changeID: string, selected: boolean) => void;
	showScore?: boolean;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent, changeID: string) => void;
}

const ExpandableChangeItem: VFC<ExpandableChangeItemProps> = ({
	change,
	selected,
	onSelectionChange,
	showScore = false,
	draggable = false,
	onDragStart,
}) => {
	const [expanded, setExpanded] = useState(false);
	const [loadingFiles, setLoadingFiles] = useState(false);

	const handleExpandClick = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		if (!expanded && !change.filesLoaded) {
			setLoadingFiles(true);
			vscode.postMessage({
				type: 'getFilesForChange',
				body: { changeID: change.changeID },
			});
		}
		setExpanded(!expanded);
	};

	// When files are loaded, stop loading indicator
	useEffect(() => {
		if (change.filesLoaded) {
			setLoadingFiles(false);
		}
	}, [change.filesLoaded]);

	const handleDragStart = (e: React.DragEvent) => {
		if (onDragStart) {
			onDragStart(e, change.changeID);
		}
	};

	return (
		<div
			className={`change-item ${selected ? 'selected' : ''} ${draggable ? 'draggable' : ''}`}
			draggable={draggable}
			onDragStart={handleDragStart}
		>
			<div className="change-row">
				{draggable && (
					<span className="drag-handle" title="Drag to move">
						<span className="codicon codicon-gripper"></span>
					</span>
				)}
				<button
					className="expand-button"
					onClick={handleExpandClick}
					title={expanded ? 'Collapse files' : 'Expand files'}
				>
					<span
						className={`codicon ${
							expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'
						}`}
					></span>
				</button>
				<label className="change-checkbox">
					<input
						type="checkbox"
						checked={selected}
						onChange={(e) =>
							onSelectionChange(change.changeID, e.target.checked)
						}
					/>
					<div className="change-info">
						<div className="change-header">
							<span className="change-number">#{change.number}</span>
							<span className="change-subject">{change.subject}</span>
							{showScore && change.score !== undefined && (
								<span
									className={`change-score score-${Math.min(
										10,
										Math.max(1, Math.round(change.score))
									)}`}
									title={`AI confidence score: ${change.score}/10`}
								>
									{change.score}
								</span>
							)}
						</div>
						<div className="change-details">
							<span className="change-project">{change.project}</span>
							<span className="change-branch">{change.branch}</span>
							<span className="change-owner">{change.owner.name}</span>
						</div>
					</div>
				</label>
			</div>
			{expanded && (
				<div className="files-container">
					{loadingFiles ? (
						<div className="files-loading">
							<span className="codicon codicon-loading codicon-modifier-spin"></span>
							<span>Loading files...</span>
						</div>
					) : change.files && change.files.length > 0 ? (
						change.files.map((file) => (
							<FileItem
								key={file.filePath}
								file={file}
								changeID={change.changeID}
							/>
						))
					) : (
						<div className="files-empty">No files found</div>
					)}
				</div>
			)}
		</div>
	);
};

interface ChangeListProps {
	changes: BatchReviewChange[];
	selectedChanges: Set<string>;
	onSelectionChange: (changeID: string, selected: boolean) => void;
	onSelectAll: (selected: boolean) => void;
	title: string;
	showScores?: boolean;
	listType: 'yourTurn' | 'batch';
	onDragStart: (e: React.DragEvent, changeID: string, listType: 'yourTurn' | 'batch') => void;
	onDrop: (e: React.DragEvent, targetListType: 'yourTurn' | 'batch') => void;
}

const ChangeList: VFC<ChangeListProps> = ({
	changes,
	selectedChanges,
	onSelectionChange,
	onSelectAll,
	title,
	showScores = false,
	listType,
	onDragStart,
	onDrop,
}) => {
	const allSelected =
		changes.length > 0 && changes.every((c) => selectedChanges.has(c.changeID));
	const [isDragOver, setIsDragOver] = useState(false);

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		setIsDragOver(true);
	};

	const handleDragLeave = () => {
		setIsDragOver(false);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);
		onDrop(e, listType);
	};

	const handleItemDragStart = (e: React.DragEvent, changeID: string) => {
		onDragStart(e, changeID, listType);
	};

	return (
		<div
			className={`change-list ${isDragOver ? 'drag-over' : ''}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
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
					<div className="empty-message drop-hint">
						{isDragOver ? 'Drop here to add' : 'No changes'}
					</div>
				) : (
					changes.map((change) => (
						<ExpandableChangeItem
							key={change.changeID}
							change={change}
							selected={selectedChanges.has(change.changeID)}
							onSelectionChange={onSelectionChange}
							showScore={showScores}
							draggable={true}
							onDragStart={handleItemDragStart}
						/>
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

	// Drag and Drop handlers
	const handleDragStart = (
		e: React.DragEvent,
		changeID: string,
		sourceList: 'yourTurn' | 'batch'
	) => {
		// Get list of IDs to drag - if the dragged item is selected, drag all selected items
		// Otherwise, just drag the single item
		const selectedSet =
			sourceList === 'yourTurn' ? selectedYourTurn : selectedBatch;
		let changeIDs: string[];

		if (selectedSet.has(changeID)) {
			// Dragging a selected item - drag all selected items
			changeIDs = Array.from(selectedSet);
		} else {
			// Dragging an unselected item - just drag that one
			changeIDs = [changeID];
		}

		e.dataTransfer.setData(
			'application/json',
			JSON.stringify({
				changeIDs,
				sourceList,
			})
		);
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleDrop = (
		e: React.DragEvent,
		targetList: 'yourTurn' | 'batch'
	) => {
		e.preventDefault();
		const data = e.dataTransfer.getData('application/json');
		if (!data) return;

		try {
			const { changeIDs, sourceList } = JSON.parse(data) as {
				changeIDs: string[];
				sourceList: 'yourTurn' | 'batch';
			};

			// Don't do anything if dropping on the same list
			if (sourceList === targetList) return;

			if (targetList === 'batch') {
				// Moving from yourTurn to batch
				vscode.postMessage({
					type: 'addToBatch',
					body: { changeIDs },
				});
				setSelectedYourTurn(new Set());
			} else {
				// Moving from batch to yourTurn
				vscode.postMessage({
					type: 'removeFromBatch',
					body: { changeIDs },
				});
				setSelectedBatch(new Set());
			}
		} catch {
			// Invalid data, ignore
		}
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
						listType="yourTurn"
						onDragStart={handleDragStart}
						onDrop={handleDrop}
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
						showScores={true}
						listType="batch"
						onDragStart={handleDragStart}
						onDrop={handleDrop}
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
								placeholder="Optional message used for all batch reviews..."
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
