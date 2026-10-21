import path from "path";
import * as vscode from "vscode";
import type { ByteSource } from "./byteSource";
import { browserHtml, errorHtml, sanitizeColor } from "./html";
import { baseName, modeLabel, openRootBytes } from "./remoteSource";

const CHUNK = 256 * 1024;

export class RootFileEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = "rootTbrowser.file";

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(RootFileEditorProvider.viewType, new RootFileEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  private readonly log: vscode.OutputChannel;

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.log = vscode.window.createOutputChannel("ROOT TBrowser");
    context.subscriptions.push(this.log);
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    let source: ByteSource | undefined;
    let panelGone = false;
    webviewPanel.onDidDispose(() => {
      panelGone = true;
    });
    try {
      const opened = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `ROOT TBrowser：正在连接 ${baseName(document.uri)}`,
        },
        () => openRootBytes(document.uri, path.join(this.context.globalStorageUri.fsPath, "cache"), this.log)
      );
      source = opened.source;
      if (panelGone) {
        await source.dispose();
        return;
      }
      const magic = await source.read(0, 4);
      if (magic.toString("ascii") !== "root") {
        throw new Error("文件头不是 root，这不是 CERN ROOT 文件。");
      }

      const config = vscode.workspace.getConfiguration("rootTbrowser");
      const background = sanitizeColor(config.get<string>("guiBackground"), "#E6E6FA");
      const inlineLimit = 8 * 1024 * 1024;
      const inline = source.size <= inlineLimit ? Buffer.from(await source.read(0, source.size)).toString("base64") : undefined;
      const disposed = { current: false };
      webviewPanel.onDidDispose(() => {
        disposed.current = true;
        void source?.dispose();
      });
      webviewPanel.webview.onDidReceiveMessage((message: WebMessage) => {
        if (message?.type === "log") {
          this.log.appendLine(String(message.text ?? ""));
          return;
        }
        if (disposed.current || !source) {
          return;
        }
        void this.reply(webviewPanel.webview, source, message);
      });

      const media = (...parts: string[]) =>
        webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts));
      webviewPanel.webview.html = browserHtml(
        webviewPanel.webview,
        media("media", "tbrowser.css"),
        media("vendor", "jsroot", "build", "jsroot.js"),
        media("media", "browser.js"),
        {
          fileName: baseName(document.uri),
          size: source.size,
          modeLabel: modeLabel(opened.mode),
          background,
          layout: config.get<string>("layout") || "simple",
          palette: config.get<number>("palette") ?? 57,
          onlyLastCycle: config.get<boolean>("onlyLastCycle") ?? true,
          inline,
        }
      );
      this.log.appendLine(`已打开 ${document.uri.toString()}（${modeLabel(opened.mode)}）`);
    } catch (error) {
      await source?.dispose();
      const message = error instanceof Error ? error.message : String(error);
      this.log.appendLine(message);
      webviewPanel.webview.html = errorHtml(message);
      void vscode.window.showErrorMessage(message);
    }
  }

  private async reply(webview: vscode.Webview, source: ByteSource, message: WebMessage): Promise<void> {
    if (!message || message.type !== "read" || typeof message.id !== "number") {
      return;
    }
    try {
      const bytes = await source.read(message.pos ?? 0, message.sz ?? 0);
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const slice = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK));
        await webview.postMessage({ type: "chunk", id: message.id, data: Buffer.from(slice).toString("base64") });
      }
      await webview.postMessage({ type: "end", id: message.id, total: bytes.length });
    } catch (error) {
      await webview.postMessage({
        type: "fail",
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

interface WebMessage {
  type?: string;
  id?: number;
  pos?: number;
  sz?: number;
  text?: string;
}
