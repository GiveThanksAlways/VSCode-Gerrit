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
 */

import * as http from 'http';
import { BatchReviewChange } from '../../views/editor/batchReview/types';

export interface BatchReviewApiCallbacks {
	getBatch: () => BatchReviewChange[];
	getYourTurn: () => BatchReviewChange[];
	addToBatch: (changeIDs: string[]) => void;
	clearBatch: () => void;
}

export interface BatchReviewApiServer {
	start: () => Promise<number>;
	stop: () => Promise<void>;
	isRunning: () => boolean;
	getPort: () => number | null;
}

/**
 * Creates a lightweight local HTTP API server for batch review automation.
 *
 * API Endpoints:
 * - GET /batch — Returns the current batch list
 * - POST /batch — Adds changes to the batch list (body: { changeIDs: string[] })
 * - DELETE /batch — Clears the batch list
 * - GET /your-turn — Returns the "Your Turn" changes list (read-only)
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

	const handleRequest = (
		req: http.IncomingMessage,
		res: http.ServerResponse
	): void => {
		// Set CORS headers for local development
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader(
			'Access-Control-Allow-Methods',
			'GET, POST, DELETE, OPTIONS'
		);
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
		res.setHeader('Content-Type', 'application/json');

		// Handle preflight requests
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

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
			req.on('data', (chunk: Buffer) => {
				body += chunk.toString();
			});
			req.on('end', () => {
				try {
					const data = JSON.parse(body) as { changeIDs?: string[] };
					if (!data.changeIDs || !Array.isArray(data.changeIDs)) {
						res.writeHead(400);
						res.end(
							JSON.stringify({
								error: 'Invalid request body. Expected { changeIDs: string[] }',
							})
						);
						return;
					}
					callbacks.addToBatch(data.changeIDs);
					const batch = callbacks.getBatch();
					res.writeHead(200);
					res.end(JSON.stringify({
						success: true,
						batch,
					}));
				} catch {
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
			res.end(JSON.stringify({
				success: true,
				batch: [],
			}));
			return;
		}

		// Route: GET /your-turn
		if (url === '/your-turn' && method === 'GET') {
			const yourTurn = callbacks.getYourTurn();
			res.writeHead(200);
			res.end(JSON.stringify({ yourTurn }));
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
					'GET /your-turn',
				],
			})
		);
	};

	const start = async (): Promise<number> => {
		if (server) {
			return port!;
		}

		return new Promise((resolve, reject) => {
			server = http.createServer(handleRequest);

			// Listen on a random available port on localhost only
			server.listen(0, '127.0.0.1', () => {
				const address = server!.address();
				if (typeof address === 'object' && address !== null) {
					port = address.port;
					resolve(port);
				} else {
					reject(new Error('Failed to get server address'));
				}
			});

			server.on('error', (err) => {
				server = null;
				port = null;
				reject(err);
			});
		});
	};

	const stop = async (): Promise<void> => {
		if (!server) {
			return;
		}

		return new Promise((resolve, reject) => {
			server!.close((err) => {
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
		return port;
	};

	return {
		start,
		stop,
		isRunning,
		getPort,
	};
}
