import { globalStyles } from '../lib/styles';
import { createStyles } from '../lib/style';
import * as React from 'react';

export const EmptyView: React.VFC = () => {
	return (
		<div style={styles.container}>
			<div style={styles.emptyMessage}>
				<div style={globalStyles.horizontalCenter}>
					<div style={globalStyles.verticalCenter}>
						<div style={styles.header}>{'No change selected'}</div>
						<div style={styles.subtext}>
							Select a change from "Your Turn" or use Batch Review
							above
						</div>
					</div>
				</div>
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
});
