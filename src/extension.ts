import * as vscode from "vscode";
import { RootFileEditorProvider } from "./editor";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(RootFileEditorProvider.register(context));
  context.subscriptions.push(
    vscode.commands.registerCommand("rootTbrowser.open", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        void vscode.window.showWarningMessage("没有选中 ROOT 文件。");
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", target, RootFileEditorProvider.viewType);
    })
  );
}

export function deactivate(): void {}
