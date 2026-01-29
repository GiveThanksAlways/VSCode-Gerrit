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
		<div style={styles.container}>
			<div style={styles.emptyMessage}>
				<div style={globalStyles.horizontalCenter}>
					<div style={globalStyles.verticalCenter}>
						<div style={styles.header}>{'No change selected'}</div>
						<div style={styles.subtext}>
							Select a change from "Your Turn" or use Batch Review
						</div>
					</div>
				</div>
			</div>
			<div style={styles.batchButtonContainer}>
				<button
					style={styles.batchButton}
					onClick={handleBatchReviewClick}
					title="Open Batch Review to review multiple changes at once"
					onMouseOver={(e) => {
						e.currentTarget.style.transform = 'translateY(-1px)';
						e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
					}}
					onMouseOut={(e) => {
						e.currentTarget.style.transform = 'translateY(0)';
						e.currentTarget.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.1)';
					}}
				>
					<span className="codicon codicon-layers" style={styles.buttonIcon}></span>
					Batch Review
				</button>
			</div>
		</div>
	);
};

const styles = createStyles({
	container: {
		display: 'flex',
		flexDirection: 'column',
		height: '100%',
		padding: '0 12px',
	},
	header: {
		fontSize: '1.3em',
		fontWeight: 'bold',
		color: 'var(--vscode-foreground)',
	},
	subtext: {
		marginTop: '8px',
		fontSize: '12px',
		color: 'var(--vscode-descriptionForeground)',
		textAlign: 'center',
	},
	emptyMessage: {
		marginTop: '40px',
		marginBottom: '24px',
	},
	batchButtonContainer: {
		width: '100%',
		marginTop: '8px',
	},
	batchButton: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '10px',
		width: '100%',
		padding: '14px 20px',
		fontSize: '14px',
		fontWeight: '600',
		letterSpacing: '0.3px',
		color: 'var(--vscode-button-foreground)',
		background: 'linear-gradient(180deg, var(--vscode-button-hoverBackground) 0%, var(--vscode-button-background) 100%)',
		border: 'none',
		borderRadius: '4px',
		cursor: 'pointer',
		transition: 'all 0.2s ease',
		boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
	},
	buttonIcon: {
		fontSize: '16px',
	},
});
