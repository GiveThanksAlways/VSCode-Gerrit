import {
	BatchReviewState,
	BatchReviewPerson,
	BatchReviewLabel,
} from '../../../state';
import React, { VFC, useState, useEffect, useCallback, useMemo } from 'react';
import { BatchReviewChange, BatchReviewFileInfo } from '../../../types';
import { vscode } from '../lib/api';

// Type for file tree structure
interface FileTreeNode {
	name: string;
	path: string;
	isFolder: boolean;
	children?: FileTreeNode[];
	file?: BatchReviewFileInfo;
}

// Build a tree structure from flat file list
function buildFileTree(files: BatchReviewFileInfo[]): FileTreeNode[] {
	const root: Record<string, FileTreeNode> = {};

	for (const file of files) {
		const parts = file.filePath.split('/');
		let current = root;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const isLast = i === parts.length - 1;
			const path = parts.slice(0, i + 1).join('/');

			if (isLast) {
				current[part] = {
					name: part,
					path,
					isFolder: false,
					file,
				};
			} else {
				if (!current[part]) {
					current[part] = {
						name: part,
						path,
						isFolder: true,
						children: [],
					};
				}
				// Move into the folder's children map
				if (!current[part].children) {
					current[part].children = [];
				}
				// Use a helper map for nested traversal
				const childMap: Record<string, FileTreeNode> = {};
				for (const child of current[part].children || []) {
					childMap[child.name] = child;
				}
				current = childMap as unknown as Record<string, FileTreeNode>;
			}
		}
	}

	// Convert to array format recursively
	function toArray(map: Record<string, FileTreeNode>): FileTreeNode[] {
		return Object.values(map).sort((a, b) => {
			// Folders first, then files
			if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}

	return toArray(root);
}

// Simpler tree builder that actually works
function buildSimpleFileTree(files: BatchReviewFileInfo[]): FileTreeNode[] {
	const folderMap = new Map<string, BatchReviewFileInfo[]>();

	for (const file of files) {
		const parts = file.filePath.split('/');
		if (parts.length === 1) {
			// Root level file
			const key = '';
			if (!folderMap.has(key)) folderMap.set(key, []);
			folderMap.get(key)!.push(file);
		} else {
			// File in a folder - group by first folder
			const folderPath = parts.slice(0, -1).join('/');
			if (!folderMap.has(folderPath)) folderMap.set(folderPath, []);
			folderMap.get(folderPath)!.push(file);
		}
	}

	// Build tree nodes
	const nodes: FileTreeNode[] = [];
	const folders = new Map<string, FileTreeNode>();

	// Create folder nodes
	for (const [folderPath] of folderMap) {
		if (folderPath === '') continue;
		const parts = folderPath.split('/');
		let currentPath = '';
		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			if (!folders.has(currentPath)) {
				folders.set(currentPath, {
					name: part,
					path: currentPath,
					isFolder: true,
					children: [],
				});
			}
		}
	}

	// Link folders together
	for (const [path, node] of folders) {
		const parts = path.split('/');
		if (parts.length === 1) {
			nodes.push(node);
		} else {
			const parentPath = parts.slice(0, -1).join('/');
			const parent = folders.get(parentPath);
			if (parent && parent.children) {
				parent.children.push(node);
			}
		}
	}

	// Add files to their folders
	for (const [folderPath, folderFiles] of folderMap) {
		if (folderPath === '') {
			// Root level files
			for (const file of folderFiles) {
				nodes.push({
					name: file.filePath,
					path: file.filePath,
					isFolder: false,
					file,
				});
			}
		} else {
			const folder = folders.get(folderPath);
			if (folder && folder.children) {
				for (const file of folderFiles) {
					const fileName =
						file.filePath.split('/').pop() || file.filePath;
					folder.children.push({
						name: fileName,
						path: file.filePath,
						isFolder: false,
						file,
					});
				}
			}
		}
	}

	// Sort nodes (folders first, then alphabetically)
	const sortNodes = (nodeList: FileTreeNode[]): FileTreeNode[] => {
		nodeList.sort((a, b) => {
			if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		for (const node of nodeList) {
			if (node.children) {
				sortNodes(node.children);
			}
		}
		return nodeList;
	};

	return sortNodes(nodes);
}

interface FolderItemProps {
	node: FileTreeNode;
	changeID: string;
	depth: number;
}

const FolderItem: VFC<FolderItemProps> = ({ node, changeID, depth }) => {
	const [expanded, setExpanded] = useState(true);

	if (!node.isFolder && node.file) {
		// Render file
		return (
			<TreeFileItem
				file={node.file}
				changeID={changeID}
				depth={depth}
				displayName={node.name}
			/>
		);
	}

	// Render folder
	return (
		<div className="tree-folder">
			<div
				className="tree-folder-header"
				style={{ paddingLeft: `${depth * 12}px` }}
				onClick={() => setExpanded(!expanded)}
			>
				<span
					className={`codicon ${
						expanded
							? 'codicon-chevron-down'
							: 'codicon-chevron-right'
					}`}
				></span>
				<span className="codicon codicon-folder"></span>
				<span className="folder-name">{node.name}</span>
			</div>
			{expanded && node.children && (
				<div className="tree-folder-children">
					{node.children.map((child) => (
						<FolderItem
							key={child.path}
							node={child}
							changeID={changeID}
							depth={depth + 1}
						/>
					))}
				</div>
			)}
		</div>
	);
};

interface TreeFileItemProps {
	file: BatchReviewFileInfo;
	changeID: string;
	depth: number;
	displayName: string;
}

const TreeFileItem: VFC<TreeFileItemProps> = ({
	file,
	changeID,
	depth,
	displayName,
}) => {
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
				return (
					<span className="file-status file-status-deleted">D</span>
				);
			case 'R':
				return (
					<span className="file-status file-status-renamed">R</span>
				);
			case 'M':
			default:
				return (
					<span className="file-status file-status-modified">M</span>
				);
		}
	};

	return (
		<div
			className="file-item tree-file-item"
			style={{ paddingLeft: `${depth * 12 + 16}px` }}
			onClick={handleFileClick}
			onKeyDown={handleKeyDown}
			tabIndex={0}
			role="button"
			aria-label={`Open diff for ${file.filePath}`}
		>
			<span className="codicon codicon-file"></span>
			{getStatusIcon(file.status)}
			<span className="file-path">{displayName}</span>
			<span className="file-stats">
				{file.linesInserted > 0 && (
					<span className="file-additions">
						+{file.linesInserted}
					</span>
				)}
				{file.linesDeleted > 0 && (
					<span className="file-deletions">-{file.linesDeleted}</span>
				)}
			</span>
		</div>
	);
};

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
				return (
					<span className="file-status file-status-deleted">D</span>
				);
			case 'R':
				return (
					<span className="file-status file-status-renamed">R</span>
				);
			case 'M':
			default:
				return (
					<span className="file-status file-status-modified">M</span>
				);
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
					<span className="file-additions">
						+{file.linesInserted}
					</span>
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
	fileViewMode?: 'list' | 'tree';
	index: number;
	onItemClick?: (
		changeID: string,
		index: number,
		e: React.MouseEvent
	) => void;
}

