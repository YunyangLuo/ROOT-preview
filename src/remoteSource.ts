import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as vscode from "vscode";
import { LocalFileSource, type ByteSource } from "./byteSource";
import { remotePosixPath, sshHostFromAuthority } from "./sshHost";
import { SshRangeSource } from "./sshSource";

export type ReadMode = "local" | "wsl" | "ssh" | "download";

export interface OpenedRoot {
  source: ByteSource;
  mode: ReadMode;
}

export function modeLabel(mode: ReadMode): string {
  switch (mode) {
    case "local":
      return "本机文件";
    case "wsl":
      return "WSL 路径，本机直接读取";
    case "ssh":
      return "SSH 分段读取，服务器无需安装扩展";
    case "download":
      return "经本机 VS Code 连接缓存，服务器无需安装扩展";
  }
}

export async function openRootBytes(
  uri: vscode.Uri,
  storageDir: string,
  log: vscode.OutputChannel
): Promise<OpenedRoot> {
  if (uri.scheme === "file") {
    return { source: await LocalFileSource.open(uri.fsPath), mode: "local" };
  }

  for (const unc of wslUncPaths(uri)) {
    try {
      await fs.promises.stat(unc);
      log.appendLine(`WSL 文件可在本机直接读取：${unc}`);
      return { source: await LocalFileSource.open(unc), mode: "wsl" };
    } catch (error) {
      log.appendLine(`WSL 路径不可用（${unc}）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const stat = await vscode.workspace.fs.stat(uri);
  const config = vscode.workspace.getConfiguration("rootTbrowser");
  const preference = config.get<string>("remoteRead") ?? "auto";
  const host = sshHostFromAuthority(uri.authority);

  if ((preference === "auto" || preference === "ssh") && host) {
    const sshPath = config.get<string>("sshPath") || "ssh";
    const remotePath = remotePosixPath(uri.path);
    try {
      log.appendLine(`尝试 SSH 分段读取 ${host}:${remotePath}`);
      const source = await SshRangeSource.open(sshPath, host, remotePath);
      log.appendLine(`SSH 已连接，文件大小 ${source.size} 字节`);
      return { source, mode: "ssh" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.appendLine(`SSH 分段读取不可用：${message}`);
      if (preference === "ssh") {
        throw new Error(`无法用 SSH 分段读取 ${host}：${message}`);
      }
    }
  }

  const maxBytes = Math.floor((config.get<number>("maxDownloadMB") ?? 1024) * 1024 * 1024);
  if (stat.size > maxBytes) {
    throw new Error(
      `文件有 ${formatBytes(stat.size)}，超过整文件缓存上限 ${formatBytes(maxBytes)}。` +
        `服务器上不需要安装这个扩展。可以把设置 rootTbrowser.maxDownloadMB 调高，` +
        `或者让本机 ssh 能登录该主机（rootTbrowser.remoteRead = auto），这样只会按需读取用到的字节。`
    );
  }

  log.appendLine(`经 VS Code 远程连接读取整个文件（${formatBytes(stat.size)}），扩展仍只运行在本机`);
  const source = await cacheRemoteFile(uri, stat, storageDir);
  return { source, mode: "download" };
}

function wslUncPaths(uri: vscode.Uri): string[] {
  if (uri.scheme !== "vscode-remote" || !uri.authority.startsWith("wsl+")) {
    return [];
  }
  const distro = decodeURIComponent(uri.authority.slice("wsl+".length));
  if (!distro || /[\\/]/.test(distro)) {
    return [];
  }
  const rest = uri.path.replace(/\//g, "\\");
  return [`\\\\wsl$\\${distro}${rest}`, `\\\\wsl.localhost\\${distro}${rest}`];
}

async function cacheRemoteFile(uri: vscode.Uri, stat: vscode.FileStat, storageDir: string): Promise<LocalFileSource> {
  await fs.promises.mkdir(storageDir, { recursive: true });
  const name =
    crypto.createHash("sha256").update(uri.toString()).update(String(stat.mtime)).update(String(stat.size)).digest("hex") +
    ".root";
  const destination = path.join(storageDir, name);
  try {
    const existing = await fs.promises.stat(destination);
    if (existing.size === stat.size) {
      return LocalFileSource.open(destination);
    }
  } catch {
    // Cache miss.
  }

  const data = await vscode.workspace.fs.readFile(uri);
  const partial = `${destination}.part`;
  await fs.promises.writeFile(partial, data);
  await fs.promises.rename(partial, destination);
  return LocalFileSource.open(destination);
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function baseName(uri: vscode.Uri): string {
  const normalized = uri.path.replace(/\\/g, "/");
  return normalized.split("/").pop() || "file.root";
}
