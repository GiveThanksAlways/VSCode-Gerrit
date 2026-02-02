import {
	ChangeList,
	ScorePicker,
	PeoplePicker,
	SafetyArmedButton,
	ChainInfo,
} from './components';
import { BatchReviewState, BatchReviewPerson } from '../../../state';
import React, { VFC, useState, useEffect, useCallback } from 'react';
import { BatchReviewChange } from '../../../types';
import { vscode } from '../lib/api';

export const BatchReviewPane: VFC = () => {
	const [state, setState] = useState<BatchReviewState>({
		incomingChanges: [],
		batchChanges: [],
		loading: true,
	});
	const [selectedYourTurn, setSelectedYourTurn] = useState<Set<string>>(
		new Set()
	);
	const [selectedBatch, setSelectedBatch] = useState<Set<string>>(new Set());
	const [voteMessage, setVoteMessage] = useState<string>('');
	const [labelValues, setLabelValues] = useState<Record<string, number>>({});
	const [resolved, setResolved] = useState<boolean>(true);
	const [reviewers, setReviewers] = useState<BatchReviewPerson[]>([]);
	const [ccList, setCcList] = useState<BatchReviewPerson[]>([]);
	const [automationStatus, setAutomationStatus] = useState<{
		running: boolean;
		port: number | null;
	}>({ running: false, port: null });
	// Accordion state: 'batch' or 'individual' - only one can be open
	const [openSection, setOpenSection] = useState<'batch' | 'individual'>(
		'batch'
	);
	// Chain info map for batch items - used for validation and highlighting
	const [chainInfoMap, setChainInfoMap] = useState<Map<string, ChainInfo>>(
		new Map()
	);
	// Chain validation warnings
	const [chainWarnings, setChainWarnings] = useState<string[]>([]);

	useEffect(() => {
		const messageHandler = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === 'stateToView') {
				setState(message.body.state);
			} else if (message.type === 'batchVoteSuccess') {
				const { successCount, failureCount } = message.body;
				alert(
					`Batch review completed!\nSuccess: ${successCount}\nFailed: ${failureCount}`
				);
				setVoteMessage('');
			} else if (message.type === 'batchVoteFailed') {
				alert('Batch review failed. Please try again.');
			} else if (message.type === 'automationStatus') {
				setAutomationStatus(message.body);
			} else if (message.type === 'chainInfo') {
				// Update chain info for a specific change
				setChainInfoMap((prev) => {
					const newMap = new Map(prev);
					newMap.set(message.body.changeID, message.body);
					return newMap;
				});
			}
		};

		window.addEventListener('message', messageHandler);
		vscode.postMessage({ type: 'ready' });

		return () => window.removeEventListener('message', messageHandler);
	}, []);

	/**
	 * Validate the chain status of batch items.
	 * Checks if:
	 * 1. All items in a chain are present starting from position 1
	 * 2. Items have unsubmitted dependencies
	 */
	const validateChain = useCallback(() => {
		const warnings: string[] = [];
		const updatedChainInfo = new Map<string, ChainInfo>();

		// Group changes by chain (using their chain length as a rough grouper)
		const chainGroups = new Map<string, BatchReviewChange[]>();

		for (const change of state.batchChanges) {
			const info = chainInfoMap.get(change.changeId);
			if (info?.inChain && info.length) {
				// Create a rough chain key using branch and length
				// This isn't perfect but helps group related changes
				const chainKey = `${change.branch}-${info.length}`;
				if (!chainGroups.has(chainKey)) {
					chainGroups.set(chainKey, []);
				}
				chainGroups.get(chainKey)!.push(change);
			}
		}

		// Check each chain group for completeness
		chainGroups.forEach((changes, chainKey) => {
			// Get all positions in this chain that are in the batch
			const positions = changes
				.map((c) => {
					const info = chainInfoMap.get(c.changeId);
					return info?.position ?? 0;
				})
				.filter((p) => p > 0)
				.sort((a, b) => a - b);

			if (positions.length === 0) return;

			// Check if we're missing position 1 (the base)
			if (positions[0] !== 1) {
				warnings.push(
					`Chain starting at position ${positions[0]} is missing changes 1-${positions[0] - 1}. Submit changes in order starting from the base.`
				);

				// Mark all changes in this chain as having unsubmitted dependencies
				for (const change of changes) {
					const existing = chainInfoMap.get(change.changeId);
					updatedChainInfo.set(change.changeId, {
						...existing,
						inChain: true,
						hasUnsubmittedDependencies: true,
						chainColorClass: 'chain-warning-glow',
					});
				}
			} else {
				// Check for gaps in the sequence
				let hasGap = false;
				for (let i = 1; i < positions.length; i++) {
					if (positions[i] !== positions[i - 1] + 1) {
						warnings.push(
							`Chain has a gap between positions ${positions[i - 1]} and ${positions[i]}. All changes in the chain must be included.`
						);
						hasGap = true;
						break;
					}
				}

				if (hasGap) {
					// Mark all changes in this chain as having unsubmitted dependencies (gap)
					for (const change of changes) {
						const existing = chainInfoMap.get(change.changeId);
						updatedChainInfo.set(change.changeId, {
							...existing,
							inChain: true,
							hasUnsubmittedDependencies: true,
							chainColorClass: 'chain-warning-glow',
						});
					}
				} else {
					// Mark all changes in this chain with a color
					const colorIndex =
						Array.from(chainGroups.keys()).indexOf(chainKey) % 5;
					const colorClass = `chain-color-${colorIndex + 1}`;
					for (const change of changes) {
						const existing = chainInfoMap.get(change.changeId);
						updatedChainInfo.set(change.changeId, {
							...existing,
							inChain: true,
							hasUnsubmittedDependencies: false,
							chainColorClass: colorClass,
						});
					}
				}
			}
		});

		// Merge updated info
		if (updatedChainInfo.size > 0) {
			setChainInfoMap((prev) => {
				const newMap = new Map(prev);
				updatedChainInfo.forEach((value, key) => {
					newMap.set(key, value);
				});
				return newMap;
			});
		}

		setChainWarnings(warnings);
	}, [state.batchChanges, chainInfoMap]);

	// Validate chain when batch changes or chain info updates
	useEffect(() => {
		validateChain();
	}, [validateChain]);

	const handleYourTurnSelection = (changeID: string, selected: boolean) => {
		const newSet = new Set(selectedYourTurn);
		if (selected) {
			newSet.add(changeID);
		} else {
			newSet.delete(changeID);
		}
		setSelectedYourTurn(newSet);
	};

	const handleYourTurnSelectAll = (selected: boolean) => {
		if (selected) {
			setSelectedYourTurn(
				new Set(state.incomingChanges.map((c) => c.changeID))
			);
		} else {
			setSelectedYourTurn(new Set());
		}
	};

	const handleBatchSelection = (changeID: string, selected: boolean) => {
		const newSet = new Set(selectedBatch);
		if (selected) {
			newSet.add(changeID);
		} else {
			newSet.delete(changeID);
		}
		setSelectedBatch(newSet);
	};

	const handleBatchSelectAll = (selected: boolean) => {
		if (selected) {
			setSelectedBatch(
				new Set(state.batchChanges.map((c) => c.changeID))
			);
		} else {
			setSelectedBatch(new Set());
		}
	};

	const handleAddToBatch = () => {
		if (selectedYourTurn.size === 0) return;
		vscode.postMessage({
			type: 'addToBatch',
			body: { changeIDs: Array.from(selectedYourTurn) },
		});
		setSelectedYourTurn(new Set());
	};

	const handleRemoveFromBatch = () => {
		if (selectedBatch.size === 0) return;
		vscode.postMessage({
			type: 'removeFromBatch',
			body: { changeIDs: Array.from(selectedBatch) },
		});
		setSelectedBatch(new Set());
	};

	const handleClearBatch = () => {
		if (state.batchChanges.length === 0) return;
		vscode.postMessage({ type: 'clearBatch' });
		setSelectedBatch(new Set());
	};

	/**
	 * Helper to apply multi-select operation to a Set
	 */
	const applyMultiSelect = (
		prev: Set<string>,
		changeIDs: string[],
		mode: 'add' | 'replace'
	): Set<string> => {
		if (mode === 'replace') {
			return new Set(changeIDs);
		}
		// mode === 'add'
		const newSet = new Set(prev);
		changeIDs.forEach((id) => newSet.add(id));
		return newSet;
	};

	const handleYourTurnMultiSelect = (
		changeIDs: string[],
		mode: 'add' | 'replace'
	) => {
		setSelectedYourTurn((prev) => applyMultiSelect(prev, changeIDs, mode));
	};

	const handleBatchMultiSelect = (
		changeIDs: string[],
		mode: 'add' | 'replace'
	) => {
		setSelectedBatch((prev) => applyMultiSelect(prev, changeIDs, mode));
	};

	const handleFileViewModeChange = (mode: 'list' | 'tree') => {
		vscode.postMessage({
			type: 'setFileViewMode',
			body: { mode },
		});
	};

	const handleLabelChange = (name: string, value: number) => {
		setLabelValues((prev) => ({ ...prev, [name]: value }));
	};

	const handleReviewerSearch = (query: string) => {
		vscode.postMessage({
			type: 'getPeople',
			body: { query, isCC: false },
		});
	};

	const handleCCSearch = (query: string) => {
		vscode.postMessage({
			type: 'getPeople',
			body: { query, isCC: true },
		});
	};

	const handleSendReview = () => {
		if (state.batchChanges.length === 0) {
			alert('No changes in batch to review');
			return;
		}

		vscode.postMessage({
			type: 'submitBatchVote',
			body: {
				labels: labelValues,
				message: voteMessage.trim() || undefined,
				resolved,
				reviewers: reviewers.map((r) => r.id),
				cc: ccList.map((c) => c.id),
			},
		});
	};

	const handleSubmitPatch = () => {
		if (state.batchChanges.length === 0) {
			alert('No changes in batch to submit');
			return;
		}

		vscode.postMessage({ type: 'submitBatch' });
	};

	const handlePlus2All = () => {
		if (state.batchChanges.length === 0) {
			return;
		}
		vscode.postMessage({ type: 'plus2All' });
	};

	const handlePlus2AllAndSubmit = () => {
		if (state.batchChanges.length === 0) {
			return;
		}
		vscode.postMessage({ type: 'plus2AllAndSubmit' });
	};

	const handleRefresh = () => {
		vscode.postMessage({ type: 'getIncomingReviews' });
	};

	// Drag and Drop handlers
	const handleDragStart = (
		e: React.DragEvent,
		changeID: string,
		sourceList: 'yourTurn' | 'batch'
	) => {
		// Get list of IDs to drag - if the dragged item is selected, drag all selected items
		// Otherwise, just drag the single item
		const selectedSet =
			sourceList === 'yourTurn' ? selectedYourTurn : selectedBatch;
		let changeIDs: string[];

		if (selectedSet.has(changeID)) {
			// Dragging a selected item - drag all selected items
			changeIDs = Array.from(selectedSet);
		} else {
			// Dragging an unselected item - just drag that one
			changeIDs = [changeID];
		}

		e.dataTransfer.setData(
			'application/json',
			JSON.stringify({
				changeIDs,
				sourceList,
			})
		);
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleDrop = (
		e: React.DragEvent,
		targetList: 'yourTurn' | 'batch',
		dropIndex?: number
	) => {
		e.preventDefault();
		const data = e.dataTransfer.getData('application/json');
		if (!data) return;

		try {
			const { changeIDs, sourceList } = JSON.parse(data) as {
				changeIDs: string[];
				sourceList: 'yourTurn' | 'batch';
			};

			// Handle reordering within the same list
			if (sourceList === targetList) {
				// Reorder within the list
				if (dropIndex !== undefined) {
					vscode.postMessage({
						type: 'reorderChanges',
						body: {
							changeIDs,
							targetList,
							dropIndex,
						},
					});
				}
				return;
			}

			if (targetList === 'batch') {
				// Moving from yourTurn to batch
				vscode.postMessage({
					type: 'addToBatch',
					body: { changeIDs, dropIndex },
				});
				setSelectedYourTurn(new Set());
			} else {
				// Moving from batch to yourTurn
				vscode.postMessage({
					type: 'removeFromBatch',
					body: { changeIDs, dropIndex },
				});
				setSelectedBatch(new Set());
			}
		} catch {
			// Invalid data, ignore
		}
	};

	if (state.loading) {
		return (
			<div className="loading-container">
				<div className="codicon codicon-loading codicon-modifier-spin"></div>
				<span>Loading changes...</span>
			</div>
		);
	}

	return (
		<div className="batch-review-container">
			<div className="header">
				<h1>Batch Review</h1>
				<div className="header-buttons">
					<button
						className="refresh-button"
						onClick={handleRefresh}
						title="Refresh Incoming Reviews"
					>
						<span className="codicon codicon-refresh"></span>
						Refresh
					</button>
					{automationStatus.running && (
						<div
							className="api-status api-status-running"
							title={`API server running on  127.0.0.1:${automationStatus.port}`}
						>
							<span className="codicon codicon-check"></span>
							<span className="api-port">Batch API</span>
						</div>
					)}
				</div>
			</div>

			<div className="lists-container">
				<div className="your-turn-section">
					<ChangeList
						changes={state.incomingChanges}
						selectedChanges={selectedYourTurn}
						onSelectionChange={handleYourTurnSelection}
						onSelectAll={handleYourTurnSelectAll}
						onMultiSelect={handleYourTurnMultiSelect}
						title="Incoming Reviews"
						listType="yourTurn"
						onDragStart={handleDragStart}
						onDrop={handleDrop}
						fileViewMode={state.fileViewMode ?? 'tree'}
						onFileViewModeChange={handleFileViewModeChange}
					/>
					<div className="action-buttons">
						<button
							onClick={handleAddToBatch}
							disabled={selectedYourTurn.size === 0}
							className="button-primary"
						>
							<span className="codicon codicon-arrow-right"></span>
							Add to Batch ({selectedYourTurn.size})
						</button>
					</div>
				</div>

				<div className="batch-section">
					<ChangeList
						changes={state.batchChanges}
						selectedChanges={selectedBatch}
						onSelectionChange={handleBatchSelection}
						onSelectAll={handleBatchSelectAll}
						onMultiSelect={handleBatchMultiSelect}
						title="Batch"
						showScores={true}
						listType="batch"
						onDragStart={handleDragStart}
						onDrop={handleDrop}
						fileViewMode={state.fileViewMode ?? 'tree'}
						onFileViewModeChange={handleFileViewModeChange}
						chainInfoMap={chainInfoMap}
					/>

					{/* Chain Warnings */}
					{chainWarnings.length > 0 && (
						<div className="chain-warnings">
							{chainWarnings.map((warning, i) => (
								<div key={i} className="chain-warning-item">
									<span className="codicon codicon-warning"></span>
									<span>{warning}</span>
								</div>
							))}
						</div>
					)}

					<div className="batch-actions">
						<div className="action-buttons">
							<button
								onClick={handleRemoveFromBatch}
								disabled={selectedBatch.size === 0}
								className="button-secondary"
							>
								<span className="codicon codicon-arrow-left"></span>
								Remove ({selectedBatch.size})
							</button>
							<button
								onClick={handleClearBatch}
								disabled={state.batchChanges.length === 0}
								className="button-secondary"
							>
								<span className="codicon codicon-clear-all"></span>
								Clear All
							</button>
						</div>

						{/* Batch Actions Section - for +2 All operations */}
						<div
							className={`review-panel batch-operations ${openSection === 'batch' ? 'expanded' : 'collapsed'}`}
						>
							<div
								className="section-header clickable"
								onClick={() =>
									setOpenSection(
										openSection === 'batch'
											? 'individual'
											: 'batch'
									)
								}
							>
								<span
									className={`codicon codicon-chevron-${openSection === 'batch' ? 'down' : 'right'}`}
								></span>
								<span className="codicon codicon-layers"></span>
								<span>Batch Actions</span>
							</div>
							{openSection === 'batch' && (
								<div className="section-content">
									<div className="submit-buttons compact">
										<SafetyArmedButton
											onClick={handlePlus2All}
											disabled={
												state.batchChanges.length === 0
											}
											buttonClassName="button-plus2"
											icon="codicon-pass"
											label={`+2 All (${state.batchChanges.length})`}
											title="Apply Code-Review +2 to all batch changes"
											confirmLabel={`+2 All ${state.batchChanges.length}`}
										/>
										<SafetyArmedButton
											onClick={handlePlus2AllAndSubmit}
											disabled={
												state.batchChanges.length === 0
											}
											buttonClassName="button-combo"
											icon="codicon-rocket"
											label="+2 & Submit"
											title="Apply +2 and submit all submittable changes"
											confirmLabel="+2 & Submit"
										/>
									</div>
								</div>
							)}
						</div>

						{/* Individual Review Section - for custom reviews */}
						<div
							className={`review-panel individual-review ${openSection === 'individual' ? 'expanded' : 'collapsed'}`}
						>
							<div
								className="section-header clickable"
								onClick={() =>
									setOpenSection(
										openSection === 'individual'
											? 'batch'
											: 'individual'
									)
								}
							>
								<span
									className={`codicon codicon-chevron-${openSection === 'individual' ? 'down' : 'right'}`}
								></span>
								<span className="codicon codicon-comment-discussion"></span>
								<span>Individual Review</span>
							</div>
							{openSection === 'individual' && (
								<div className="section-content">
									{/* Reviewers and CC */}
									<PeoplePicker
										label="Reviewers"
										people={reviewers}
										suggestions={
											state.suggestedReviewers ?? []
										}
										onChange={setReviewers}
										onSearch={handleReviewerSearch}
										placeholder="Add reviewers..."
									/>
									<PeoplePicker
										label="CC"
										people={ccList}
										suggestions={state.suggestedCC ?? []}
										onChange={setCcList}
										onSearch={handleCCSearch}
										placeholder="Add CC..."
									/>

									{/* Comment */}
									<div className="comment-section">
										<textarea
											className="vote-message"
											placeholder="Say something nice..."
											value={voteMessage}
											onChange={(e) =>
												setVoteMessage(e.target.value)
											}
											rows={3}
										/>
									</div>

									{/* Resolved checkbox */}
									<div className="resolved-section">
										<label className="checkbox-label">
											<input
												type="checkbox"
												checked={resolved}
												onChange={(e) =>
													setResolved(
														e.target.checked
													)
												}
											/>
											<span>Resolved</span>
										</label>
									</div>

									{/* Score pickers */}
									<div className="score-pickers">
										{(state.labels ?? []).map(
											(label, i) => (
												<ScorePicker
													key={i}
													label={label}
													value={
														labelValues[
															label.name
														] ?? 0
													}
													onChange={handleLabelChange}
												/>
											)
										)}
									</div>

									{/* Submit buttons */}
									<div className="submit-buttons">
										<button
											onClick={handleSubmitPatch}
											disabled={
												state.batchChanges.length === 0
											}
											className="button-submit"
											title="Submit all changes in batch"
										>
											<span className="codicon codicon-check-all"></span>
											Submit ({state.batchChanges.length})
										</button>
										<button
											onClick={handleSendReview}
											disabled={
												state.batchChanges.length === 0
											}
											className="button-send"
											title="Send review for all changes in batch"
										>
											<span className="codicon codicon-comment"></span>
											Send ({state.batchChanges.length})
										</button>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
