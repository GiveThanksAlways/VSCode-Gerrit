import {
	CancellationToken,
	commands,
	Disposable,
	ExtensionContext,
	WebviewView,
	WebviewViewProvider,
	WebviewViewResolveContext,
} from 'vscode';

/**
 * A minimal webview provider that shows a prominent "Batch Review" button
 * at the top of the sidebar, always visible regardless of other views.
 */
class BatchReviewButtonProvider implements WebviewViewProvider, Disposable {
	private _view: WebviewView | undefined;
	private readonly _disposables: Disposable[] = [];

	private constructor(private readonly _context: ExtensionContext) {}

	public static create(context: ExtensionContext): BatchReviewButtonProvider {
		return new this(context);
	}

	public async resolveWebviewView(
		webviewView: WebviewView,
		_context: WebviewViewResolveContext<unknown>,
		_token: CancellationToken
	): Promise<void> {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
		};

		webviewView.webview.html = this._getHtml();

		// Handle button click from webview
		this._disposables.push(
			webviewView.webview.onDidReceiveMessage(async (message) => {
				if (message.type === 'openBatchReview') {
					await commands.executeCommand('gerrit.openBatchReview');
				}
			})
		);
	}

	private _getHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			padding: 8px 12px;
			font-family: var(--vscode-font-family);
		}
		.batch-review-button {
			width: 100%;
			padding: 10px 16px;
			font-size: 13px;
			font-weight: 600;
			color: var(--vscode-button-foreground);
			background: linear-gradient(135deg, 
				var(--vscode-button-background) 0%, 
				color-mix(in srgb, var(--vscode-button-background) 80%, #000) 100%
			);
			border: none;
			border-radius: 4px;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8px;
			transition: all 0.2s ease;
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
		}
		.batch-review-button:hover {
			background: linear-gradient(135deg, 
				var(--vscode-button-hoverBackground) 0%, 
				color-mix(in srgb, var(--vscode-button-hoverBackground) 80%, #000) 100%
			);
			box-shadow: 0 3px 6px rgba(0, 0, 0, 0.2);
			transform: translateY(-1px);
		}
		.batch-review-button:active {
			transform: translateY(0);
			box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
		}
		.icon {
			font-size: 14px;
		}
	</style>
</head>
<body>
	<button class="batch-review-button" onclick="openBatchReview()">
		<span class="icon">◫</span>
		<span>Batch Review</span>
	</button>
	<script>
		const vscode = acquireVsCodeApi();
		function openBatchReview() {
			vscode.postMessage({ type: 'openBatchReview' });
		}
	</script>
</body>
</html>`;
	}

	public dispose(): void {
		this._disposables.forEach((d) => d.dispose());
	}
}

let batchReviewButtonProvider: BatchReviewButtonProvider | null = null;

export function getOrCreateBatchReviewButtonProvider(
	context: ExtensionContext
): BatchReviewButtonProvider {
	if (!batchReviewButtonProvider) {
		batchReviewButtonProvider = BatchReviewButtonProvider.create(context);
	}
	return batchReviewButtonProvider;
}
