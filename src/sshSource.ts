import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { ByteSource } from "./byteSource";
import { shellQuote } from "./sshHost";

const HANDSHAKE = "ROOTTB ";
const MAX_RANGE = 64 * 1024 * 1024;

const REMOTE_PYTHON = `
import sys, os
path = sys.argv[2]
f = open(path, "rb")
size = os.path.getsize(path)
out = sys.stdout.buffer
inp = sys.stdin.buffer
out.write(("ROOTTB %d\\n" % size).encode("ascii"))
out.flush()
while True:
    hdr = inp.read(16)
    if len(hdr) < 16:
        break
    off = int.from_bytes(hdr[:8], "big")
    ln = int.from_bytes(hdr[8:], "big")
    if ln > 67108864:
        break
    f.seek(off)
    data = f.read(ln)
    out.write(len(data).to_bytes(8, "big"))
    out.write(data)
    out.flush()
`;

class ByteQueue {
  private parts: Buffer[] = [];
  private length = 0;
  private closed = false;
  private failure: Error | undefined;
  private waiter: (() => void) | undefined;

  push(chunk: Buffer): void {
    if (chunk.length === 0) {
      return;
    }
    this.parts.push(chunk);
    this.length += chunk.length;
    this.wake();
  }

  end(error?: Error): void {
    this.closed = true;
    this.failure = error;
    this.wake();
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.();
  }

  async take(count: number): Promise<Buffer> {
    while (this.length < count) {
      if (this.closed) {
        throw this.failure ?? new Error("SSH 连接已关闭");
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }

    const out = Buffer.alloc(count);
    let filled = 0;
    while (filled < count) {
      const head = this.parts[0];
      const need = count - filled;
      if (head.length <= need) {
        head.copy(out, filled);
        filled += head.length;
        this.parts.shift();
      } else {
        head.copy(out, filled, 0, need);
        this.parts[0] = head.subarray(need);
        filled += need;
      }
    }
    this.length -= count;
    return out;
  }
}

/**
 * Keeps one local SSH process open and asks the remote Python (already on the server)
 * for byte ranges. Nothing is installed into the remote VS Code server.
 */
export class SshRangeSource implements ByteSource {
  readonly label: string;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly incoming: ByteQueue,
    readonly size: number,
    readonly host: string
  ) {
    this.label = `ssh ${host}`;
  }

  static open(sshPath: string, host: string, remotePath: string, timeoutMs = 20000): Promise<SshRangeSource> {
    const encoded = Buffer.from(REMOTE_PYTHON, "utf8").toString("base64");
    const remoteCommand = `python3 -c "import base64,sys; exec(base64.b64decode(sys.argv[1]).decode())" ${shellQuote(encoded)} ${shellQuote(remotePath)}`;
    const child = spawn(
      sshPath,
      ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", host, remoteCommand],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );

    const incoming = new ByteQueue();
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => incoming.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });
    child.on("error", (error) => incoming.end(error));
    child.on("close", () => {
      const detail = stderr.trim();
      incoming.end(new Error(detail ? `SSH 已退出：${detail}` : "SSH 已退出"));
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("SSH 握手超时"));
      }, timeoutMs);

      const fail = (error: Error) => {
        clearTimeout(timer);
        child.kill();
        reject(error);
      };

      child.on("error", (error) => fail(error));

      void (async () => {
        try {
          const line = (await readLine(incoming)).trim();
          if (!line.startsWith(HANDSHAKE)) {
            throw new Error(`SSH 没有返回文件大小：${line || stderr.trim() || "无输出"}`);
          }
          const size = Number(line.slice(HANDSHAKE.length));
          if (!Number.isFinite(size) || size < 0) {
            throw new Error(`无法解析远端文件大小：${line}`);
          }
          clearTimeout(timer);
          resolve(new SshRangeSource(child, incoming, size, host));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  }

  async read(offset: number, length: number): Promise<Buffer> {
    if (this.disposed) {
      throw new Error("SSH 读取已经关闭");
    }
    if (length <= 0 || offset >= this.size) {
      return Buffer.alloc(0);
    }
    const available = Math.min(length, this.size - offset);
    const chunks: Buffer[] = [];
    let position = offset;
    let remaining = available;
    while (remaining > 0) {
      const count = Math.min(remaining, MAX_RANGE);
      const run = this.chain.then(() => this.readNow(position, count));
      this.chain = run.then(
        () => undefined,
        () => undefined
      );
      chunks.push(await run);
      position += count;
      remaining -= count;
    }
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  }

  private async readNow(offset: number, length: number): Promise<Buffer> {
    const header = Buffer.alloc(16);
    header.writeBigUInt64BE(BigInt(offset), 0);
    header.writeBigUInt64BE(BigInt(length), 8);
    await writeFully(this.child, header);
    const declared = await this.incoming.take(8);
    const count = Number(declared.readBigUInt64BE(0));
    if (count === 0) {
      return Buffer.alloc(0);
    }
    if (count > MAX_RANGE) {
      throw new Error(`SSH 返回的数据块过大：${count}`);
    }
    return this.incoming.take(count);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.child.stdin.end();
    this.child.kill();
  }
}

async function readLine(queue: ByteQueue): Promise<string> {
  const parts: Buffer[] = [];
  for (let i = 0; i < 256; i++) {
    const byte = await queue.take(1);
    parts.push(byte);
    if (byte[0] === 0x0a) {
      break;
    }
  }
  return Buffer.concat(parts).toString("utf8");
}

function writeFully(child: ChildProcessWithoutNullStreams, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    child.stdin.write(buffer, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
