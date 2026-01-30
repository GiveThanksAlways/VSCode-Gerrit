import { getAPI } from '../../../lib/gerrit/gerritAPI';
import { GerritChange } from '../../../lib/gerrit/gerritAPI/gerritChange';

/**
 * Fetches the related chain for a change.
 * Returns an array of {commit, change_id} in dependency order (base to tip).
 */
export interface ChangeChainEntry {
       commit: string;
       change_id: string;
}
export async function getChangeChain(changeId: string): Promise<ChangeChainEntry[]> {
       const api = await getAPI();
       if (!api) {
              console.warn('[getChangeChain] No API instance for', changeId);
              return [];
       }
       const endpoint = `changes/${changeId}/revisions/current/related`;
       console.log(`[getChangeChain] Fetching chain for ${changeId} from endpoint: ${endpoint}`);
       const response = await api['_tryRequest']({
              path: endpoint,
              method: 'GET',
       });
       console.log('[getChangeChain] Raw response for', changeId, response);
       if (!response || !api['_assertRequestSucceeded'](response)) {
              console.warn('[getChangeChain] No response or failed for', changeId, response);
              return [];
       }
       const json = api['_tryParseJSON']<{ changes: { commit: string; change_id: string }[] }>(response.strippedBody);
       console.log('[getChangeChain] Parsed JSON for', changeId, json);
       if (!json?.changes || json.changes.length < 2) {
              console.log('[getChangeChain] No chain or only one change for', changeId, json);
              return [];
       }
       const chain = json.changes.map(c => ({ commit: c.commit, change_id: c.change_id }));
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
                     if (!seen.has(entry.change_id) && changeIds.includes(entry.change_id)) {
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
export async function isChangeChained(changeId: string): Promise<{ inChain: boolean; position?: number; length?: number }> {
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
              console.log('[isChangeChained] Detail response for', changeId, detailResp);
              if (detailResp && api['_assertRequestSucceeded'](detailResp)) {
                     const detailJson = api['_tryParseJSON']<{ change_id: string }>(detailResp.strippedBody);
                     gerritChangeId = detailJson?.change_id;
              }
       } catch (err) {
              console.error('[isChangeChained] Error fetching detail for', changeId, err);
       }
       if (!gerritChangeId) {
              console.warn('[isChangeChained] No Gerrit Change-Id (changeId) found for chain info', { changeID: changeId });
              return { inChain: false };
       }
       // Now match by the real Gerrit Change-Id
       const idx = chain.findIndex(entry => entry.change_id === gerritChangeId);
       console.log('[isChangeChained] Matching by change_id:', gerritChangeId, 'in chain:', chain.map(e => e.change_id), 'idx:', idx);
       // Reverse: tip is 1, base is N (idx 0 is base, idx N-1 is tip)
       return {
              inChain: chain.length > 1,
              position: idx >= 0 && chain.length > 1 ? (chain.length - idx) : undefined,
              length: chain.length > 1 ? chain.length : undefined,
       };
}
