import { BatchReviewFileInfo } from '../../../../types';
import React, { VFC, useState } from 'react';
import { vscode } from '../../lib/api';

// Type for file tree structure
export interface FileTreeNode {
	name: string;
	path: string;
	isFolder: boolean;
	children?: FileTreeNode[];
	file?: BatchReviewFileInfo;
}

// Build a tree structure from flat file list
export function buildSimpleFileTree(
	files: BatchReviewFileInfo[]
): FileTreeNode[] {
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
	folderMap.forEach((_, folderPath) => {
		if (folderPath === '') return;
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
	});

	// Link folders together
	folders.forEach((node, path) => {
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
	});

	// Add files to their folders
	folderMap.forEach((folderFiles, folderPath) => {
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
					folder.children.push({
						name: file.filePath.split('/').pop()!,
						path: file.filePath,
						isFolder: false,
						file,
					});
				}
			}
		}
	});

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

// Shared helper for file status icons
export const getStatusIcon = (status: BatchReviewFileInfo['status']) => {
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

interface TreeFileItemProps {
	file: BatchReviewFileInfo;
	changeID: string;
	depth: number;
	displayName: string;
}

export const TreeFileItem: VFC<TreeFileItemProps> = ({
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

interface FolderItemProps {
	node: FileTreeNode;
	changeID: string;
	depth: number;
}

export const FolderItem: VFC<FolderItemProps> = ({ node, changeID, depth }) => {
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

interface FileItemProps {
	file: BatchReviewFileInfo;
	changeID: string;
}

export const FileItem: VFC<FileItemProps> = ({ file, changeID }) => {
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
