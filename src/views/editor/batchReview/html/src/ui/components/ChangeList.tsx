import { ExpandableChangeItem, ChainInfo, SelectionEvent } from './ChangeItem';
import React, { VFC, useState, useEffect, useCallback } from 'react';
import { BatchReviewChange } from '../../../../types';

interface ChangeListProps {
	changes: BatchReviewChange[];
	selectedChanges: Set<string>;
	onSelectionChange: (changeID: string, selected: boolean) => void;
	onSelectAll: (selected: boolean) => void;
	onMultiSelect: (changeIDs: string[], mode: 'add' | 'replace') => void;
	title: string;
	showScores?: boolean;
	listType: 'yourTurn' | 'batch';
	onDragStart: (
		e: React.DragEvent,
		changeID: string,
		listType: 'yourTurn' | 'batch'
	) => void;
	onDrop: (
		e: React.DragEvent,
		targetListType: 'yourTurn' | 'batch',
		dropIndex?: number
	) => void;
	fileViewMode?: 'list' | 'tree';
	onFileViewModeChange?: (mode: 'list' | 'tree') => void;
	/** Chain info map for highlighting batch items */
	chainInfoMap?: Map<string, ChainInfo>;
}

export const ChangeList: VFC<ChangeListProps> = ({
	changes,
	selectedChanges,
	onSelectionChange,
	onSelectAll,
	onMultiSelect,
	title,
	showScores = false,
	listType,
	onDragStart,
	onDrop,
	fileViewMode = 'tree',
	onFileViewModeChange,
	chainInfoMap,
}) => {
	const allSelected =
		changes.length > 0 &&
		changes.every((c) => selectedChanges.has(c.changeID));
	const [isDragOver, setIsDragOver] = useState(false);
	// Anchor changeID: the starting point for shift-click range selection
	// We track by changeID instead of index so it survives reordering
	const [anchorChangeID, setAnchorChangeID] = useState<string | null>(null);
	// Track drop target index for reordering
	const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

	// Compute anchor index from changeID - this automatically updates when list reorders
	const anchorIndex = anchorChangeID
		? changes.findIndex((c) => c.changeID === anchorChangeID)
		: null;
	// If the anchored change was removed from the list, reset anchor
	useEffect(() => {
		if (anchorChangeID && anchorIndex === -1) {
			setAnchorChangeID(null);
		}
	}, [anchorChangeID, anchorIndex]);

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		setIsDragOver(true);
	};

	const handleDragLeave = (e: React.DragEvent) => {
		// Only reset if leaving the list entirely, not just moving between items
		const relatedTarget = e.relatedTarget as Node | null;
		const container = e.currentTarget as HTMLElement;
		if (!relatedTarget || !container.contains(relatedTarget)) {
			setIsDragOver(false);
			setDropTargetIndex(null);
		}
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);
		const targetIndex = dropTargetIndex;
		setDropTargetIndex(null);
		onDrop(e, listType, targetIndex ?? undefined);
	};

	const handleItemDragStart = (e: React.DragEvent, changeID: string) => {
		onDragStart(e, changeID, listType);
	};

	const handleItemDragOver = (e: React.DragEvent, index: number) => {
		e.preventDefault();
		e.stopPropagation();
		// Determine if we should drop above or below based on mouse position
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const midpoint = rect.top + rect.height / 2;
		// If mouse is above midpoint, insert before this item, else after
		const insertIndex = e.clientY < midpoint ? index : index + 1;
		setDropTargetIndex(insertIndex);
	};

	/**
	 * Unified selection event handler.
	 * Implements robust multi-select behavior following standard conventions:
	 *
	 * - toggle: Toggle single item selection (checkbox or Ctrl+click or plain click)
	 * - range: Select range from anchor to clicked item (Shift+click)
	 * - anchor: Just set anchor point without changing selection (no longer used)
	 * - chain: Select all items belonging to a specific chain
	 */
	const handleSelectionEvent = useCallback(
		(event: SelectionEvent) => {
			const { changeID, index, action, chainNumber } = event;

			switch (action) {
				case 'toggle': {
					// Toggle single item and set anchor
					const isCurrentlySelected = selectedChanges.has(changeID);
					onSelectionChange(changeID, !isCurrentlySelected);
					setAnchorChangeID(changeID);
					break;
				}

				case 'range': {
					// Select range from anchor to current
					// If no anchor set, start from current position
					const startIndex =
						anchorIndex !== null && anchorIndex >= 0
							? anchorIndex
							: index;
					const fromIdx = Math.min(startIndex, index);
					const toIdx = Math.max(startIndex, index);
					const rangeIDs = changes
						.slice(fromIdx, toIdx + 1)
						.map((c) => c.changeID);

					// Add range to current selection
					onMultiSelect(rangeIDs, 'add');
					// Keep anchor stable for chained shift-clicks
					// But if there was no anchor, set current as anchor
					if (anchorIndex === null || anchorIndex < 0) {
						setAnchorChangeID(changeID);
					}
					break;
				}

				case 'anchor': {
					// Just set anchor for future shift-clicks (currently unused)
					setAnchorChangeID(changeID);
					break;
				}

				case 'chain': {
					// Toggle all items in the specified chain
					// If all are selected, deselect them. Otherwise, select them.
					if (chainNumber) {
						const chainChangeIDs: string[] = [];
						for (const change of changes) {
							// Check chainInfoMap first (batch view), otherwise we can't
							// match chains across items without the map
							const info = chainInfoMap?.get(change.changeId);
							if (info?.chainNumber === chainNumber) {
								chainChangeIDs.push(change.changeID);
							}
						}
						if (chainChangeIDs.length > 0) {
							// Check if all chain items are currently selected
							const allSelected = chainChangeIDs.every((id) =>
								selectedChanges.has(id)
							);
							if (allSelected) {
								// Deselect all chain items
								for (const id of chainChangeIDs) {
									onSelectionChange(id, false);
								}
							} else {
								// Select all chain items
								onMultiSelect(chainChangeIDs, 'add');
							}
						}
					}
					setAnchorChangeID(changeID);
					break;
				}
			}
		},
		[
			changes,
			selectedChanges,
			anchorIndex,
			chainInfoMap,
			onSelectionChange,
			onMultiSelect,
		]
	);

	return (
		<div
			className={`change-list ${isDragOver ? 'drag-over' : ''}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<div className="list-header">
				<h2>{title}</h2>
				<div className="list-header-actions">
					{onFileViewModeChange && (
						<div
							className="view-mode-toggle"
							title="Toggle file view mode"
						>
							<button
								className={`view-mode-btn ${fileViewMode === 'list' ? 'active' : ''}`}
								onClick={() => onFileViewModeChange('list')}
								title="View as List"
							>
								<span className="codicon codicon-list-flat"></span>
							</button>
							<button
								className={`view-mode-btn ${fileViewMode === 'tree' ? 'active' : ''}`}
								onClick={() => onFileViewModeChange('tree')}
								title="View as Tree"
							>
								<span className="codicon codicon-list-tree"></span>
							</button>
						</div>
					)}
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
			</div>
			<div className="changes-container">
				{changes.length === 0 ? (
					<div className="empty-message drop-hint">
						{isDragOver ? 'Drop here to add' : 'No changes'}
					</div>
				) : (
					changes.map((change, index) => {
						// Determine if this item should show a drop indicator
						let indicator: 'before' | 'after' | null = null;
						if (dropTargetIndex === index) {
							indicator = 'before';
						} else if (dropTargetIndex === index + 1) {
							indicator = 'after';
						}
						return (
							<ExpandableChangeItem
								key={change.changeID}
								change={change}
								selected={selectedChanges.has(change.changeID)}
								onSelectionEvent={handleSelectionEvent}
								showScore={showScores}
								draggable={true}
								onDragStart={handleItemDragStart}
								onDragOver={handleItemDragOver}
								fileViewMode={fileViewMode}
								index={index}
								showDropIndicator={indicator}
								chainInfo={chainInfoMap?.get(change.changeId)}
							/>
						);
					})
				)}
			</div>
		</div>
	);
};