const ExpandableChangeItem: VFC<ExpandableChangeItemProps> = ({
	change,
	selected,
	onSelectionChange,
	showScore = false,
	draggable = false,
	onDragStart,
	fileViewMode = 'tree',
	index,
	onItemClick,
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

	const handleRowClick = (e: React.MouseEvent) => {
		// Always call onItemClick to handle selection and set anchor
		// For shift/ctrl clicks, do multi-select
		// For plain clicks, just set the anchor for future shift-clicks
		if (e.shiftKey || e.ctrlKey || e.metaKey) {
			e.preventDefault();
		}
		onItemClick?.(change.changeID, index, e);
	};

	return (
		<div
			className={`change-item ${selected ? 'selected' : ''} ${draggable ? 'draggable' : ''}`}
			draggable={draggable}
			onDragStart={handleDragStart}
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
						onClick={(e) => {
							// If shift or ctrl is pressed, handle multi-select
							if (e.shiftKey || e.ctrlKey || e.metaKey) {
								e.preventDefault();
								e.stopPropagation();
								onItemClick?.(change.changeID, index, e);
							}
						}}
						onChange={(e) =>
							onSelectionChange(change.changeID, e.target.checked)
						}
					/>
					<div className="change-info">
						<div className="change-header">
							<span className="change-number">
								#{change.number}
							</span>
							<span className="change-subject">
								{change.subject}
							</span>
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
	onDrop: (e: React.DragEvent, targetListType: 'yourTurn' | 'batch') => void;
	fileViewMode?: 'list' | 'tree';
	onFileViewModeChange?: (mode: 'list' | 'tree') => void;
}

const ChangeList: VFC<ChangeListProps> = ({
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
}) => {
	const allSelected =
		changes.length > 0 &&
		changes.every((c) => selectedChanges.has(c.changeID));
	const [isDragOver, setIsDragOver] = useState(false);
	// Anchor index: the starting point for shift-click range selection
	const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
	// Track the previous changes array to detect reordering/modifications
	const prevChangesRef = React.useRef<BatchReviewChange[]>(changes);

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

	/**
	 * Robust multi-select state machine:
	 * - Shift+Click: Select range from anchor to current (add to existing selection)
	 * - Ctrl/Cmd+Click: Toggle individual item, set new anchor
	 * - Plain Click: Select single item (via checkbox handler), set anchor
	 */
	const handleItemClick = (
		changeID: string,
		index: number,
		e: React.MouseEvent
	) => {
		e.stopPropagation();

		if (e.shiftKey) {
			// Shift+Click: Select range from anchor (or 0 if no anchor) to current index
			const startIndex = anchorIndex ?? 0;
			const fromIdx = Math.min(startIndex, index);
			const toIdx = Math.max(startIndex, index);
			const rangeIDs = changes
				.slice(fromIdx, toIdx + 1)
				.map((c) => c.changeID);

			// Add range to current selection (don't replace)
			onMultiSelect(rangeIDs, 'add');
			// Don't update anchor on shift-click - keep it stable for chaining
		} else if (e.ctrlKey || e.metaKey) {
			// Ctrl/Cmd+Click: Toggle this item and set new anchor
			onSelectionChange(changeID, !selectedChanges.has(changeID));
			setAnchorIndex(index);
		} else {
			// Plain click: Set anchor for future shift-clicks
			setAnchorIndex(index);
		}
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
					changes.map((change, index) => (
						<ExpandableChangeItem
							key={change.changeID}
							change={change}
							selected={selectedChanges.has(change.changeID)}
							onSelectionChange={onSelectionChange}
							showScore={showScores}
							draggable={true}
							onDragStart={handleItemDragStart}
							fileViewMode={fileViewMode}
							index={index}
							onItemClick={handleItemClick}
						/>
					))
				)}
			</div>
		</div>
	);
};

