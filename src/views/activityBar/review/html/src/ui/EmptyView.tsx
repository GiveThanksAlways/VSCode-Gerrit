import { sendMessage } from '../lib/messageHandler';
import { globalStyles } from '../lib/styles';
import { createStyles } from '../lib/style';
import * as React from 'react';

export const EmptyView: React.VFC = () => {
	const handleBatchReviewClick = React.useCallback(() => {
		sendMessage({
			type: 'openBatchReview',
		});
	}, []);

	return (
		<div style={styles.emptyMessage}>
			<div style={globalStyles.horizontalCenter}>
				<div style={globalStyles.verticalCenter}>
					<div style={styles.header}>{'No change selected'}</div>
					<div style={styles.batchButtonContainer}>
						<button
							style={styles.batchButton}
							onClick={handleBatchReviewClick}
							title="Open Batch Review to review multiple changes at once"
						>
							<span className="codicon codicon-layers" style={styles.buttonIcon}></span>
							Batch Review
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};

const styles = createStyles({
	header: {
		fontSize: '1.5em',
		fontWeight: 'bold',
	},
	emptyMessage: {
		marginTop: '50px',
	},
	batchButtonContainer: {
		marginTop: '24px',
		display: 'flex',
		justifyContent: 'center',
	},
	batchButton: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '8px',
		padding: '12px 24px',
		fontSize: '14px',
		fontWeight: '600',
		color: 'var(--vscode-button-foreground)',
		backgroundColor: 'var(--vscode-button-background)',
		border: 'none',
		borderRadius: '6px',
		cursor: 'pointer',
		transition: 'all 0.2s ease',
		boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
	},
	buttonIcon: {
		fontSize: '16px',
	},
});
