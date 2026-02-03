/**
 * Lightweight Local HTTP API for Batch Review Automation
 *
 * This module exposes a minimal local HTTP API (REST-like) for interacting
 * with the batch list. The API only allows reading, adding, or clearing
 * the batch list—never submitting reviews (those remain human-only).
 *
 * Security considerations:
 * - Server only listens on localhost (127.0.0.1)
 * - No endpoints for voting/submitting reviews
 * - Server only runs when user explicitly requests automation
 * - Request body size is limited to prevent memory issues
 */

import { BatchReviewChange } from '../../views/editor/batchReview/types';
import * as http from 'http';

// Maximum request body size (1MB should be plenty for change IDs)
const MAX_BODY_SIZE = 1024 * 1024;

// Fixed port for the local API server
const FIXED_PORT = 45193;

/**
 * Severity levels for AI code review scoring.
 * Follows software engineering standards for issue classification.
 */
export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'APPROVED';

/**
 * Valid severity levels for validation.
 */
export const VALID_SEVERITIES: readonly SeverityLevel[] = [
	'CRITICAL',
	'HIGH',
	'MEDIUM',
	'LOW',
	'APPROVED',
] as const;

/**
 * Score mapping for changes being added to batch.
 * Maps changeID to severity level for AI confidence/code review.
 */
export interface ScoreMap {
	[changeID: string]: SeverityLevel;
}

export interface BatchReviewApiCallbacks {
	getBatch: () => BatchReviewChange[];
	addToBatch: (changeIDs: string[], scores?: ScoreMap) => void;
	clearBatch: () => void;
}

export interface BatchReviewApiServer {
	start: () => Promise<number>;
	stop: () => Promise<void>;
	isRunning: () => boolean;
	getPort: () => number | null;
}

/**
 * Validates that all elements in the array are non-empty strings.
 */
function validateChangeIDs(changeIDs: unknown[]): changeIDs is string[] {
	return changeIDs.every(
		(id) => typeof id === 'string' && id.length > 0 && id.length < 1000
	);
}

/**
 * Creates a lightweight local HTTP API server for batch review automation.
 *
 * API Endpoints:
 * - GET /batch — Returns the current batch list
 * - POST /batch — Adds changes to the batch list (body: { changeIDs: string[], scores?: { [changeID: string]: number } })
 * - DELETE /batch — Clears the batch list
 * - GET /health — Health check endpoint
 *
 * @param callbacks Functions to interact with the batch review state
 * @returns Server control interface
 */
