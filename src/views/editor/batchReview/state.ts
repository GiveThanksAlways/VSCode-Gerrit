import { BatchReviewChange } from './types';

/**
 * Represents a person (reviewer or CC) in the batch review.
 */
export interface BatchReviewPerson {
	id: string | number;
	name: string;
	shortName: string;
	locked?: boolean;
}

/**
 * Represents a label with its possible voting values.
 */
export interface BatchReviewLabel {
	name: string;
	possibleValues: {
		score: string;
		description: string;
	}[];
}

export interface BatchReviewState {
	yourTurnChanges: BatchReviewChange[];
	batchChanges: BatchReviewChange[];
	loading: boolean;
	/** Suggested reviewers for autocomplete */
	suggestedReviewers?: BatchReviewPerson[];
	/** Suggested CC for autocomplete */
	suggestedCC?: BatchReviewPerson[];
	/** Available labels (e.g., Code-Review, Verified) with their possible values */
	labels?: BatchReviewLabel[];
	/** File view mode: 'list' for flat list, 'tree' for nested tree */
	fileViewMode?: 'list' | 'tree';
}
