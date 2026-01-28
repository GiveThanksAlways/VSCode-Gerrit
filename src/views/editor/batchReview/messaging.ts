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
	| {
			type: 'batchVoteSuccess';
			body: {
				successCount: number;
				failureCount: number;
			};
	  }
	| {
			type: 'batchVoteFailed';
	  };
