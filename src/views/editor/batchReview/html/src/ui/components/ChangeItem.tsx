import { BatchReviewChange, BatchReviewFileInfo } from '../../../../types';
import { FolderItem, FileItem, buildSimpleFileTree } from './FileTree';
import React, { VFC, useState, useEffect } from 'react';
import { vscode } from '../../lib/api';

export interface ChainInfo {
	inChain: boolean;
	position?: number;
	length?: number;
	/** Chain color class for visual grouping */
	chainColorClass?: string;
	/** Whether this change has unsubmitted dependencies */
	hasUnsubmittedDependencies?: boolean;
	/** Change number of the base (first) change in the chain */
	chainNumber?: number;
	/** Full Change-Id of the base (first) change in the chain */
	chainBaseChangeId?: string;
}

/**
 * Selection event types for the ChangeItem component.
 * This provides a clean interface for the parent to handle all selection scenarios.
 */
export interface SelectionEvent {
	changeID: string;
	index: number;
	/** The type of selection action */
	action:
		| 'toggle' // Toggle single item (checkbox click or Ctrl+click)
		| 'range' // Select range from anchor (Shift+click)
		| 'anchor' // Just set anchor, no selection change (plain click on row)
		| 'chain'; // Select all items in this chain
	/** For chain selection, the chain number to select */
	chainNumber?: number;
}

interface ExpandableChangeItemProps {
	change: BatchReviewChange;
	selected: boolean;
	onSelectionEvent: (event: SelectionEvent) => void;
	showScore?: boolean;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent, changeID: string) => void;
	onDragOver?: (e: React.DragEvent, index: number) => void;
	fileViewMode?: 'list' | 'tree';
	index: number;
	showDropIndicator?: 'before' | 'after' | null;
	/** Chain info for highlighting */
	chainInfo?: ChainInfo;
}

