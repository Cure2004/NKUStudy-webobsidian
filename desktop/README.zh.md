# WebObsidian Desktop (Electron)

将 WebObsidian 打包为可安装的桌面应用，适用于 **macOS / Windows / Linux**
（arm64 · x64 · ia32）。它是围绕未更改的 `server/`（Express）+ `web/`（SPA）的
轻量级 **Electron 外壳**：该外壳将服务器作为子进程启动，
绑定到 `127.0.0.1` 上的一个随机空闲端口，并在 `BrowserWindow` 中加载它。

由于服务器**没有运行时原生模块**，整个服务器被打包为
单个 `.mjs`（使用 esbuild），并且每个 CPU 架构只需打包
匹配的预构建 Electron 二进制文件即可生成——无需交叉编译，无需 `node-gyp`。

## 工作原理

- **首次启动**会提示选择一个仓库（Vault）文件夹（默认 `~/Documents/WebObsidianVault`）。
- 应用数据（`settings.json`、搜索索引）位于 Electron 的每用户 `userData` 目录中。
- 每次安装会生成一个随机密码，作为
  `WEBOBSIDIAN_PASSWORD` 传递给服务器，并用于**自动登录**——无密码提示。
- 菜单 **File → Switch Vault…** 用于切换仓库（Vault）（重新启动以重新建立索引）；
  **Open Vault/Data Folder** 和 **Open Logs** 有助于调试。
- Git 同步需要机器上安装 `git`；没有它，应用仍可进行本地编辑。

## 本地构建

从**仓库根目录**（先构建 web + server，再构建桌面应用）：

```bash
npm install
npm run desktop          # 构建全部内容并启动应用（开发模式）
npm run desktop:dist     # 为当前平台构建安装包 → desktop/release/
```

或直接在 `desktop/` 内（假定已在根目录运行过 `npm run build`）：

```bash
npm run build        # esbuild：dist/（main+preload）+ .gen/server/（server bundle + SPA）
npm start            # 使用已构建的 bundle 启动
npm run dist         # electron-builder → 安装包输出到 desktop/release/
npm run dist:dir     # 快速的非打包构建（无安装程序），用于冒烟测试
```

> 注意：此环境可能会全局导出 `ELECTRON_RUN_AS_NODE=1`（此时 Electron
> 会表现为普通 Node，且 `require('electron')` 返回一个路径）。手动启动
> Electron 时，请清除它：`env -u ELECTRON_RUN_AS_NODE electron dist/main.js`。
> 打包后的应用不受影响。外壳仅为其生成的
> 服务器子进程设置 `ELECTRON_RUN_AS_NODE=1`。

## 发布（GitHub Releases）

CI 工作流 [`.github/workflows/release.yml`](../.github/workflows/release.yml) 在
版本标签上运行，并在三个原生 runner 上并行构建：

```bash
npm version patch -w desktop   # 或按你的偏好提升版本
git tag v0.1.0
git push origin v0.1.0
```

每个 runner（macOS/Windows/Ubuntu）会打包其平台的安装程序，并将
它们上传到该标签对应的**草稿** GitHub Release。当三者全部完成后，在 GitHub 上打开
草稿 release 并点击 **Publish**。

产物：

| Platform | Formats | Arch |
|----------|---------|------|
| macOS    | `.dmg`, `.zip`         | arm64, x64 |
| Windows  | NSIS `.exe`, portable `.exe` | x64, arm64, ia32 |
| Linux    | `.AppImage`, `.deb`    | x64, arm64 |

这些应用**未进行代码签名/公证**，因此用户首次启动时会看到 Gatekeeper /
SmartScreen 警告（对于免费的自托管构建而言这是预期的）。
