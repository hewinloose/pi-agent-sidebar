import * as vscode from "vscode";
import { PiViewProvider } from "./provider/piViewProvider.js";

let activeProvider: PiViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel("Pi Agent", { log: true });
	const provider = new PiViewProvider(context, output);
	activeProvider = provider;

	// No window status-bar entry for the runtime phase: `createStatusBarItem(id, …)`
	// only requires an id unique to the extension, so an item named after the view
	// still lands in the window status bar and outlives the sidebar it describes.
	// The phase is rendered in the sidebar header instead.
	context.subscriptions.push(
		output,
		provider,
		vscode.window.registerWebviewViewProvider(
			PiViewProvider.viewType,
			provider,
			// Without this the editor tears down the webview whenever the view is
			// collapsed or another sidebar group is shown, so expanding it again
			// rebuilt the page from scratch: the transcript blanked and then popped
			// back in. The conversation cannot be restored quickly enough to hide
			// that — it means re-running the whole RPC snapshot — which is exactly
			// the case this option exists for. The cost is holding the view's DOM in
			// memory while hidden.
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
		vscode.commands.registerCommand("piAgentSidebar.open", () =>
			provider.openChat().catch((error: unknown) => {
				void vscode.window.showWarningMessage(
					error instanceof Error ? error.message : String(error),
				);
			}),
		),
		vscode.commands.registerCommand("piAgentSidebar.focusInput", () =>
			provider.focusInputWithSelection(vscode.window.activeTextEditor),
		),
		vscode.commands.registerCommand(
			"piAgentSidebar.addFilesToInput",
			(uri: vscode.Uri | undefined, selectedUris: vscode.Uri[] | undefined) =>
				provider
					.addExplorerResources(uri, selectedUris)
					.catch((error: unknown) => {
						void vscode.window.showWarningMessage(
							error instanceof Error ? error.message : String(error),
						);
					}),
		),
		vscode.commands.registerCommand("piAgentSidebar.newSession", async () => {
			await provider.reveal();
			if (!(await provider.createNewSession(true))) {
				void vscode.window.showInformationMessage(
					"pi 会话未改动。",
				);
			}
		}),
		vscode.commands.registerCommand("piAgentSidebar.restart", () =>
			provider.restart(),
		),
		vscode.commands.registerCommand("piAgentSidebar.showLogs", () =>
			output.show(true),
		),
		vscode.commands.registerCommand("piAgentSidebar.renameSession", () =>
			provider.renameSession().catch((error: unknown) => {
				void vscode.window.showWarningMessage(
					error instanceof Error ? error.message : String(error),
				);
			}),
		),
		vscode.commands.registerCommand("piAgentSidebar.exportHtml", () =>
			provider.exportSessionHtml().catch((error: unknown) => {
				void vscode.window.showWarningMessage(
					error instanceof Error ? error.message : String(error),
				);
			}),
		),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			void provider.handleWorkspaceFoldersChanged().catch((error: unknown) => {
				output.appendLine(
					`[workspace] ${error instanceof Error ? error.message : String(error)}`,
				);
			});
		}),
	);
}

export async function deactivate(): Promise<void> {
	const provider = activeProvider;
	activeProvider = undefined;
	if (provider) await provider.shutdown();
}
