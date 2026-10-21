/** vscode-remote authority is `ssh-remote+<host>` or a hex-encoded JSON host descriptor. */
export function sshHostFromAuthority(authority: string): string | undefined {
  const prefix = "ssh-remote+";
  if (!authority.startsWith(prefix)) {
    return undefined;
  }

  let host = authority.slice(prefix.length);
  try {
    host = decodeURIComponent(host);
  } catch {
    // Authority was already decoded.
  }

  let user = "";
  if (/^[0-9a-fA-F]+$/.test(host) && host.length >= 10 && host.length % 2 === 0) {
    try {
      const parsed = JSON.parse(Buffer.from(host, "hex").toString("utf8")) as { hostName?: unknown; user?: unknown };
      if (typeof parsed.hostName === "string" && parsed.hostName.length > 0) {
        host = parsed.hostName;
      }
      if (typeof parsed.user === "string") {
        user = parsed.user;
      }
    } catch {
      // Not a hex JSON authority.
    }
  }

  if (!host || /[\r\n\0]/.test(host) || /[\r\n\0@]/.test(user)) {
    return undefined;
  }
  return user ? `${user}@${host}` : host;
}

/** URI paths from VS Code are POSIX-like, including `/c:/...` for a Windows remote. */
export function remotePosixPath(uriPath: string): string {
  if (/^\/[A-Za-z]:\//.test(uriPath)) {
    return uriPath.slice(1);
  }
  return uriPath;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
