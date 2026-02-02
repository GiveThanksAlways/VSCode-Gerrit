import { BatchReviewPerson, BatchReviewLabel } from '../../../../state';
import React, { VFC, useState, useEffect } from 'react';

interface ScorePickerProps {
	label: BatchReviewLabel;
	value: number;
	onChange: (name: string, value: number) => void;
}

export const ScorePicker: VFC<ScorePickerProps> = ({
	label,
	value,
	onChange,
}) => {
	const getScoreStyle = (score: string): string => {
		const scoreNum = parseInt(score.trim(), 10);
		const allValues = label.possibleValues.map((v) =>
			parseInt(v.score.trim(), 10)
		);

		if (scoreNum === 0) return 'score-neutral';
		if (scoreNum === Math.max(...allValues)) return 'score-approved';
		if (scoreNum === Math.min(...allValues)) return 'score-rejected';
		if (scoreNum > 0) return 'score-recommended';
		return 'score-disliked';
	};

	return (
		<div className="score-picker">
			<span className="score-label">{label.name}:</span>
			<div className="score-buttons">
				{label.possibleValues.map((pv, i) => {
					const scoreNum = parseInt(pv.score.trim(), 10);
					const isSelected = value === scoreNum;
					return (
						<button
							key={i}
							className={`score-button ${isSelected ? getScoreStyle(pv.score) : ''}`}
							onClick={() => onChange(label.name, scoreNum)}
							title={pv.description}
						>
							{pv.score.trim()}
						</button>
					);
				})}
			</div>
		</div>
	);
};

interface PeoplePickerProps {
	label: string;
	people: BatchReviewPerson[];
	suggestions: BatchReviewPerson[];
	onChange: (people: BatchReviewPerson[]) => void;
	onSearch: (query: string) => void;
	placeholder?: string;
}

export const PeoplePicker: VFC<PeoplePickerProps> = ({
	label,
	people,
	suggestions,
	onChange,
	onSearch,
	placeholder,
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const containerRef = React.useRef<HTMLDivElement>(null);

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen]);

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setQuery(value);
		setIsOpen(true);
		onSearch(value);
	};

	const handleFocus = () => {
		setIsOpen(true);
		// Trigger search with empty query to load suggestions immediately
		onSearch(query);
	};

	const handleSelect = (person: BatchReviewPerson) => {
		if (!person.locked && !people.some((p) => p.id === person.id)) {
			onChange([...people, person]);
		}
		setQuery('');
		setIsOpen(false);
	};

	const handleRemove = (personId: string | number) => {
		onChange(people.filter((p) => p.id !== personId && !p.locked));
	};

	const filteredSuggestions = suggestions.filter(
		(s) => !people.some((p) => p.id === s.id)
	);

	return (
		<div className="people-picker" ref={containerRef}>
			<span className="picker-label">{label}:</span>
			<div className="picker-input-container">
				<div className="selected-people">
					{people.map((person) => (
						<span
							key={person.id}
							className="person-chip"
							title={person.name}
						>
							{person.shortName}
							{!person.locked && (
								<button
									className="remove-person"
									onClick={() => handleRemove(person.id)}
								>
									×
								</button>
							)}
						</span>
					))}
				</div>
				<input
					type="text"
					value={query}
					onChange={handleInputChange}
					onFocus={handleFocus}
					placeholder={placeholder}
					className="people-input"
				/>
				{isOpen && filteredSuggestions.length > 0 && (
					<div className="suggestions-dropdown">
						{filteredSuggestions.map((person) => (
							<div
								key={person.id}
								className="suggestion-item"
								onClick={() => handleSelect(person)}
							>
								{person.name}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
};
