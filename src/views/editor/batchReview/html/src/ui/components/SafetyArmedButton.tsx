import React, { VFC, useState } from 'react';

interface SafetyArmedButtonProps {
	onClick: () => void;
	disabled: boolean;
	buttonClassName: string;
	icon: string;
	label: string;
	title: string;
	/** Confirmation message shown in the armed state */
	confirmLabel?: string;
}

/**
 * A button with a safety "arm" mechanism to prevent accidental clicks.
 * Like a missile launch safety cover - you must flip the switch first.
 *
 * Flow:
 * 1. User clicks the safety toggle to "arm" the button
 * 2. The actual action button becomes visible/enabled
 * 3. User clicks the action button to execute
 * 4. Button automatically disarms after action
 */
export const SafetyArmedButton: VFC<SafetyArmedButtonProps> = ({
	onClick,
	disabled,
	buttonClassName,
	icon,
	label,
	title,
	confirmLabel = 'Confirm',
}) => {
	const [isArmed, setIsArmed] = useState(false);

	const handleArmClick = () => {
		setIsArmed(true);
	};

	const handleConfirmClick = () => {
		onClick();
		setIsArmed(false);
	};

	const handleCancelClick = () => {
		setIsArmed(false);
	};

	if (isArmed) {
		return (
			<div className="safety-armed-container armed">
				<div className="safety-armed-backdrop">
					<span className="safety-armed-message">
						<span className="codicon codicon-warning"></span>
						Are you sure?
					</span>
				</div>
				<div className="safety-armed-buttons">
					<button
						onClick={handleConfirmClick}
						disabled={disabled}
						className={`${buttonClassName} safety-confirm-button`}
						title={title}
					>
						<span className={`codicon ${icon}`}></span>
						{confirmLabel}
					</button>
					<button
						onClick={handleCancelClick}
						className="safety-cancel-button"
						title="Cancel"
					>
						<span className="codicon codicon-close"></span>
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="safety-armed-container">
			<button
				onClick={handleArmClick}
				disabled={disabled}
				className={`${buttonClassName} safety-unarmed`}
				title={`${title} (click to arm)`}
			>
				<span className="codicon codicon-shield"></span>
				<span className={`codicon ${icon}`}></span>
				{label}
			</button>
		</div>
	);
};
