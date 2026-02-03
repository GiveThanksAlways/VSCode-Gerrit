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
	// Chain info map for all items - used for validation, highlighting, and chain selection
	const [chainInfoMap, setChainInfoMap] = useState<Map<string, ChainInfo>>(
		new Map()
	);
	// Chain validation warnings
	const [chainWarnings, setChainWarnings] = useState<string[]>([]);
	// Track which safety button is armed (only one at a time)
	const [armedButtonId, setArmedButtonId] = useState<string | null>(null);

	// Handler for coordinated safety button arming
	const handleArmedChange = useCallback(
		(buttonId: string, armed: boolean) => {
			if (armed) {
				setArmedButtonId(buttonId);
			} else if (armedButtonId === buttonId) {
				setArmedButtonId(null);
			}
		},
		[armedButtonId]
	);

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
	 *
	 * Only marks items that are actually broken (after a gap or missing base)
	 * Items before a gap are valid and get a normal color.
	 */
	useEffect(() => {
		// Skip if no batch changes
		if (state.batchChanges.length === 0) {
			setChainWarnings([]);
			return;
		}

		const warnings: string[] = [];
		const updatedChainInfo = new Map<string, ChainInfo>();

		// Group changes by chain using chainNumber (the base change number)
		const chainGroups = new Map<
			number,
			{ change: BatchReviewChange; position: number }[]
		>();

		for (const change of state.batchChanges) {
			const info = chainInfoMap.get(change.changeId);
			if (info?.inChain && info.chainNumber && info.position) {
				const group = chainGroups.get(info.chainNumber) ?? [];
				group.push({ change, position: info.position });
				chainGroups.set(info.chainNumber, group);
			}
		}

		// Check each chain group for completeness
		let colorIdx = 0;
		chainGroups.forEach((items, chainNumber) => {
			// Sort by position
			items.sort((a, b) => a.position - b.position);
			const positions = items.map((item) => item.position);

			if (positions.length === 0) return;

			// Find contiguous run starting from position 1
			// Items in the contiguous run are valid, items after a gap are broken
			let lastValidPosition = 0;
			const validPositions = new Set<number>();
			const brokenPositions = new Set<number>();

			for (const pos of positions) {
				if (pos === lastValidPosition + 1) {
					// Contiguous - this position is valid
					validPositions.add(pos);
					lastValidPosition = pos;
				} else {
					// Gap found - this and all subsequent positions are broken
					brokenPositions.add(pos);
				}
			}

			// If we have broken positions, add a warning
			if (brokenPositions.size > 0) {
				const brokenList = Array.from(brokenPositions).sort(
					(a, b) => a - b
				);
				if (validPositions.size === 0) {
					warnings.push(
						`Chain #${chainNumber} is missing the base (position 1). Add changes 1-${brokenList[0] - 1} to submit.`
					);
				} else {
					warnings.push(
						`Chain #${chainNumber} has a gap after position ${lastValidPosition}. Position(s) ${brokenList.join(', ')} cannot be submitted until the gap is filled.`
					);
				}
			}

			// Assign colors
			const colorClass = `chain-color-${(colorIdx % 5) + 1}`;
			colorIdx++;

			for (const item of items) {
				const existing = chainInfoMap.get(item.change.changeId);
				const isBroken = brokenPositions.has(item.position);
				updatedChainInfo.set(item.change.changeId, {
					...existing,
					inChain: true,
					hasUnsubmittedDependencies: isBroken,
					chainColorClass: isBroken
						? 'chain-warning-glow'
						: colorClass,
				});
			}
		});

		// Merge updated info - only if there are actual changes
		if (updatedChainInfo.size > 0) {
			setChainInfoMap((prev) => {
				const newMap = new Map(prev);
				let hasChanges = false;
				updatedChainInfo.forEach((value, key) => {
					const existing = prev.get(key);
					// Only update if values actually changed
					if (
						!existing ||
						existing.hasUnsubmittedDependencies !==
							value.hasUnsubmittedDependencies ||
						existing.chainColorClass !== value.chainColorClass
					) {
						newMap.set(key, value);
						hasChanges = true;
					}
				});
				return hasChanges ? newMap : prev;
			});
		}

		setChainWarnings(warnings);
		// Only depend on batchChanges - chainInfoMap updates are handled internally
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		state.batchChanges.length,
		state.batchChanges.map((c) => c.changeId).join(','),
	]);

	/**
	 * When items are removed from the batch (via drag-drop or remove button),
	 * clear their chain warning state. Chain warnings should only appear in batch view.
	 */
	useEffect(() => {
		const batchChangeIds = new Set(
			state.batchChanges.map((c) => c.changeId)
		);
		const changedIds = Array.from(chainInfoMap.keys()).filter(
			(id) =>
				!batchChangeIds.has(id) &&
				chainInfoMap.get(id)?.hasUnsubmittedDependencies
		);

		if (changedIds.length > 0) {
			setChainInfoMap((prev) => {
				const newMap = new Map(prev);
				changedIds.forEach((id) => {
					const entry = newMap.get(id);
					if (entry) {
						newMap.set(id, {
							...entry,
							hasUnsubmittedDependencies: false,
							chainColorClass: undefined,
						});
					}
				});
				return newMap;
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		state.batchChanges.length,
		state.batchChanges.map((c) => c.changeId).join(','),
	]);

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

		// Clear chain warning state for removed items
		setChainInfoMap((prev) => {
			const newMap = new Map(prev);
			selectedBatch.forEach((changeID) => {
				const entry = newMap.get(changeID);
				if (entry) {
					// Keep basic chain info but clear warning state
					newMap.set(changeID, {
						...entry,
						hasUnsubmittedDependencies: false,
						chainColorClass: undefined,
					});
				}
			});
			return newMap;
		});

		vscode.postMessage({
			type: 'removeFromBatch',
			body: { changeIDs: Array.from(selectedBatch) },
		});
		setSelectedBatch(new Set());
	};

	const handleClearBatch = () => {
		if (state.batchChanges.length === 0) return;

		// Clear chain warning state for all batch items
		setChainInfoMap((prev) => {
			const newMap = new Map(prev);
			for (const change of state.batchChanges) {
				const entry = newMap.get(change.changeId);
				if (entry) {
					newMap.set(change.changeId, {
						...entry,
						hasUnsubmittedDependencies: false,
						chainColorClass: undefined,
					});
				}
			}
			return newMap;
		});

		vscode.postMessage({ type: 'clearBatch' });
		setSelectedBatch(new Set());
	};

	/**
	 * Helper to apply multi-select operation to a Set
	 */
	const applyMultiSelect = (
		prev: Set<string>,
		changeIDs: string[],
		mode: 'add' | 'replace' | 'remove'
	): Set<string> => {
		if (mode === 'replace') {
			return new Set(changeIDs);
		}
		if (mode === 'remove') {
			const newSet = new Set(prev);
			changeIDs.forEach((id) => newSet.delete(id));
			return newSet;
		}
		// mode === 'add'
		const newSet = new Set(prev);
		changeIDs.forEach((id) => newSet.add(id));
		return newSet;
	};

	const handleYourTurnMultiSelect = (
		changeIDs: string[],
		mode: 'add' | 'replace' | 'remove'
	) => {
		setSelectedYourTurn((prev) => applyMultiSelect(prev, changeIDs, mode));
	};

	const handleBatchMultiSelect = (
		changeIDs: string[],
		mode: 'add' | 'replace' | 'remove'
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
						chainInfoMap={chainInfoMap}
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
						showSeverity={true}
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
											confirmLabel={`+2 All (${state.batchChanges.length})`}
											buttonId="plus2all"
											isArmed={
												armedButtonId === 'plus2all'
											}
											onArmedChange={handleArmedChange}
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
											buttonId="plus2submit"
											isArmed={
												armedButtonId === 'plus2submit'
											}
											onArmedChange={handleArmedChange}
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
