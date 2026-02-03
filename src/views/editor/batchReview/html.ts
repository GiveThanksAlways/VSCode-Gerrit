import { Uri, Webview } from 'vscode';

export function getHTML(extensionURI: Uri, webview: Webview): string {
	const jsURI = webview.asWebviewUri(
		Uri.joinPath(extensionURI, 'out/batchReview/index.js')
	);

	const codiconsURI = webview.asWebviewUri(
		Uri.joinPath(extensionURI, 'out/batchReview/codicon.css')
	);

	// Modular CSS files
	const cssFiles = [
		'base.css',
		'layout.css',
		'components.css',
		'changes.css',
		'files.css',
		'review.css',
		'chain.css',
		'safety.css',
	];

	const cssLinks = cssFiles
		.map((file) => {
			const uri = webview.asWebviewUri(
				Uri.joinPath(extensionURI, `out/batchReview/css/${file}`)
			);
			return `\t\t<link href="${uri.toString()}" rel="stylesheet" />`;
		})
		.join('\n');

	return `<!DOCTYPE HTML>
<html>
	<head>
	<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Batch Review</title>
		<link href="${codiconsURI.toString()}" rel="stylesheet" />
		${cssLinks}
	</head>
	<body>
		<div id="app"></div>
		<script src="${jsURI.toString()}"></script>
	</body>
</html>`;
}
