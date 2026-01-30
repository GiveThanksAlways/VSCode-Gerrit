export interface GetChainInfoMessage {
	type: 'getChainInfo';
	body: {
		changeID: string;
	};
}

export interface ChainInfoMessage {
	type: 'chainInfo';
	body: {
		changeID: string;
		inChain: boolean;
		position?: number;
		length?: number;
	};
}
import { BatchReviewState } from './state';

export interface GetIncomingReviewsMessage {
	type: 'getIncomingReviews';
}

/** @deprecated Use GetIncomingReviewsMessage instead */
export interface GetYourTurnChangesMessage {
	type: 'getYourTurnChanges';
}

export interface Plus2AllMessage {
	type: 'plus2All';
}

export interface Plus2AllAndSubmitMessage {
	type: 'plus2AllAndSubmit';
}

export interface AddToBatchMessage {
	type: 'addToBatch';
	body: {
		changeIDs: string[];
		dropIndex?: number;
	};
}

export interface RemoveFromBatchMessage {
	type: 'removeFromBatch';
	body: {
		changeIDs: string[];
		dropIndex?: number;
	};
}

export interface ClearBatchMessage {
	type: 'clearBatch';
}

export interface SubmitBatchVoteMessage {
	type: 'submitBatchVote';
	body: {
		/** Label votes, e.g. { "Code-Review": 1 } */
		labels: Record<string, number>;
		message?: string;
		resolved?: boolean;
		/** Reviewer IDs to add */
		reviewers?: (string | number)[];
		/** CC IDs to add */
		cc?: (string | number)[];
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

export interface GetPeopleMessage {
	type: 'getPeople';
	body: {
		query?: string;
		isCC: boolean;
	};
}

export interface SubmitBatchMessage {
	type: 'submitBatch';
}

export interface SetFileViewModeMessage {
	type: 'setFileViewMode';
	body: {
		mode: 'list' | 'tree';
	};
}

export interface OpenChangeOnlineMessage {
	type: 'openChangeOnline';
	body: {
		changeID: string;
		project: string;
		number: number;
	};
}

export interface ReorderChangesMessage {
	type: 'reorderChanges';
	body: {
		changeIDs: string[];
		targetList: 'yourTurn' | 'batch';
		dropIndex: number;
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
	| GetIncomingReviewsMessage
	| Plus2AllMessage
	| Plus2AllAndSubmitMessage
	| AddToBatchMessage
	| RemoveFromBatchMessage
	| ClearBatchMessage
	| SubmitBatchVoteMessage
	| InspectBatchMessage
	| StartAutomationMessage
	| StopAutomationMessage
	| GetFilesForChangeMessage
	| OpenFileDiffMessage
	| GetPeopleMessage
	| SubmitBatchMessage
	| SetFileViewModeMessage
	| OpenChangeOnlineMessage
	| ReorderChangesMessage
	| GetChainInfoMessage
	| ChainInfoMessage
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
