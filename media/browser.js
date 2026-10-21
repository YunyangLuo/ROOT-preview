/* Same flow as the VS Code ROOT File Viewer (HierarchyPainter + openRootFile).
   Remote bytes are already in the page, because a UI extension cannot serve
   vscode-remote file URIs the way a workspace extension can. */
(function () {
  const vscode = acquireVsCodeApi();
  const config = JSON.parse(document.getElementById("cfg").textContent);
  const loading = document.getElementById("loading");
  const errorBox = document.getElementById("error");

  function report(text) {
    vscode.postMessage({ type: "log", text: String(text) });
  }

  function fail(error) {
    loading.hidden = true;
    errorBox.hidden = false;
    errorBox.textContent = error && error.stack ? error.stack : String(error);
    report(errorBox.textContent);
  }

  const jsroot = globalThis.JSROOT;
  if (!jsroot || !jsroot.HierarchyPainter || !jsroot.openFile) {
    fail(new Error("绘图库 JSROOT 没有加载。"));
    return;
  }

  const settings = jsroot.settings;
  settings.DarkMode = false;
  settings.IgnoreUrlOptions = true;
  settings.HierarchyLimit = 5000;
  settings.BrowserWidth = 340;
  if ("OnlyLastCycle" in settings) {
    settings.OnlyLastCycle = config.onlyLastCycle;
  }
  if ("Palette" in settings) {
    settings.Palette = config.palette;
  }
  const gStyle = jsroot.gStyle;
  if (gStyle) {
    assign(gStyle, "fCanvasColor", 0);
    assign(gStyle, "fPadColor", 0);
    assign(gStyle, "fFrameFillColor", 0);
    assign(gStyle, "fFrameLineColor", 1);
    assign(gStyle, "fHistLineColor", 1);
    assign(gStyle, "fStatColor", 0);
    assign(gStyle, "fStatTextColor", 1);
    assign(gStyle, "fTitleColor", 0);
    assign(gStyle, "fTitleTextColor", 1);
  }

  const h = new jsroot.HierarchyPainter("ROOT File Hierarchy");
  h.background = config.background;
  h.no_select = true;
  h.show_overflow = true;
  h.top_info = config.fileName;
  h.prepareGuiDiv("hierarchy", config.layout);

  h.createBrowser("browser").then(function () {
    return h.openRootFile(openArgument(jsroot));
  }).then(function (opened) {
    loading.hidden = true;
    if (opened === false) {
      throw new Error("JSROOT 没有打开这个 ROOT 文件。");
    }
    const first = firstDrawable(h);
    if (!first) {
      report("文件已打开，目录里没有直方图。条目：" + sampleKinds(h));
      return;
    }
    report("绘制 " + first.kind + " " + first.name);
    return h.display(first.name, first.option).then(function () {
      if (typeof h.checkResize === "function") {
        h.checkResize();
      }
      report("预览已就绪");
    });
  }).catch(fail);

  window.addEventListener("resize", function () {
    if (typeof h.checkResize === "function") {
      h.checkResize();
    }
  });

  function openArgument(JSROOT) {
    if (config.inline) {
      return decodeBase64(config.inline).buffer;
    }

    let nextId = 1;
    const pending = new Map();
    window.addEventListener("message", function (event) {
      const message = event.data;
      if (!message || typeof message.id !== "number") {
        return;
      }
      const reader = pending.get(message.id);
      if (!reader) {
        return;
      }
      try {
        if (message.type === "chunk") {
          const bytes = decodeBase64(message.data);
          reader.chunks.push(bytes);
          reader.received += bytes.byteLength;
          return;
        }
        pending.delete(message.id);
        if (message.type === "fail") {
          reader.reject(new Error(message.error || "读取失败"));
          return;
        }
        const out = new Uint8Array(reader.received);
        let offset = 0;
        for (const chunk of reader.chunks) {
          out.set(chunk, offset);
          offset += chunk.byteLength;
        }
        reader.resolve(new DataView(out.buffer));
      } catch (error) {
        pending.delete(message.id);
        reader.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    class ExtensionFileProxy extends JSROOT.FileProxy {
      openFile() {
        return Promise.resolve(true);
      }
      getFileName() {
        return config.fileName;
      }
      getFileSize() {
        return config.size;
      }
      readBuffer(pos, size) {
        const id = nextId++;
        const reader = {};
        reader.chunks = [];
        reader.received = 0;
        reader.promise = new Promise(function (resolve, reject) {
          reader.resolve = resolve;
          reader.reject = reject;
        });
        pending.set(id, reader);
        vscode.postMessage({ type: "read", id: id, pos: pos, sz: size });
        return reader.promise;
      }
      closeFile() {}
    }

    return new ExtensionFileProxy();
  }
})();

function decodeBase64(data) {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function className(kind) {
  const text = String(kind || "");
  return text.indexOf("ROOT.") === 0 ? text.slice(5) : text;
}

function firstDrawable(painter) {
  let found;
  painter.forEachItem(function (item) {
    if (found) {
      return;
    }
    const name = className(item._kind);
    if (/^TH[123]|^TProfile|^TGraph|^TCanvas|^TMultiGraph|^TEfficiency|^TF[123]/.test(name)) {
      found = {
        name: painter.itemFullName(item),
        kind: name,
        option: /^TH2|^TH3|^TProfile2|^TProfile3/.test(name) ? "colz" : "",
      };
    }
  });
  return found;
}

function sampleKinds(painter) {
  const kinds = [];
  painter.forEachItem(function (item) {
    if (kinds.length >= 8 || !item._kind) {
      return;
    }
    kinds.push(className(item._kind));
  });
  return kinds.length ? kinds.join(", ") : "空";
}

function assign(target, key, value) {
  if (target && key in target) {
    target[key] = value;
  }
}
