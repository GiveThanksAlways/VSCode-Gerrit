import { Event, Webview, WebviewPanel } from 'vscode';

export interface TypedWebview<M> extends Webview {
	postMessage(message: M): Promise<boolean>;
	onDidReceiveMessage: Event<M>;
}

export interface TypedWebviewPanel<M> extends WebviewPanel {
	webview: TypedWebview<M>;
}

export interface BatchReviewFileInfo {
	filePath: string;
	status: 'A' | 'M' | 'D' | 'R' | 'C' | 'W' | 'X' | null;
	linesInserted: number;
	linesDeleted: number;
}

export interface BatchReviewChange {
	changeID: string;
	number: number;
	subject: string;
	project: string;
	branch: string;
	owner: {
		name: string;
		accountID: number;
	};
	updated: string;
	/**
	 * Optional AI confidence score (1-10) for ranking.
	 * Higher scores indicate higher AI confidence.
	 */
	score?: number;
	/**
	 * Files changed in this commit. Loaded on demand when expanded.
	 */
	files?: BatchReviewFileInfo[];
	/**
	 * Whether files have been loaded for this change.
	 */
	filesLoaded?: boolean;
}
