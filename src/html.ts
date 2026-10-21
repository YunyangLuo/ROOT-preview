import * as vscode from "vscode";

export interface BrowserConfig {
  fileName: string;
  size: number;
  modeLabel: string;
  background: string;
  layout: string;
  palette: number;
  onlyLastCycle: boolean;
  inline?: string;
}

export function browserHtml(
  webview: vscode.Webview,
  styleUri: vscode.Uri,
  libraryUri: vscode.Uri,
  scriptUri: vscode.Uri,
  config: BrowserConfig
): string {
  const nonce = randomNonce();
  const csp = webview.cspSource;
  const payload = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data: blob:; style-src ${csp} 'unsafe-inline'; font-src ${csp} data:; script-src 'nonce-${nonce}' ${csp} 'wasm-unsafe-eval'; connect-src ${csp}; worker-src blob: ${csp};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>ROOT TBrowser</title>
  <style>:root { --tb-bg: ${config.background}; }</style>
</head>
<body>
  <div id="hierarchy"></div>
  <div id="loading">正在打开 ${escapeHtml(config.fileName)} …</div>
  <pre id="error" hidden></pre>
  <script id="cfg" type="application/json" nonce="${nonce}">${payload}</script>
  <script nonce="${nonce}">
    window.addEventListener("error", function (event) {
      var loading = document.getElementById("loading");
      var box = document.getElementById("error");
      if (loading) loading.hidden = true;
      if (box) {
        box.hidden = false;
        box.textContent = (event.message || "脚本错误") + (event.filename ? "\\n" + event.filename : "");
      }
    });
  </script>
  <script nonce="${nonce}" src="${libraryUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    body { margin: 0; background: #E6E6FA; color: #111; font-family: Verdana, Geneva, Arial, Helvetica, sans-serif; }
    pre { white-space: pre-wrap; padding: 24px; }
  </style>
</head>
<body><pre>${escapeHtml(message)}</pre></body>
</html>`;
}

export function sanitizeColor(value: string | undefined, fallback: string): string {
  if (value && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }
  return fallback;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function randomNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return nonce;
}
