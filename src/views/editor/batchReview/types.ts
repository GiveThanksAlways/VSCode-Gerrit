import { Event, Webview, WebviewPanel } from 'vscode';

export interface TypedWebview<M> extends Webview {
	postMessage(message: M): Promise<boolean>;
	onDidReceiveMessage: Event<M>;
}

export interface TypedWebviewPanel<M> extends WebviewPanel {
	webview: TypedWebview<M>;
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
}
