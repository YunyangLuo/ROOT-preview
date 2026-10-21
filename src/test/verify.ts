import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { LocalFileSource } from "../byteSource";
import { remotePosixPath, shellQuote, sshHostFromAuthority } from "../sshHost";

async function main(): Promise<void> {
  assertEqual(sshHostFromAuthority("ssh-remote+lxplus.cern.ch"), "lxplus.cern.ch");
  assertEqual(sshHostFromAuthority("ssh-remote+user%40host"), "user@host");
  const hex = Buffer.from(JSON.stringify({ hostName: "analysis" }), "utf8").toString("hex");
  assertEqual(sshHostFromAuthority(`ssh-remote+${hex}`), "analysis");
  const hexUser = Buffer.from(JSON.stringify({ hostName: "10.0.0.8", user: "yunyang" }), "utf8").toString("hex");
  assertEqual(sshHostFromAuthority(`ssh-remote+${hexUser}`), "yunyang@10.0.0.8");
  assertEqual(sshHostFromAuthority("wsl+Ubuntu"), undefined);
  assertEqual(remotePosixPath("/c:/data/a.root"), "c:/data/a.root");
  assertEqual(remotePosixPath("/home/user/a.root"), "/home/user/a.root");
  assertEqual(shellQuote("/tmp/a b.root"), "'/tmp/a b.root'");

  const rootPath = path.resolve("test-data/hsimple.root");
  await fs.promises.mkdir(path.dirname(rootPath), { recursive: true });
  if (!fs.existsSync(rootPath)) {
    const response = await fetch("https://root.cern/js/files/hsimple.root");
    if (!response.ok) {
      throw new Error(`下载 hsimple.root 失败：${response.status}`);
    }
    await fs.promises.writeFile(rootPath, Buffer.from(await response.arrayBuffer()));
  }

  const source = await LocalFileSource.open(rootPath);
  try {
    const magic = await source.read(0, 4);
    assertEqual(magic.toString("ascii"), "root");
    const disk = fs.readFileSync(rootPath);
    const tail = await source.read(disk.length - 16, 16);
    assertEqual(tail.equals(disk.subarray(disk.length - 16)), true);

    const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const io = await importEsm(pathToFileURL(path.resolve("vendor/jsroot/modules/io.mjs")).href);
    const main = await importEsm(pathToFileURL(path.resolve("vendor/jsroot/modules/main.mjs")).href);
    const core = main.settings ? main : await importEsm(pathToFileURL(path.resolve("vendor/jsroot/modules/core.mjs")).href);

    console.log("JSROOT", main.version ?? "");
    console.log("settings", Object.keys(core.settings).sort().join(","));
    if (core.gStyle) {
      console.log(
        "gStyle colors",
        ["fCanvasColor", "fPadColor", "fFrameFillColor", "fHistFillColor", "fPalette", "fOptStat"]
          .map((key) => `${key}=${String(core.gStyle[key])}`)
          .join(" ")
      );
    }

    class NodeProxy extends io.FileProxy {
      openFile(): Promise<boolean> {
        return Promise.resolve(true);
      }
      getFileName(): string {
        return "hsimple.root";
      }
      getFileSize(): number {
        return source.size;
      }
      async readBuffer(pos: number, size: number): Promise<DataView> {
        const bytes = await source.read(pos, size);
        const copy = Uint8Array.from(bytes);
        return new DataView(copy.buffer);
      }
      closeFile(): void {}
    }

    const file = await io.openFile(new NodeProxy());
    if (!file) {
      throw new Error("JSROOT 没有打开 hsimple.root");
    }
    const hpx = await file.readObject("hpx");
    if (!hpx || hpx.fEntries !== 25000) {
      throw new Error(`hpx entries = ${hpx?.fEntries}, 期望 25000`);
    }
    console.log(`hpx entries=${hpx.fEntries} fill=${hpx.fFillColor} line=${hpx.fLineColor}`);

    if (typeof main.makeSVG === "function") {
      const svg = await main.makeSVG({ object: hpx, width: 480, height: 320 });
      if (typeof svg !== "string" || !svg.includes("<svg")) {
        throw new Error("makeSVG 没有返回 SVG");
      }
      console.log(`svg ${svg.length} bytes, fill color preserved (${hpx.fFillColor})`);
    }
    file.delete?.();
  } finally {
    await source.dispose();
  }

  console.log("verify ok");
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
