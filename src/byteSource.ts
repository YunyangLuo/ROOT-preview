import fs from "fs";

/** Random-access bytes. ROOT's directory sits at the end of the file, so callers read ranges. */
export interface ByteSource {
  readonly size: number;
  readonly label: string;
  read(offset: number, length: number): Promise<Buffer>;
  dispose(): Promise<void>;
}

export class LocalFileSource implements ByteSource {
  private closed = false;

  private constructor(
    private readonly handle: fs.promises.FileHandle,
    readonly size: number,
    readonly label: string
  ) {}

  static async open(fsPath: string): Promise<LocalFileSource> {
    const handle = await fs.promises.open(fsPath, "r");
    try {
      const stat = await handle.stat();
      return new LocalFileSource(handle, stat.size, fsPath);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async read(offset: number, length: number): Promise<Buffer> {
    if (length <= 0 || offset >= this.size) {
      return Buffer.alloc(0);
    }
    const available = Math.min(length, this.size - offset);
    const buffer = Buffer.alloc(available);
    const { bytesRead } = await this.handle.read(buffer, 0, available, offset);
    return bytesRead === available ? buffer : buffer.subarray(0, bytesRead);
  }

  async dispose(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.handle.close();
  }
}
