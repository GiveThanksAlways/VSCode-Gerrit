import { GerritChange } from '../../../lib/gerrit/gerritAPI/gerritChange';
import { getAPI } from '../../../lib/gerrit/gerritAPI';

/**
 * Fetches the related chain for a change.
 * Returns an array of {commit, change_id} in dependency order (base to tip).
 */
export interface ChangeChainEntry {
	commit: string;
	change_id: string;
}
export async function getChangeChain(
	changeId: string
): Promise<ChangeChainEntry[]> {
	const api = await getAPI();
	if (!api) {
		console.warn('[getChangeChain] No API instance for', changeId);
		return [];
	}
	const endpoint = `changes/${changeId}/revisions/current/related`;
	console.log(
		`[getChangeChain] Fetching chain for ${changeId} from endpoint: ${endpoint}`
	);
	const response = await api['_tryRequest']({
		path: endpoint,
		method: 'GET',
	});
	console.log('[getChangeChain] Raw response for', changeId, response);
	if (!response || !api['_assertRequestSucceeded'](response)) {
		console.warn(
			'[getChangeChain] No response or failed for',
			changeId,
			response
		);
		return [];
	}
	const json = api['_tryParseJSON']<{
		changes: { commit: string; change_id: string }[];
	}>(response.strippedBody);
	console.log('[getChangeChain] Parsed JSON for', changeId, json);
	if (!json?.changes || json.changes.length < 2) {
		console.log(
			'[getChangeChain] No chain or only one change for',
			changeId,
			json
		);
		return [];
	}
	const chain = json.changes.map((c) => ({
		commit: c.commit,
		change_id: c.change_id,
	}));
	console.log(`[getChangeChain] Chain for ${changeId}:`, chain);
	return chain;
}

/**
 * Given a batch of Change-Ids, returns a deduplicated, dependency-ordered array (by Change-Id), using commit order.
 */
export async function getOrderedBatch(changeIds: string[]): Promise<string[]> {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const id of changeIds) {
		const chain = await getChangeChain(id); // [{commit, change_id}]
		for (const entry of chain) {
			if (
				!seen.has(entry.change_id) &&
				changeIds.includes(entry.change_id)
			) {
				seen.add(entry.change_id);
				ordered.push(entry.change_id);
			}
		}
	}
	return ordered;
}

/**
 * Checks if a change is part of a chain (more than one in /related).
 * Looks up the current commit for the given changeId, then finds its position in the chain by commit hash.
 */
export interface ChainInfoResult {
	inChain: boolean;
	position?: number;
	length?: number;
	/** Change number of the base (first) change in the chain */
	chainNumber?: number;
	/** Full Change-Id of the base (first) change in the chain */
	chainBaseChangeId?: string;
}

export async function isChangeChained(
	changeId: string
): Promise<ChainInfoResult> {
	const api = await getAPI();
	if (!api) {
		console.warn('[isChangeChained] No API instance for', changeId);
		return { inChain: false };
	}
	// Fetch the related chain (array of {commit, change_id})
	const chain = await getChangeChain(changeId);
	console.log('[isChangeChained] Chain for', changeId, chain);
	if (!chain.length) {
		console.warn('[isChangeChained] No chain found for', changeId);
		return { inChain: false };
	}
	// Fetch the detail for this change to get the Gerrit Change-Id (Ixxxx...)
	let gerritChangeId: string | undefined;
	try {
		const detailResp = await api['_tryRequest']({
			path: `changes/${changeId}/detail/`,
			method: 'GET',
		});
		console.log(
			'[isChangeChained] Detail response for',
			changeId,
			detailResp
		);
		if (detailResp && api['_assertRequestSucceeded'](detailResp)) {
			const detailJson = api['_tryParseJSON']<{ change_id: string }>(
				detailResp.strippedBody
			);
			gerritChangeId = detailJson?.change_id;
		}
	} catch (err) {
		console.error(
			'[isChangeChained] Error fetching detail for',
			changeId,
			err
		);
	}
	if (!gerritChangeId) {
		console.warn(
			'[isChangeChained] No Gerrit Change-Id (changeId) found for chain info',
			{ changeID: changeId }
		);
		return { inChain: false };
	}
	// Now match by the real Gerrit Change-Id
	const idx = chain.findIndex((entry) => entry.change_id === gerritChangeId);
	console.log(
		'[isChangeChained] Matching by change_id:',
		gerritChangeId,
		'in chain:',
		chain.map((e) => e.change_id),
		'idx:',
		idx
	);

	// Fetch status for all changes in chain to filter out merged ones
	const chainWithStatus: Array<{
		change_id: string;
		commit: string;
		status?: string;
	}> = [];
	for (const entry of chain) {
		try {
			const detailResp = await api['_tryRequest']({
				path: `changes/${entry.change_id}/detail/`,
				method: 'GET',
			});
			if (detailResp && api['_assertRequestSucceeded'](detailResp)) {
				const detailJson = api['_tryParseJSON']<{ status: string }>(
					detailResp.strippedBody
				);
				chainWithStatus.push({
					change_id: entry.change_id,
					commit: entry.commit,
					status: detailJson?.status,
				});
			} else {
				chainWithStatus.push({ ...entry });
			}
		} catch (err) {
			console.warn(
				'[isChangeChained] Error fetching status for',
				entry.change_id,
				err
			);
			chainWithStatus.push({ ...entry });
		}
	}

	// Filter out merged changes - only count NEW changes in the chain
	const activeChain = chainWithStatus.filter((c) => c.status !== 'MERGED');
	const mergedCount = chainWithStatus.length - activeChain.length;

	console.log(
		'[isChangeChained] Chain with status for',
		changeId,
		'- Total:',
		chainWithStatus.length,
		'Merged:',
		mergedCount,
		'Active:',
		activeChain.length,
		'Chain:',
		chainWithStatus
	);

	// Find index in active chain (excluding merged changes)
	const activeIdx = activeChain.findIndex(
		(entry) => entry.change_id === gerritChangeId
	);

	// The base of the chain is the last item in the active array (oldest active ancestor)
	const baseChangeId =
		activeChain.length > 0
			? activeChain[activeChain.length - 1].change_id
			: undefined;

	// Fetch the change number for the base change
	let chainNumber: number | undefined;
	if (baseChangeId) {
		try {
			const baseDetailResp = await api['_tryRequest']({
				path: `changes/${baseChangeId}/detail/`,
				method: 'GET',
			});
			if (
				baseDetailResp &&
				api['_assertRequestSucceeded'](baseDetailResp)
			) {
				const baseDetailJson = api['_tryParseJSON']<{
					_number: number;
				}>(baseDetailResp.strippedBody);
				chainNumber = baseDetailJson?._number;
			}
		} catch (err) {
			console.warn(
				'[isChangeChained] Error fetching base change detail for',
				baseChangeId,
				err
			);
		}
	}

	return {
		inChain: activeChain.length > 1,
		position:
			activeIdx >= 0 && activeChain.length > 1
				? activeChain.length - activeIdx
				: undefined,
		length: activeChain.length > 1 ? activeChain.length : undefined,
		chainNumber,
		chainBaseChangeId: baseChangeId,
	};
}
