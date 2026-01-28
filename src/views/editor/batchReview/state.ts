import { BatchReviewChange } from './types';

export interface BatchReviewState {
	yourTurnChanges: BatchReviewChange[];
	batchChanges: BatchReviewChange[];
	loading: boolean;
}
