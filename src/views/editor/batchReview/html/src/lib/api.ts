import { BatchReviewWebviewMessage } from '../../../messaging';

declare const acquireVsCodeApi: () => {
	postMessage: (message: BatchReviewWebviewMessage) => void;
	getState: () => unknown;
	setState: (state: unknown) => void;
};

export const vscode = acquireVsCodeApi();
