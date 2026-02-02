import { ExpandableChangeItem, ChainInfo, SelectionEvent } from './ChangeItem';
import React, { VFC, useState, useEffect, useRef, useCallback } from 'react';
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
	// Anchor index: the starting point for shift-click range selection
	const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
	// Track the previous changes array to detect reordering/modifications
	const prevChangesRef = useRef<BatchReviewChange[]>(changes);
	// Track drop target index for reordering
	const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

	// Reset anchor when changes array is modified (items added, removed, or reordered)
	useEffect(() => {
		const prevChanges = prevChangesRef.current;
		const changesModified =
			changes.length !== prevChanges.length ||
			changes.some((c, i) => prevChanges[i]?.changeID !== c.changeID);

		if (changesModified) {
			setAnchorIndex(null);
		}
		prevChangesRef.current = changes;
	}, [changes]);

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
	 * - toggle: Toggle single item selection (checkbox or Ctrl+click)
	 * - range: Select range from anchor to clicked item (Shift+click)
	 * - anchor: Just set anchor point without changing selection (plain row click)
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
					setAnchorIndex(index);
					break;
				}

				case 'range': {
					// Select range from anchor to current
					const startIndex = anchorIndex ?? 0;
					const fromIdx = Math.min(startIndex, index);
					const toIdx = Math.max(startIndex, index);
					const rangeIDs = changes
						.slice(fromIdx, toIdx + 1)
						.map((c) => c.changeID);

					// Add range to current selection
					onMultiSelect(rangeIDs, 'add');
					// Keep anchor stable for chained shift-clicks
					break;
				}

				case 'anchor': {
					// Just set anchor for future shift-clicks
					setAnchorIndex(index);
					break;
				}

				case 'chain': {
					// Select all items in the specified chain
					if (chainNumber && chainInfoMap) {
						const chainChangeIDs: string[] = [];
						for (const change of changes) {
							const info = chainInfoMap.get(change.changeId);
							if (info?.chainNumber === chainNumber) {
								chainChangeIDs.push(change.changeID);
							}
						}
						if (chainChangeIDs.length > 0) {
							onMultiSelect(chainChangeIDs, 'add');
						}
					}
					setAnchorIndex(index);
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
