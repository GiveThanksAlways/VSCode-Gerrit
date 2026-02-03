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
	/**
	 * File status. In Gerrit API, files without a status field are modified.
	 * A = Added, D = Deleted, R = Renamed, M = Modified (default when no status)
	 */
	status: 'A' | 'M' | 'D' | 'R' | null;
	linesInserted: number;
	linesDeleted: number;
}

/**
 * Severity levels for AI code review scoring.
 * Follows software engineering standards for issue classification.
 */
export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'APPROVED';

export interface BatchReviewChange {
	changeID: string; // Gerrit REST id (project~branch~Ixxxx)
	changeId: string; // Gerrit Change-Id (Ixxxx...)
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
	 * Optional AI severity level for code review scoring.
	 * CRITICAL = needs immediate attention
	 * HIGH = significant issues found
	 * MEDIUM = moderate concerns
	 * LOW = minor issues
	 * APPROVED = no issues found
	 */
	severity?: SeverityLevel;
	/**
	 * Files changed in this commit. Loaded on demand when expanded.
	 */
	files?: BatchReviewFileInfo[];
	/**
	 * Whether files have been loaded for this change.
	 */
	filesLoaded?: boolean;
	/**
	 * Whether this change is submittable (can be merged).
	 */
	submittable?: boolean;
	/**
	 * Whether this change has Code-Review +2.
	 */
	hasCodeReviewPlus2?: boolean;
	/**
	 * Gerrit web URL for this change (if available)
	 */
	gerritUrl?: string;
}