// ===== Review Panel Components =====

interface ScorePickerProps {
	label: BatchReviewLabel;
	value: number;
	onChange: (name: string, value: number) => void;
}

const ScorePicker: VFC<ScorePickerProps> = ({ label, value, onChange }) => {
	const getScoreStyle = (score: string): string => {
		const scoreNum = parseInt(score.trim(), 10);
		const allValues = label.possibleValues.map((v) =>
			parseInt(v.score.trim(), 10)
		);

		if (scoreNum === 0) return 'score-neutral';
		if (scoreNum === Math.max(...allValues)) return 'score-approved';
		if (scoreNum === Math.min(...allValues)) return 'score-rejected';
		if (scoreNum > 0) return 'score-recommended';
		return 'score-disliked';
	};

	return (
		<div className="score-picker">
			<span className="score-label">{label.name}:</span>
			<div className="score-buttons">
				{label.possibleValues.map((pv, i) => {
					const scoreNum = parseInt(pv.score.trim(), 10);
					const isSelected = value === scoreNum;
					return (
						<button
							key={i}
							className={`score-button ${isSelected ? getScoreStyle(pv.score) : ''}`}
							onClick={() => onChange(label.name, scoreNum)}
							title={pv.description}
						>
							{pv.score.trim()}
						</button>
					);
				})}
			</div>
		</div>
	);
};

