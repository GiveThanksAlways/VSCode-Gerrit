import React, { VFC, useEffect, useRef } from 'react';

interface SafetyArmedButtonProps {
	onClick: () => void;
	disabled: boolean;
	buttonClassName: string;
	icon: string;
	label: string;
	title: string;
	/** Confirmation message shown in the armed state */
	confirmLabel?: string;
	/** Unique ID for this button (used to coordinate with other safety buttons) */
	buttonId?: string;
	/** Externally controlled armed state */
	isArmed?: boolean;
	/** Callback when arm state changes */
	onArmedChange?: (buttonId: string, armed: boolean) => void;
}

/**
 * A button with a safety "arm" mechanism to prevent accidental clicks.
 * Like a missile launch safety cover - you must flip the switch first.
 *
 * Flow:
 * 1. User clicks the button to "arm" it
 * 2. A confirmation popup appears above/below the button
 * 3. User clicks confirm to execute or cancel to disarm
 * 4. Button automatically disarms after action or timeout
 *
 * The button size stays consistent - only the popup appears/disappears.
 */
export const SafetyArmedButton: VFC<SafetyArmedButtonProps> = ({
	onClick,
	disabled,
	buttonClassName,
	icon,
	label,
	title,
	confirmLabel = 'Confirm',
	buttonId,
	isArmed: externalIsArmed,
	onArmedChange,
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	// Use external state if provided, otherwise internal state
	const [internalIsArmed, setInternalIsArmed] = React.useState(false);
	const isControlled =
		buttonId !== undefined &&
		externalIsArmed !== undefined &&
		onArmedChange !== undefined;
	const isArmed = isControlled ? externalIsArmed : internalIsArmed;

	const setArmed = (armed: boolean) => {
		if (isControlled) {
			onArmedChange!(buttonId!, armed);
		} else {
			setInternalIsArmed(armed);
		}
	};

	// Auto-disarm after a timeout for safety
	useEffect(() => {
		if (isArmed) {
			const timer = setTimeout(() => {
				setArmed(false);
			}, 10000); // 10 second timeout
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [isArmed]);

	// Close popup when clicking outside
	useEffect(() => {
		if (!isArmed) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setArmed(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isArmed]);

	const handleArmClick = () => {
		setArmed(true);
	};

	const handleConfirmClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		onClick();
		setArmed(false);
	};

	const handleCancelClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		setArmed(false);
	};

	return (
		<div className="safety-button-wrapper" ref={containerRef}>
			<button
				onClick={handleArmClick}
				disabled={disabled}
				className={`${buttonClassName} ${isArmed ? 'safety-active' : ''}`}
				title={title}
			>
				<span className={`codicon ${icon}`}></span>
				{label}
			</button>
			{isArmed && (
				<div className="safety-popup">
					<div className="safety-popup-header">
						<span className="codicon codicon-warning"></span>
						<span>Are you sure?</span>
					</div>
					<div className="safety-popup-actions">
						<button
							onClick={handleConfirmClick}
							disabled={disabled}
							className="safety-popup-confirm"
							title={title}
						>
							<span className="codicon codicon-check"></span>
							{confirmLabel}
						</button>
						<button
							onClick={handleCancelClick}
							className="safety-popup-cancel"
							title="Cancel"
						>
							<span className="codicon codicon-close"></span>
						</button>
					</div>
				</div>
			)}
		</div>
	);
};
