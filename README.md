# ROOT TBrowser

这是一个完全由AI编写的项目。

在 VS Code / Cursor 里直接预览 CERN ROOT 文件（`.root`）。左侧是对象目录，右侧画直方图、画布和几何体。窗口配色按 ROOT TBrowser：经典浅紫背景 `#E6E6FA`，黑色文字，白色画布，对象自己的填充色和 ROOT 6 的 kBird 调色板保持不变。

图形由 [JSROOT](https://root.cern/js/) 在本机绘制，不需要本机或服务器安装 ROOT。

## 和 ROOT File Viewer 的差别

[ROOT File Viewer](https://marketplace.visualstudio.com/items?itemName=albertopdrf.root-file-viewer) 是 workspace 扩展。用 Remote SSH 打开服务器上的文件夹时，VS Code 会把扩展装进服务器上的 VS Code Server。它还会用编辑器主题色盖掉 TBrowser 的浅紫背景。

这个扩展声明为 **UI 扩展**，只在你自己的电脑上运行：

- 打开服务器上的 `.root` 时，不用在服务器执行 Install on SSH。
- Remote SSH 会优先用你电脑上的 `ssh` 按字节区间读取。ROOT 文件的目录在文件末尾，看一个直方图时不会把几个 GB 整个拉下来。
- SSH 登录不了时，改走已经连上的 VS Code 远程连接，把文件缓存到本机再浏览。远程那边仍然只需要 VS Code 自己的 Server，不需要这个扩展。
- WSL 里的文件如果本机 `\\wsl$\` 能看到，就直接按区间读，不复制。

## 安装

在本机窗口里安装，不要选 Install on SSH。

```powershell
cd $env:USERPROFILE\root-tbrowser
npm install
npm run compile
npx @vscode/vsce package
code --install-extension root-tbrowser-0.1.0.vsix
```

开发时用“运行和调试”里的 **运行 ROOT TBrowser**（F5）。

## 使用

打开任意 `.root` 文件，或在资源管理器里右键选择 **用 ROOT TBrowser 打开**。点左侧对象即可画出它。

Remote SSH 窗口里同样直接点服务器上的 `.root`。窗口标题会写明读取方式，例如“SSH 分段读取，服务器无需安装扩展”。

## 设置

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| `rootTbrowser.guiBackground` | `#E6E6FA` | TBrowser 窗口背景。较新的 ROOT 灰色是 `#e8e8e8` |
| `rootTbrowser.layout` | `simple` | 右侧绘图布局，`simple` 最接近 TBrowser |
| `rootTbrowser.palette` | `57` | 默认调色板 kBird |
| `rootTbrowser.onlyLastCycle` | `true` | 只显示最新 cycle |
| `rootTbrowser.remoteRead` | `auto` | `auto` / `ssh` / `download` |
| `rootTbrowser.maxDownloadMB` | `1024` | 整文件缓存上限。SSH 区间读取不受限 |
| `rootTbrowser.sshPath` | `ssh` | 本机 SSH 程序 |

SSH 区间读取使用服务器上已有的 `python3`，通过你本机的 SSH 配置登录（包括 `~/.ssh/config` 里的 Host、跳板和密钥）。它不会往服务器写入文件，也不会往 VS Code Server 里装扩展。如果密钥不在 ssh-agent 里、必须交互输入密码，会自动改用 VS Code 已经建立的远程连接做整文件缓存。
