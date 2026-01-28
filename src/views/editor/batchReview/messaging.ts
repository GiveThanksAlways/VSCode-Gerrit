import { BatchReviewState } from './state';

export interface GetYourTurnChangesMessage {
	type: 'getYourTurnChanges';
}

export interface AddToBatchMessage {
	type: 'addToBatch';
	body: {
		changeIDs: string[];
	};
}

export interface RemoveFromBatchMessage {
	type: 'removeFromBatch';
	body: {
		changeIDs: string[];
	};
}

export interface ClearBatchMessage {
	type: 'clearBatch';
}

export interface SubmitBatchVoteMessage {
	type: 'submitBatchVote';
	body: {
		score: number; // +1 or +2
		message?: string;
	};
}

export interface InspectBatchMessage {
	type: 'inspectBatch';
}

export interface StartAutomationMessage {
	type: 'startAutomation';
}

export interface StopAutomationMessage {
	type: 'stopAutomation';
}

export interface GetFilesForChangeMessage {
	type: 'getFilesForChange';
	body: {
		changeID: string;
	};
}

export interface OpenFileDiffMessage {
	type: 'openFileDiff';
	body: {
		changeID: string;
		filePath: string;
	};
}

/**
 * Batch Review `postMessage` message types and their bodies.
 */
export type BatchReviewWebviewMessage =
	| {
			type: 'stateToView';
			body: {
				state: BatchReviewState;
			};
	  }
	| {
			type: 'initialize';
	  }
	| {
			type: 'ready';
	  }
	| GetYourTurnChangesMessage
	| AddToBatchMessage
	| RemoveFromBatchMessage
	| ClearBatchMessage
	| SubmitBatchVoteMessage
	| InspectBatchMessage
	| StartAutomationMessage
	| StopAutomationMessage
	| GetFilesForChangeMessage
	| OpenFileDiffMessage
	| {
			type: 'batchVoteSuccess';
			body: {
				successCount: number;
				failureCount: number;
			};
	  }
	| {
			type: 'batchVoteFailed';
	  }
	| {
			type: 'automationStatus';
			body: {
				running: boolean;
				port: number | null;
			};
	  };