export function createBatchReviewApiServer(
	callbacks: BatchReviewApiCallbacks
): BatchReviewApiServer {
	let server: http.Server | null = null;
	let port: number | null = null;
	let starting = false;

	const handleRequest = (
		req: http.IncomingMessage,
		res: http.ServerResponse
	): void => {
		// Basic logging for all requests
		console.log(`[BatchReviewAPI] ${req.method} ${req.url}`);
		res.setHeader('Content-Type', 'application/json');

		const url = req.url || '/';
		const method = req.method || 'GET';

		// Route: GET /health
		if (url === '/health' && method === 'GET') {
			res.writeHead(200);
			res.end(JSON.stringify({ status: 'ok' }));
			return;
		}

		// Route: GET /batch
		if (url === '/batch' && method === 'GET') {
			const batch = callbacks.getBatch();
			res.writeHead(200);
			res.end(JSON.stringify({ batch }));
			return;
		}

		// Route: POST /batch
		if (url === '/batch' && method === 'POST') {
			let body = '';
			let bodySize = 0;

			req.on('data', (chunk: Buffer) => {
				bodySize += chunk.length;
				if (bodySize > MAX_BODY_SIZE) {
					console.error('[BatchReviewAPI] Request body too large');
					res.writeHead(413);
					res.end(
						JSON.stringify({ error: 'Request body too large' })
					);
					req.destroy();
					return;
				}
				body += chunk.toString();
			});
			req.on('end', () => {
				console.log(`[BatchReviewAPI] POST /batch body:`, body);
				try {
					const data = JSON.parse(body) as {
						changeIDs?: unknown[];
						scores?: Record<string, unknown>;
					};
					if (!data.changeIDs || !Array.isArray(data.changeIDs)) {
						console.error(
							'[BatchReviewAPI] Invalid request body: missing or invalid changeIDs',
							data.changeIDs
						);
						res.writeHead(400);
						res.end(
							JSON.stringify({
								error: 'Invalid request body. Expected { changeIDs: string[], scores?: { [changeID: string]: number } }',
							})
						);
						return;
					}
					if (!validateChangeIDs(data.changeIDs)) {
						console.error(
							'[BatchReviewAPI] Invalid changeIDs. All elements must be non-empty strings.',
							data.changeIDs
						);
						res.writeHead(400);
						res.end(
							JSON.stringify({
								error: 'Invalid changeIDs. All elements must be non-empty strings.',
							})
						);
						return;
					}

					// Parse and validate scores if provided
					let scores: ScoreMap | undefined;
					if (data.scores && typeof data.scores === 'object') {
						scores = {};
						for (const [changeID, score] of Object.entries(
							data.scores
						)) {
							// Reject numeric scores (1-10) with validation error
							if (typeof score === 'number') {
								console.error(
									'[BatchReviewAPI] Numeric scores are no longer supported. Use severity levels: CRITICAL, HIGH, MEDIUM, LOW, APPROVED'
								);
								res.writeHead(400);
								res.end(
									JSON.stringify({
										error: 'Numeric scores (1-10) are no longer supported. Use severity levels: CRITICAL, HIGH, MEDIUM, LOW, APPROVED',
										validSeverities: VALID_SEVERITIES,
									})
								);
								return;
							}
							// Validate severity string
							if (
								typeof score === 'string' &&
								VALID_SEVERITIES.includes(
									score as SeverityLevel
								)
							) {
								scores[changeID] = score as SeverityLevel;
							} else {
								console.error(
									`[BatchReviewAPI] Invalid severity level: ${score}. Valid values: ${VALID_SEVERITIES.join(', ')}`
								);
								res.writeHead(400);
								res.end(
									JSON.stringify({
										error: `Invalid severity level: ${score}. Valid values: ${VALID_SEVERITIES.join(', ')}`,
										validSeverities: VALID_SEVERITIES,
									})
								);
								return;
							}
						}
					}
					console.log(
						'[BatchReviewAPI] Received changeIDs:',
						data.changeIDs
					);
					if (scores) {
						console.log(
							'[BatchReviewAPI] Received scores:',
							scores
						);
					}

					callbacks.addToBatch(data.changeIDs, scores);
					const batch = callbacks.getBatch();
					res.writeHead(200);
					res.end(
						JSON.stringify({
							success: true,
							batch,
						})
					);
				} catch (err) {
					console.error('[BatchReviewAPI] Invalid JSON body', err);
					res.writeHead(400);
					res.end(JSON.stringify({ error: 'Invalid JSON body' }));
				}
			});
			return;
		}

		// Route: DELETE /batch
		if (url === '/batch' && method === 'DELETE') {
			callbacks.clearBatch();
			res.writeHead(200);
			res.end(
				JSON.stringify({
					success: true,
					batch: [],
				})
			);
			return;
		}

		// 404 for unknown routes
		res.writeHead(404);
		res.end(
			JSON.stringify({
				error: 'Not found',
				availableEndpoints: [
					'GET /health',
					'GET /batch',
					'POST /batch',
					'DELETE /batch',
				],
			})
		);
	};

	const start = async (): Promise<number> => {
		// Return existing port if already running
		if (server && port !== null) {
			return port;
		}

		// Prevent concurrent start attempts
		if (starting) {
			throw new Error('Server is already starting');
		}

		starting = true;

		return new Promise((resolve, reject) => {
			const newServer = http.createServer(handleRequest);

			const errorHandler = (err: Error): void => {
				starting = false;
				server = null;
				port = null;
				newServer.removeListener('error', errorHandler);
				reject(err);
			};

			newServer.on('error', errorHandler);

			// Listen on a random available port on localhost only
			newServer.listen(FIXED_PORT, '127.0.0.1', () => {
				const address = newServer.address();
				if (typeof address === 'object' && address !== null) {
					server = newServer;
					port = address.port;
					starting = false;
					newServer.removeListener('error', errorHandler);
					resolve(FIXED_PORT);
				} else {
					starting = false;
					reject(new Error('Failed to get server address'));
				}
			});
		});
	};

	const stop = async (): Promise<void> => {
		const currentServer = server;
		if (!currentServer) {
			return;
		}

		return new Promise((resolve, reject) => {
			currentServer.close((err) => {
				if (err) {
					reject(err);
				} else {
					server = null;
					port = null;
					resolve();
				}
			});
		});
	};

	const isRunning = (): boolean => {
		return server !== null;
	};

	const getPort = (): number | null => {
		return FIXED_PORT; // Return the fixed port
	};

	return {
		start,
		stop,
		isRunning,
		getPort,
	};
}