interface PeoplePickerProps {
	label: string;
	people: BatchReviewPerson[];
	suggestions: BatchReviewPerson[];
	onChange: (people: BatchReviewPerson[]) => void;
	onSearch: (query: string) => void;
	placeholder?: string;
}

const PeoplePicker: VFC<PeoplePickerProps> = ({
	label,
	people,
	suggestions,
	onChange,
	onSearch,
	placeholder,
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const containerRef = React.useRef<HTMLDivElement>(null);

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen]);

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setQuery(value);
		setIsOpen(true);
		onSearch(value);
	};

	const handleFocus = () => {
		setIsOpen(true);
		// Trigger search with empty query to load suggestions immediately
		onSearch(query);
	};

	const handleSelect = (person: BatchReviewPerson) => {
		if (!person.locked && !people.some((p) => p.id === person.id)) {
			onChange([...people, person]);
		}
		setQuery('');
		setIsOpen(false);
	};

	const handleRemove = (personId: string | number) => {
		onChange(people.filter((p) => p.id !== personId && !p.locked));
	};

	const filteredSuggestions = suggestions.filter(
		(s) => !people.some((p) => p.id === s.id)
	);

	return (
		<div className="people-picker" ref={containerRef}>
			<span className="picker-label">{label}:</span>
			<div className="picker-input-container">
				<div className="selected-people">
					{people.map((person) => (
						<span
							key={person.id}
							className="person-chip"
							title={person.name}
						>
							{person.shortName}
							{!person.locked && (
								<button
									className="remove-person"
									onClick={() => handleRemove(person.id)}
								>
									×
								</button>
							)}
						</span>
					))}
				</div>
				<input
					type="text"
					value={query}
					onChange={handleInputChange}
					onFocus={handleFocus}
					placeholder={placeholder}
					className="people-input"
				/>
				{isOpen && filteredSuggestions.length > 0 && (
					<div className="suggestions-dropdown">
						{filteredSuggestions.map((person) => (
							<div
								key={person.id}
								className="suggestion-item"
								onClick={() => handleSelect(person)}
							>
								{person.name}
							</div>
						))}
					</div>
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
	const [labelValues, setLabelValues] = useState<Record<string, number>>({});
	const [resolved, setResolved] = useState<boolean>(true);
	const [reviewers, setReviewers] = useState<BatchReviewPerson[]>([]);
	const [ccList, setCcList] = useState<BatchReviewPerson[]>([]);
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
			setSelectedBatch(
				new Set(state.batchChanges.map((c) => c.changeID))
			);
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

	/**
	 * Helper to apply multi-select operation to a Set
	 */
	const applyMultiSelect = (
		prev: Set<string>,
		changeIDs: string[],
		mode: 'add' | 'replace'
	): Set<string> => {
		if (mode === 'replace') {
			return new Set(changeIDs);
		}
		// mode === 'add'
		const newSet = new Set(prev);
		changeIDs.forEach((id) => newSet.add(id));
		return newSet;
	};

	const handleYourTurnMultiSelect = (
		changeIDs: string[],
		mode: 'add' | 'replace'
	) => {
		setSelectedYourTurn((prev) => applyMultiSelect(prev, changeIDs, mode));
	};

	const handleBatchMultiSelect = (
		changeIDs: string[],
		mode: 'add' | 'replace'
	) => {
		setSelectedBatch((prev) => applyMultiSelect(prev, changeIDs, mode));
	};

	const handleFileViewModeChange = (mode: 'list' | 'tree') => {
		vscode.postMessage({
			type: 'setFileViewMode',
			body: { mode },
		});
	};

	const handleLabelChange = (name: string, value: number) => {
		setLabelValues((prev) => ({ ...prev, [name]: value }));
	};

	const handleReviewerSearch = (query: string) => {
		vscode.postMessage({
			type: 'getPeople',
			body: { query, isCC: false },
		});
	};

	const handleCCSearch = (query: string) => {
		vscode.postMessage({
			type: 'getPeople',
			body: { query, isCC: true },
		});
	};

	const handleSendReview = () => {
		if (state.batchChanges.length === 0) {
			alert('No changes in batch to review');
			return;
		}

		vscode.postMessage({
			type: 'submitBatchVote',
			body: {
				labels: labelValues,
				message: voteMessage.trim() || undefined,
				resolved,
				reviewers: reviewers.map((r) => r.id),
				cc: ccList.map((c) => c.id),
			},
		});
	};

	const handleSubmitPatch = () => {
		if (state.batchChanges.length === 0) {
			alert('No changes in batch to submit');
			return;
		}

		vscode.postMessage({ type: 'submitBatch' });
	};

	const handleRefresh = () => {
		vscode.postMessage({ type: 'getYourTurnChanges' });
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
					{automationStatus.running && (
						<div
							className="api-status api-status-running"
							title={`API server running on  127.0.0.1:${automationStatus.port}`}
						>
							<span className="codicon codicon-check"></span>
							<span className="api-port">Batch API</span>
						</div>
					)}
				</div>
			</div>

			<div className="lists-container">
				<div className="your-turn-section">
					<ChangeList
						changes={state.yourTurnChanges}
						selectedChanges={selectedYourTurn}
						onSelectionChange={handleYourTurnSelection}
						onSelectAll={handleYourTurnSelectAll}
						onMultiSelect={handleYourTurnMultiSelect}
						title="Your Turn"
						listType="yourTurn"
						onDragStart={handleDragStart}
						onDrop={handleDrop}
						fileViewMode={state.fileViewMode ?? 'tree'}
						onFileViewModeChange={handleFileViewModeChange}
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
						onMultiSelect={handleBatchMultiSelect}
						title="Batch"
						showScores={true}
						listType="batch"
						onDragStart={handleDragStart}
						onDrop={handleDrop}
						fileViewMode={state.fileViewMode ?? 'tree'}
						onFileViewModeChange={handleFileViewModeChange}
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
						<div className="review-panel">
							{/* Reviewers and CC */}
							<PeoplePicker
								label="Reviewers"
								people={reviewers}
								suggestions={state.suggestedReviewers ?? []}
								onChange={setReviewers}
								onSearch={handleReviewerSearch}
								placeholder="Add reviewers..."
							/>
							<PeoplePicker
								label="CC"
								people={ccList}
								suggestions={state.suggestedCC ?? []}
								onChange={setCcList}
								onSearch={handleCCSearch}
								placeholder="Add CC..."
							/>

							{/* Comment */}
							<div className="comment-section">
								<textarea
									className="vote-message"
									placeholder="Say something nice..."
									value={voteMessage}
									onChange={(e) =>
										setVoteMessage(e.target.value)
									}
									rows={3}
								/>
							</div>

							{/* Resolved checkbox */}
							<div className="resolved-section">
								<label className="checkbox-label">
									<input
										type="checkbox"
										checked={resolved}
										onChange={(e) =>
											setResolved(e.target.checked)
										}
									/>
									<span>Resolved</span>
								</label>
							</div>

							{/* Score pickers */}
							<div className="score-pickers">
								{(state.labels ?? []).map((label, i) => (
									<ScorePicker
										key={i}
										label={label}
										value={labelValues[label.name] ?? 0}
										onChange={handleLabelChange}
									/>
								))}
							</div>

							{/* Submit buttons */}
							<div className="submit-buttons">
								<button
									onClick={handleSubmitPatch}
									disabled={state.batchChanges.length === 0}
									className="button-submit"
									title="Submit all changes in batch"
								>
									<span className="codicon codicon-check-all"></span>
									Submit patch ({state.batchChanges.length})
								</button>
								<button
									onClick={handleSendReview}
									disabled={state.batchChanges.length === 0}
									className="button-send"
									title="Send review for all changes in batch"
								>
									<span className="codicon codicon-comment"></span>
									Send ({state.batchChanges.length})
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
