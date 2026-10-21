import { cp, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";

const src = "node_modules/jsroot";
if (!existsSync(src)) {
  console.error("node_modules/jsroot 不存在，先执行 npm install");
  process.exit(1);
}

await rm("vendor/jsroot", { recursive: true, force: true });
await mkdir("vendor/jsroot", { recursive: true });

for (const dir of ["modules", "fonts", "style", "img"]) {
  if (!existsSync(`${src}/${dir}`)) {
    continue;
  }
  await cp(`${src}/${dir}`, `vendor/jsroot/${dir}`, { recursive: true });
}

await mkdir("vendor/jsroot/build", { recursive: true });
await cp(`${src}/build/jsroot.js`, "vendor/jsroot/build/jsroot.js");

console.log("已复制 JSROOT 到 vendor/jsroot");