export const ExpandableChangeItem: VFC<ExpandableChangeItemProps> = ({
	change,
	selected,
	onSelectionEvent,
	showScore = false,
	draggable = false,
	onDragStart,
	onDragOver,
	fileViewMode = 'tree',
	index,
	showDropIndicator = null,
	chainInfo: externalChainInfo,
}) => {
	const [expanded, setExpanded] = useState(false);
	const [loadingFiles, setLoadingFiles] = useState(false);
	const [chainInfo, setChainInfo] = useState<ChainInfo>(
		externalChainInfo || { inChain: false }
	);

	useEffect(() => {
		vscode.postMessage({
			type: 'getChainInfo',
			body: { changeID: change.changeId }, // Use Change-Id
		});
		const handler = (event: MessageEvent) => {
			if (
				event.data?.type === 'chainInfo' &&
				event.data.body.changeID === change.changeId
			) {
				setChainInfo(event.data.body);
			}
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, [change.changeId]);

	// Update from external chain info if provided
	useEffect(() => {
		if (externalChainInfo) {
			setChainInfo(externalChainInfo);
		}
	}, [externalChainInfo]);

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

	const handleItemDragOver = (e: React.DragEvent) => {
		if (onDragOver) {
			onDragOver(e, index);
		}
	};

	/**
	 * Handle checkbox click - always toggles selection
	 */
	const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		e.stopPropagation();
		onSelectionEvent({
			changeID: change.changeID,
			index,
			action: 'toggle',
		});
	};

	/**
	 * Handle checkbox click event to prevent propagation
	 */
	const handleCheckboxClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		// The onChange handler will handle the actual toggle
	};

	/**
	 * Handle row click - implements standard multi-select behavior:
	 * - Plain click: Set anchor for future shift-clicks
	 * - Ctrl/Cmd+click: Toggle selection of this item
	 * - Shift+click: Select range from anchor to this item
	 */
	const handleRowClick = (e: React.MouseEvent) => {
		// Don't handle if clicking on interactive elements
		const target = e.target as HTMLElement;
		if (
			target.closest('button') ||
			target.closest('input') ||
			target.closest('.chain-badge')
		) {
			return;
		}

		if (e.shiftKey) {
			e.preventDefault();
			onSelectionEvent({
				changeID: change.changeID,
				index,
				action: 'range',
			});
		} else if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			onSelectionEvent({
				changeID: change.changeID,
				index,
				action: 'toggle',
			});
		} else {
			// Plain click - just set anchor for future shift-clicks
			onSelectionEvent({
				changeID: change.changeID,
				index,
				action: 'anchor',
			});
		}
	};

	/**
	 * Handle chain badge click - selects all items in the chain
	 */
	const handleChainBadgeClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (chainInfo.chainNumber) {
			onSelectionEvent({
				changeID: change.changeID,
				index,
				action: 'chain',
				chainNumber: chainInfo.chainNumber,
			});
		}
	};

	// Build class string for chain highlighting
	const chainClasses = [
		chainInfo.inChain ? 'in-chain' : '',
		chainInfo.chainColorClass || '',
		chainInfo.hasUnsubmittedDependencies ? 'chain-warning' : '',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div
			className={`change-item ${selected ? 'selected' : ''} ${draggable ? 'draggable' : ''} ${showDropIndicator === 'before' ? 'drop-indicator-before' : ''} ${showDropIndicator === 'after' ? 'drop-indicator-after' : ''} ${chainClasses}`}
			draggable={draggable}
			onDragStart={handleDragStart}
			onDragOver={handleItemDragOver}
			onClick={handleRowClick}
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
							expanded
								? 'codicon-chevron-down'
								: 'codicon-chevron-right'
						}`}
					></span>
				</button>
				<div className="change-checkbox-wrapper">
					<input
						type="checkbox"
						className="change-checkbox"
						checked={selected}
						onChange={handleCheckboxChange}
						onClick={handleCheckboxClick}
					/>
				</div>
				<div className="change-info">
					<div className="change-header">
						<span className="change-number">#{change.number}</span>
						<span className="change-subject" title={change.subject}>
							{change.subject}
						</span>
						{showScore && change.score !== undefined && (
							<span
								className={`change-score score-${Math.min(10, Math.max(1, Math.round(change.score)))}`}
								title={`AI confidence score: ${change.score}/10`}
							>
								{change.score}
							</span>
						)}
						{/* Always show +2 checkmark if present */}
						{change.hasCodeReviewPlus2 && (
							<span
								className="status-badge plus2"
								title="Has Code-Review +2"
							>
								<span className="codicon codicon-check"></span>
							</span>
						)}
						{change.submittable && (
							<span
								className="status-badge submittable"
								title="Ready to submit"
							>
								<span className="codicon codicon-git-merge"></span>
							</span>
						)}
						{chainInfo.inChain && (
							<span
								className={`chain-badge clickable ${chainInfo.hasUnsubmittedDependencies ? 'chain-warning-badge' : ''}`}
								title={
									chainInfo.hasUnsubmittedDependencies
										? `Base change: #${chainInfo.chainNumber} (Position ${chainInfo.position} of ${chainInfo.length})\n\n⚠️ Has unsubmitted dependencies. Submit changes in order starting from #1.\n\nClick to select all changes in this chain.`
										: chainInfo.position != null &&
											  chainInfo.length != null
											? `Base change: #${chainInfo.chainNumber} (Position ${chainInfo.position} of ${chainInfo.length})\n\nThe Batch view will submit them in order automatically for you.\n\nClick to select all changes in this chain.`
											: 'This change is part of a relation chain.\n\nClick to select all changes in this chain.'
								}
								onClick={handleChainBadgeClick}
								role="button"
								tabIndex={0}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										handleChainBadgeClick(
											e as unknown as React.MouseEvent
										);
									}
								}}
							>
								<span className="codicon codicon-link"></span>
								{chainInfo.chainNumber && (
									<span className="chain-id">
										#{chainInfo.chainNumber}
									</span>
								)}
								{chainInfo.position != null &&
									chainInfo.length != null && (
										<span className="chain-position">
											{chainInfo.position}/
											{chainInfo.length}
										</span>
									)}
							</span>
						)}
					</div>
					<div className="change-details">
						<span className="change-project">{change.project}</span>
						<span className="change-branch">{change.branch}</span>
						<span className="change-owner">
							{change.owner.name}
						</span>
					</div>
				</div>
				<button
					className="open-online-button"
					onClick={(e) => {
						e.stopPropagation();
						vscode.postMessage({
							type: 'openChangeOnline',
							body: {
								changeID: change.changeID,
								project: change.project,
								number: change.number,
							},
						});
					}}
					title="Open in Gerrit"
				>
					<span className="codicon codicon-globe"></span>
				</button>
			</div>
			{expanded && (
				<div className="files-container">
					{loadingFiles ? (
						<div className="files-loading">
							<span className="codicon codicon-loading codicon-modifier-spin"></span>
							<span>Loading files...</span>
						</div>
					) : change.files && change.files.length > 0 ? (
						fileViewMode === 'tree' ? (
							// Tree view - nested folders
							buildSimpleFileTree(change.files).map((node) => (
								<FolderItem
									key={node.path}
									node={node}
									changeID={change.changeID}
									depth={0}
								/>
							))
						) : (
							// List view - flat list
							change.files.map((file) => (
								<FileItem
									key={file.filePath}
									file={file}
									changeID={change.changeID}
								/>
							))
						)
					) : (
						<div className="files-empty">No files found</div>
					)}
				</div>
			)}
		</div>
	);
};
