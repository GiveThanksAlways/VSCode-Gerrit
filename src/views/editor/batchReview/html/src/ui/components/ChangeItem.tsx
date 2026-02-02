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
}

interface ExpandableChangeItemProps {
	change: BatchReviewChange;
	selected: boolean;
	onSelectionChange: (changeID: string, selected: boolean) => void;
	showScore?: boolean;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent, changeID: string) => void;
	onDragOver?: (e: React.DragEvent, index: number) => void;
	fileViewMode?: 'list' | 'tree';
	index: number;
	onItemClick?: (
		changeID: string,
		index: number,
		e: React.MouseEvent
	) => void;
	showDropIndicator?: 'before' | 'after' | null;
	/** Chain info for highlighting */
	chainInfo?: ChainInfo;
}

export const ExpandableChangeItem: VFC<ExpandableChangeItemProps> = ({
	change,
	selected,
	onSelectionChange,
	showScore = false,
	draggable = false,
	onDragStart,
	onDragOver,
	fileViewMode = 'tree',
	index,
	onItemClick,
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

	const handleRowClick = (e: React.MouseEvent) => {
		// Always call onItemClick to handle selection and set anchor
		// For shift/ctrl clicks, do multi-select
		// For plain clicks, just set the anchor for future shift-clicks
		if (e.shiftKey || e.ctrlKey || e.metaKey) {
			e.preventDefault();
		}
		onItemClick?.(change.changeID, index, e);
	};

	const handleItemDragOver = (e: React.DragEvent) => {
		if (onDragOver) {
			onDragOver(e, index);
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
				<label className="change-checkbox">
					<input
						type="checkbox"
						checked={selected}
						onChange={(e) => {
							onSelectionChange(
								change.changeID,
								e.target.checked
							);
						}}
					/>
					<div className="change-info">
						<div className="change-header">
							<span className="change-number">
								#{change.number}
							</span>
							<span
								className="change-subject"
								title={change.subject}
							>
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
									className={`chain-badge ${chainInfo.hasUnsubmittedDependencies ? 'chain-warning-badge' : ''}`}
									title={
										chainInfo.hasUnsubmittedDependencies
											? `This change is part of a chain (${chainInfo.position} of ${chainInfo.length}) but has unsubmitted dependencies. Submit changes in order starting from #1.`
											: chainInfo.position != null &&
												  chainInfo.length != null
												? `This change is part of a relation chain (${chainInfo.position} of ${chainInfo.length}).\n\nThe Batch view will submit them in order automatically for you. You just have to make sure you have a connected chain that goes in order 1,2,3...`
												: 'This change is part of a relation chain. Submit all changes in order, starting from the base.'
									}
								>
									<span className="codicon codicon-link"></span>
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
							<span className="change-project">
								{change.project}
							</span>
							<span className="change-branch">
								{change.branch}
							</span>
							<span className="change-owner">
								{change.owner.name}
							</span>
						</div>
					</div>
				</label>
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
