# PRD — WebObsidian

> Product Requirements Document
> 版本：1.5 · 更新：2026-06-22 · 状态：Draft
> 更新日志 1.5（FR-13 — 跨平台 Electron 桌面应用，应需求方要求）：新增 **FR-13** ——
> 将 WebObsidian 打包为 macOS/Windows/Linux（arm64/x64/ia32）的**安装版应用**。新工作区 `desktop/`
> 是一个 **Electron shell**，将现有的 Express 服务器作为子进程启动（通过 `ELECTRON_RUN_AS_NODE`，
> 绑定 `127.0.0.1` + 随机端口），并在 `BrowserWindow` 中加载 SPA。服务器经 esbuild 打包为
> **单个 `.mjs` 文件**（运行时无原生模块，因此跨架构只需替换 Electron 二进制文件）。首次启动**选择
> 仓库（Vault）**，数据存入 `userData`，通过随机/机器生成的密码**自动登录**（不强制改密）。打包
> 使用 **electron-builder**（dmg/zip · nsis/portable · AppImage/deb）；新增 CI `release.yml`，在推送
> `v*` 标签时构建 macOS/Windows/Ubuntu 矩阵并发布 **GitHub Release**。不改动 server/web 代码。
> 更新日志 1.4（FR-2 — 音视频嵌入：像 Obsidian 一样可播放，应需求方要求）：嵌入
> `![[clip.mp4]]` / `![[song.mp3]]` 现在在 Live Preview、Reading view 以及 public share 页面上
> **都能**渲染出**真正的 HTML5 播放器**（`<video controls>` / `<audio controls>`）—— 此前只显示蓝色链接。
> 从文件树直接打开媒体文件也会显示播放器（与图片一致）。支持视频：`mp4/webm/ogv/mov/mkv`，
> 音频：`mp3/wav/m4a/3gp/flac/ogg/oga/opus`（与 Obsidian 的扩展名集合一致）。尺寸参数 `![[clip.mp4|W]]`
> 设置视频宽度。**重要：** 二进制文件服务路由（`GET /api/files/content`、raw share）现在
> **流式传输 + 支持 HTTP Range**（206 Partial Content），因此视频进度条/拖动可用且 Safari 能够
> 播放 —— 而不再是把整个文件读入内存。MIME 映射 + 扩展名集合统一到 `server/services/mime.ts` &
> `web/lib/media.ts`。不新增 API。
> 更新日志 1.3（FR-1 — 文件浏览器头部工具栏对齐 Obsidian，应需求方要求）：**Files** 侧边栏头部
> 补齐了与 Obsidian 一致的按钮：**New note**、**New canvas**、**New folder**、**Change sort order**
> （下拉 6 种：File name A→Z/Z→A、Modified time new↔old、Created time new↔old）、**Auto reveal current
> file**（开关：自动展开父文件夹 + 滚动到当前查看的文件）、**Collapse all / Expand all**。按时间排序
> 之所以快，得益于服务器端 RAM 中的 stat 缓存（`listTree` 只填充一次，watcher 使变更的文件失效 → 稳态下
> 0 次系统调用）；`TreeNode` 新增 `ctime`。不新增 API（原 tree 现在附带 `mtime`/`ctime`）。Canvas（FR-12）：
> 修复 Android Chrome 双击编辑无法保存文本的问题（通过 doc-level pointerdown + double-tap 检测提交）。
> 更新日志 1.2（FR-2 — 图片：resize + zoom，应需求方要求）：笔记中嵌入的图片现在**可拖动
> resize**（在 Live Preview 中悬停时显示左右两个 handle 条）—— 将尺寸以 Obsidian 尺寸参数形式
> 写回源文件：wikilink embed 用 `![[img|W]]`，标准 markdown 图片用 `![alt|W](url)`（保持比例，
> height auto）。尺寸参数 `|300` / `|300x200` 现在**同时**适用于 markdown 图片 `![](…)`（此前仅 `![[…]]`），
> 且在 Live 和 Reading 中都适用。**点击图片 → 全屏 lightbox**（两种 mode 均有）：滚轮/pinch 缩放（以
> 光标/双指中心为基准）、拖动/单指 pan、double-click 重置、Esc 或点击背景关闭。不新增 API。
> 更新日志 1.1（FR-1 — Trash UI + 删除模式，应需求方要求）：新增 **Trash 界面**，用于查看、
> **恢复（Restore）**和**永久删除**已删除的单个文件，以及 **Empty trash** 按钮。从 Files 侧边栏头部的
> 🗑 按钮或命令面板（"Open trash"）打开 Trash。新增设置 `vault.deleteMode`
> （`trash` = 移入 `.trash` 可恢复 [默认] · `permanent` = 立即永久删除），位于
> Settings → Vault & Files。新增 API：`GET /api/files/trash`、`POST /api/files/trash/restore`、
> `DELETE /api/files/trash/item`、`DELETE /api/files/trash`。Restore 会自动避开重名（后缀 `.restored-<ts>`）
> 并清理 `.trash` 中的空目录；所有 trash 操作都有 path traversal guard（仅作用于 `.trash` 内）。
> 更新日志 1.0（FR-12 — Canvas，应需求方要求）：克隆 Obsidian 的 **Canvas** 功能。无限画布
> （pan/zoom）包含各种 node（markdown 文本、指向 note 或图片的 file embed/link、URL link、group）以及
> 带箭头 + 标签连接 node 边缘的 edge。按开放格式 **JSON Canvas**（`.canvas`，兼容
> Obsidian）读写。创建/移动/resize/改色/删除 node，从边缘圆点拖拽连接 edge，multi-select + marquee，
> double-click 背景创建 text node，double-click text node 进行编辑。像 editor 一样防抖 autosave（通过 store
> `content`/`save`）。新建 canvas：file tree 右键菜单 + command palette。不新增 API（使用
> `/api/files/content`）。
> 更新日志 0.9（FR-1 — 按需求方要求在 file tree 右键菜单中加入 Copy/Cut/Paste）：文件/文件夹右键菜单
> 新增 **Copy**、**Cut**、**Paste**（clipboard 为 session-local，不 persist/不 broadcast）。Cut 对文件
> 和文件夹都使用 `rename`（move）；Copy 使用新 endpoint **POST `/api/files/copy`** 递归复制文件/文件夹
> （通过 `fs.cp` recursive，并重建新增 `.md` 的索引）。Paste 到目标 folder（被 click 的 folder 或文件的父目录）：
> 自动设置不重名（`… copy`/`… copy N`），阻止将 folder 粘贴到它自身/子目录，将 Cut 粘回原处是
> no-op；被 Cut 的行变暗等待粘贴；仅当 clipboard 有数据时才显示 **Paste** 项。右键 file tree 的空白区域
> 也会弹出应用的右键菜单（在 vault root 中 New note / New folder / Paste），而非浏览器原生菜单。
> 更新日志 0.8（FR-2/FR-4 — 按需求方要求对齐 Obsidian 的 ⋯ 菜单）：**More options (⋯)** 菜单
> 按 Obsidian Desktop 结构重建并新增：**Backlinks in document** + **Open linked view**
> （Backlinks/Outgoing links/Outline → 打开 right panel）；**Open in new window**（在新标签页打开 deep-link `/note/<path>`）；
> **Add file property**（向 frontmatter YAML 插入空 property）；note 内的 **Find…**
> （`@codemirror/search`，⌘F/⌘⇧F/⌘G）；**Export to PDF…**（Reading view + 通过 CSS
> `@media print` 调用 `window.print()`）；**Reveal file in navigation**（展开祖先 folder + 在 file tree 中 scroll/flash 行）；
> **Open version history**（FR-4）：对每个文件通过 `/api/git/log|/show` 使用 `git log`/`git show`，modal 列出
> commit + preview + Restore version。移除 "Reveal in Finder"/"Open in default app"（desktop-only）。
> 更新日志 0.7（FR-10 UX，根据反馈）："Copy public link" 菜单 → "Share…" 打开**按 note 的
> Share dialog**（创建 link、copy URL、toggle 开关、设置/修改 password、删除 link），在 file tree 右键菜单
> 和 pane 的 ⋯ 菜单中均可；正在 public share 的 note 在 file tree 中名称旁有 **globe icon**（accent 色）；
> share 列表缓存在 store 中（在 dialog、Settings → Sharing 和 badge 之间同步）。
> 更新日志 0.6（FR-9 面向开源自托管的 deploy hardening）：deploy 参数全部移到 `.env`
> （`VAULT_HOST_PATH`/`HTTP_BIND`/`HTTP_PORT`/`WEBOBSIDIAN_WATCH`），因此重新部署时
> `docker-compose.yml` 不会被 clobber；file watcher 在触及 inotify 上限时自动 fallback polling；healthcheck `start_period=90s`。
> 更新日志 0.5：Graph（FR-2）新增按 keywords 搜索 node —— Graph view 上的浮动 search 框，输入 keywords
> 显示可能的 note/tag 列表（match label/path，tag 始终最前，其次是 prefix > label > path + degree），click
> （或 Enter = 第一个结果）让 camera fly（fly animation 平滑 pan+zoom）到该 node 并 highlight 该 node
> （node 以 accent 色高亮，未关联部分变暗）直到移动鼠标；Esc 关闭列表。
> 更新日志 0.4：新增 FR-11（移动端 / responsive UI，面向触摸屏智能手机）—— 左/右 sidebar
> 变为滑入式 drawer overlay（hamburger + edge-swipe + backdrop），workspace full-width，mobile editing
> toolbar 位于键盘上方（bold/italic/heading/list/checkbox/link/…），touch target ≥44px，safe-area insets。
> 参考 Obsidian Mobile app 的 UX。更新可用性 NFR。
> 更新日志 0.3：根据用户反馈扩展 FR-2 —— (a) 每个 pane 头部上的 "More options" (⋯) 菜单
> （Split right/Split down、Copy screenshot 用于 Graph、Bookmark、Copy public link、Make a copy、Rename/Move/
> Copy path/Delete、Close tab/Close others）与 Obsidian 类似；(b) Right sidebar 改造为 icon tab strip
> （Backlinks · Outgoing links · Tags · Outline），包含 Linked mentions + **Unlinked mentions** 和 **Outgoing
> links**（resolved/unresolved）—— 此前只有 2 个固定 panel。
> 更新日志 0.2：新增 FR-10（deep-link URL `/note/...` + readonly public share link + 集中式 share 管理页面），API `/api/shares` + `/public/shares`，data model `data/shares.json`。

---

## 1. 概述

**WebObsidian** 是一个自托管的 web 应用，全面克隆 [Obsidian](https://obsidian.md) 的功能，运行在服务器（Docker）上，直接操作包含 Markdown 文件的仓库（Vault）目录。目标是让用户能从任何浏览器访问和编辑其 "second brain"，同时开放 API 供 AI Agent 交互。

### 1.1 目标（Goals）
- Markdown 编写/阅读体验与 Obsidian desktop 相当（editor、live preview、wikilinks、graph、backlinks）。
- 仓库（Vault）是服务器上的真实目录 —— 与现有 Obsidian 仓库 100% 兼容（包括 `.obsidian/`）。
- 通过 **GitHub repo native**（git）双向 sync，支持对大文件（图片、pdf、audio…）使用 **Git LFS**。
- 简单的**登录门禁（Login gate）**：单个密码保护整个 app。
- 配置保存在**纯 `.json` 文件**中（无需 DB engine）。
- **API Gate**，通过 API key 让 AI Agent 经 REST 读/写/搜索 vault。
- 内置 **QMD search engine**：在整个 vault 上进行快速 full-text + fielded search。
- 支持像标准 app 一样安装 **Obsidian community plugins**（通过 plugin loader + Obsidian API shim）。
- 打包成**一条命令**即可运行的 **Docker stack**。

### 1.2 范围之外（Non-goals — v1）
- 实时多用户协作编辑（CRDT）。v1 为 single-user（1 password）。
- 专有的 Obsidian Sync/Publish（以 Git sync 替代）。
- Mobile native app（仅 responsive web）。
- 与所有使用 Electron/Node 内部 API 的 plugin 100% 兼容（仅支持常用 Obsidian API subset）。

### 1.3 目标用户
- 自托管 knowledge base、希望通过 web 从任何设备访问的个人。
- 希望让 AI Agent 通过安全 API 读/写 vault 的用户。

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                          │
│   React + CodeMirror 6 · Live Preview · File Tree · Graph     │
└───────────────▲───────────────────────────┬──────────────────┘
                │ REST + WebSocket           │ static assets
┌───────────────┴───────────────────────────▼──────────────────┐
│                   Server (Node + Express + TS)                │
│  Auth gate │ Vault FS │ QMD Search │ Git Sync │ API Gate │     │
│            │          │            │          │ Plugins  │     │
└───┬─────────────┬──────────┬────────────┬──────────────┬──────┘
    │             │          │            │              │
 settings.json   Vault dir  Search index  GitHub repo   plugins dir
 (JSON db)       (.md+attach) (in-mem/disk) (git+LFS)    (.obsidian/plugins)
```

### 2.1 技术栈
| 层 | 选型 | 理由 |
|-------|----------|-------|
| Backend | Node 20+, Express, TypeScript | 语言统一，git/markdown 生态丰富 |
| Frontend | React + Vite + TypeScript | 构建快，SPA |
| Editor | CodeMirror 6 | Obsidian 自身的编辑引擎 |
| Markdown | unified/remark + rehype | 安全渲染，支持 plugin |
| Search | QMD（基于 MiniSearch 的内部 module）| Full-text + fielded，in-process，无需外部 service |
| Sync | simple-git + git-lfs | Native git，支持大文件 |
| Auth | 密码 hash（scrypt）+ JWT cookie | 简单，无需 DB |
| Storage cfg | `data/settings.json` | 要求"纯 JSON" |
| Container | Docker + docker-compose | 一条命令 deploy |

### 2.2 项目目录结构
```
webobsidian/
├── server/           # API 后端
│   └── src/
│       ├── routes/       # auth, files, search, sync, api(agent), plugins
│       ├── services/     # vault, search(QMD), git, settings, auth, plugins
│       ├── middleware/   # 认证守卫、apikey 守卫、错误处理器
│       └── plugins/      # Obsidian API 垫片 + 加载器
├── web/              # React SPA
│   └── src/
│       ├── components/   # FileTree, Editor, Preview, SearchPanel, Settings…
│       ├── lib/          # api client, store, markdown
│       └── styles/
├── data/             # 运行时：settings.json、apikeys、sessions（已被 git 忽略）
├── docs/
├── docker-compose.yml
└── Dockerfile
```

---

## 3. 功能需求（Functional Requirements）

### FR-1 · 仓库管理（Vault management）
- 通过 Settings 选择/切换仓库（Vault）目录（服务器端路径，在 allowed roots 内有安全的 folder browser）。
- 文件 & folder CRUD：创建、读取、写入、重命名、移动、删除。删除模式通过
  `vault.deleteMode` 配置：`trash`（→ `.trash`，可恢复 —— 默认）或 `permanent`（彻底删除）。
- **Trash**：查看已删除文件的界面，**Restore** 回原位置、**永久删除**单个文件、**Empty
  trash**。Trash 从 file tree 中隐藏（dotfile）且不被 watcher 监控；通过 Files 头部的 🗑 按钮或 command palette 打开。
- file tree 右键菜单（文件 & folder）上的 **Copy/Cut/Paste**：clipboard 为 session-local；Cut = move（`rename`），
  Copy = 递归复制（`POST /api/files/copy`，`fs.cp` recursive）；Paste 到目标 folder，自动避开重名，阻止将
  folder 粘贴到它自身/子目录。
- 支持 attachments（图片/pdf/…）；从 web upload。upload 目标目录与已有 folder 进行 **case-insensitive** 解析
  （`vault.resolveDirCaseInsensitive`）—— 避免在区分大小写的 filesystem（Linux）上创建大小写不同的重名目录
  （例如已有 `Attachments` 时又创建 `attachments`）。
- Watch filesystem（chokidar）以反映外部变更（git pull、直接修改）。
- 兼容 `.obsidian/` 结构（config、plugins、themes）。

### FR-2 · 编辑器与渲染（Editor & rendering）
- CodeMirror 6：Markdown syntax highlight、基本 keybindings。
- Live preview / Reading view 切换。
- Wikilinks `[[note]]`、embeds `![[file]]`、tags `#tag`、callouts、tasks `- [ ]`。
- **嵌入图片 —— resize & zoom**：在 Live Preview 中拖动图片两侧（左/右）handle 来改变宽度，
  以 Obsidian 尺寸参数形式写回 source `![[img|W]]` / `![alt|W](url)`（保持比例，height auto）。
  尺寸参数 `|W` / `|WxH` 对 `![[…]]` 和 markdown 图片 `![](…)` **都**适用，Live 和 Reading 均是。
  Click 图片 → **全屏 lightbox**：wheel/pinch zoom（以光标/中心为基准）、拖动/单指 pan、
  double-click reset、Esc/点击背景关闭（见 §22 mobile：reading 中的图片 pinch-zoom）。
- **音视频嵌入**：`![[clip.mp4]]` → `<video controls>`，`![[song.mp3]]` → `<audio controls>`
  （Live Preview、Reading、public share）。视频：`mp4/webm/ogv/mov/mkv`；音频：`mp3/wav/m4a/3gp/flac/ogg/
  oga/opus`。`![[clip.mp4|W]]` 设置视频宽度。从 file tree 直接打开媒体文件 → 显示 player。
  Binary 经 HTTP Range（206）提供以让 seek/Safari 正常工作；MIME + extension：`services/mime.ts` /
  `lib/media.ts`。
- Backlinks panel、outline、tag pane。
- Right sidebar 为 **tab strip icon**（与 Obsidian 类似）：Backlinks · Outgoing links · Tags · Outline。
  - Backlinks："Linked mentions"（计数 + 列表）**以及** "Unlinked mentions"（以 plain text 提及当前 note 名称
    但尚未 link 的 note —— 通过 QMD search 查找，排除已 link 的 note）。
  - Outgoing links：当前 note 中的所有 wikilink，区分 resolved/unresolved，click 可打开/创建。
- 每个 pane 头部上的 **More options (⋯)** 菜单（note 和 Graph view 均有），按 Obsidian Desktop 结构构建：
  - Note：Backlinks in document、Split right / Split down、Open in new window、Rename / Move file to / Make a
    copy、Bookmark、Add file property、Export to PDF…、Find…、Copy path、Open version history、Open linked view
    （Backlinks / Outgoing links / Outline）、Reveal file in navigation、Share…、Close tab / Close other tabs、Delete。
  - Graph view：Copy screenshot（PNG 到 clipboard）、Close tab。
  - Split pane 支持 2 个方向：right（右侧）和 down（下方）；split 方向 persist 在 uistate 中。
  - **note 内 Find/Replace**：集成 `@codemirror/search`（顶部 panel，⌘F 打开 Find，⌘⇧F Replace，⌘G next）。
  - **Reveal file in navigation**：展开祖先 folder + 在 file tree 中 scroll/flash 该行。
  - **Add file property**：向 frontmatter YAML 插入空 property（若不存在则创建 block）→ 在 Properties widget 中渲染。
  - **Export to PDF**：切换到 Reading view 然后使用浏览器的 print dialog（CSS `@media print` 仅打印 note 内容）。
  - **Open in new window**：在新的浏览器 tab/窗口打开 deep-link `/note/<path>`。
  - 注意：Obsidian Desktop 的 "Reveal in Finder" / "Open in default app" 不适用于 web app，因此没有。
- Graph view（力导向，来自 wikilinks）。
  - 在 graph 上搜索 node：浮动 search 框（左上角），输入 keywords → 可能的 node 列表
    （graph 上显示的 note/tag/attachment）；click 或 Enter → camera fly（平滑 pan+zoom）
    到该 node，node 按 hover 样式高亮（accent + 未关联部分变暗）直到移动鼠标。

### FR-3 · 登录门禁（Login gate）
- **安装时的默认密码：`123456`** —— 无需 setup 步骤，用默认 pass 即可立即登录。settings.json 默认
  **不**包含任何密码。
- 用户在 Settings → Account 中修改密码（输入当前 pass + 新 pass）。新 hash
  保存在 `auth.userPasswordHash`。该 field 为空表示正在使用默认 pass `123456`。
- **密码 override（忘记 pass 时恢复）：** `data/settings.json` 中的 `auth.passwordHash`
  （手动修改，scrypt hash 形式）**或**环境变量 `WEBOBSIDIAN_PASSWORD`（plaintext）。Login
  接受 override pass，**无论**用户是否已修改 pass。默认没有 override。
- 用 1 个 password 登录 → httpOnly cookie 中的 JWT。
- 所有 web route & file API 都要求 auth（`/login`、healthcheck 除外）。

### FR-4 · GitHub 同步（sync）
- 配置：repo URL、branch、token（PAT）或 deploy key、commit 名称/email。
- 操作：init/clone、pull、commit-all、push；显示 status（ahead/behind/dirty）。
- 可选的按 interval auto-sync + on-save debounce。
- Git LFS：为大的 pattern 配置 `.gitattributes`；track/push LFS。
- **按文件的 version history**：`git log`（触及该文件的 commit，newest first）+ `git show <hash>:<path>`，通过
  `GET /api/git/log` & `/api/git/show`；UI modal 列出 version、preview 内容、"Restore this version"
  （覆盖 + reload）。当 vault 还不是 git repo / 未启用 Git Sync 时为空。
- Conflict：检测、通知用户、基本 merge 策略（优先询问）。

### FR-5 · Settings（JSON db）
- 全部配置位于 `data/settings.json`（atomic write，有 backup）。
- 分组：vault、auth、git、search、api、ui、plugins。
- UI Settings 用于查看/修改；用 schema（zod）validate。

### FR-6 · API Gate（AI Agent）
- 管理多个 **API key**（创建/吊销，scope：read / write / search）。
- REST endpoints `/api/v1/*` 通过 header `Authorization: Bearer <key>` 或 `X-API-Key` 认证。
- 能力：list notes、read note、create/update/delete note、search、get backlinks、append。
- 每个 key 的 rate limit + audit log。

### FR-7 · QMD 搜索引擎（Search engine）
- Index 全部 `.md`：内容、标题、headings、tags、path、frontmatter。
- 查询：full-text、prefix、fuzzy、fielded（`tag:`、`path:`、`title:`）、boolean。
- 文件变化时 incremental 更新（通过 watcher）。
- Index 在 disk 上保存/恢复（`data/qmd-index.json`）以加快启动。

### FR-8 · 社区插件（Community plugins）
- 从 `.obsidian/plugins/*` 读取 plugin 列表（manifest.json、main.js）。
- Plugin loader 在 sandbox 中加载 `main.js`，并带有 **Obsidian API shim**（App、Vault、Workspace、Plugin、Notice、Setting…）。
- 从 community list 浏览并安装 plugin（通过 GitHub releases）—— 下载到 plugins 目录。
- 启用/禁用 plugin；在 settings 中保存状态。

### FR-9 · Docker
- `Dockerfile` multi-stage（build web + server → 精简 image）。
- `docker-compose.yml`：mount vault volume、data volume、password/secret 的 env。
- Healthcheck（`start_period` 足够长，以便首次 index 大型 vault）、restart policy。
- **自部署无需修改被 tracked 的文件**：所有 deploy 参数通过 `.env`（git-ignored）设置 ——
  `VAULT_HOST_PATH`（host vault → `/vault`）、`HTTP_BIND`/`HTTP_PORT`（publish）、`WEBOBSIDIAN_PASSWORD`、
  `WEBOBSIDIAN_WATCH`、`TRUST_PROXY`（默认 `true` —— 信任相邻 hop，使 `X-Forwarded-Proto` 在
  位于 reverse proxy 之后时工作；当无 proxy 直接暴露时设为 `false`，或用 subnet/跳数列表来收紧）。
  `docker-compose.yml` 仅引用 `${VAR:-default}`，因此 `git pull`/redeploy
  不会 clobber 自托管者的配置。`cp .env.example .env && docker compose up -d --build`。
- **File watcher 容忍 inotify 错误**：干净的 VPS 上 `fs.inotify.max_user_watches` 通常偏低 →
  native watch 报错 `ENOSPC/EMFILE`。Watcher 自动 degrade 为 **polling**（`WEBOBSIDIAN_WATCH=auto`），
  并记录指导以调高 `sysctl` 来保留 native（CPU 更低）。

### FR-10 · Deep-link URL 与公开分享（Public share）
- **Deep-link**：浏览器 URL 反映当前打开的 note —— `/note/<vault-relative-path>`
  （对每个 segment 进行 URL-encode）；Graph view = `/graph`。直接打开 URL（登录后）会打开对应的
  note；浏览器 back/forward 正常工作（popstate ↔ 应用的 history stack）。
- **Public share（readonly，无需 login）**：
  - 为一个 `.md` note **或 `.canvas` canvas** 创建 share link → 随机 token（16 bytes，base64url），
    URL 形如 `/share/<token>`。
  - **Canvas share**：`.canvas` 由服务器渲染为**静态 HTML**（snapshot）：node 按
    坐标绝对定位，edges 用 SVG Bézier SSR 绘制（与 editor 相同的几何），text/embedded-note 通过 markdown
    pipeline 渲染；页面 full-width（去掉狭窄的 markdown 列）。public 文件 allowlist 取自 canvas file-node 中的图片
    （`rendercanvas.canvasEmbedTargets`）。v1 中为 non-interactive（无 pan/zoom）。
  - Public 页面渲染 Reading view（markdown → HTML sanitize），**没有** sidebar/editor，
    不要求 auth。note 中的 wikilink 显示为静态 text（不导航）。
  - **SEO / SSR**：`GET /share/{id}` 由**服务器渲染成完整 HTML**（无需 JS
    即可读取内容 → 可被 Google indexable）。Head 包含：`<title>`（note 名称）、meta description
    （body 前 ~160 个字符，已 strip markdown）、canonical、Open Graph
    （`og:title/description/type=article/url/site_name/image` —— note 嵌入的第一张图片或第一个 web
    图片 URL）、Twitter card（`summary_large_image`/`summary`）、`robots: index,follow`。
    有 password 的 share → SSR 出密码输入页（**noindex**，不含 note 内容，unlock form
    用 inline JS）；share disabled/不存在 → 404（noindex）。服务器端渲染 markdown
    使用相同的 unified/remark/rehype + sanitize pipeline（从 web 移植，并附带 bundle 中的 inline CSS）。
  - note 中嵌入的文件（图片/pdf/video）通过 public endpoint 提供，**严格限制为该 note 嵌入的
    文件**（`![[...]]` / `![](...)`）—— 不允许任意读取 vault。不通过该 endpoint 提供
    `.md` 文件（public 页面无 transclusion）。
  - Share record：`{ id, path, enabled, createdAt, passwordHash? }` 保存在 `data/shares.json`
    （JSON，atomic write）。每个 note 最多 1 个 share record（重新创建 → 返回旧 record + enable）。
  - Disable（保留 token，可重新启用）或彻底删除。token 被 disable/删除 → public 页面返回 404。
  - **每个 share 可选 password**：在管理页面设置/删除（scrypt hash，绝不把
    hash 返回给 client —— 仅返回 `hasPassword`）。当 share 有 password 时：public endpoint 返回 401
    `{passwordRequired: true}`；访客输入 password → `POST /public/shares/{id}/unlock` → JWT
    （用 `jwtSecret` 签名，TTL 12h，payload 绑定 share id）放在 scope 正确为
    `/public/shares/{id}` 的 httpOnly cookie 中 —— 嵌入图片会自动发送 cookie。修改/删除 password 不会使已签发的 cookie 失效
    （v1 可接受较短的 TTL）。
- **按 note 的 Share dialog**：菜单 "Share…"（file tree 右键菜单 + pane 的 ⋯ 菜单，适用于 `.md`
  note **和 `.canvas` canvas**）打开该 note 的 share 设置 popup：创建 public link、URL 输入框 + Copy 按钮、toggle
  启用/禁用 link、设置/修改/删除 password、永久删除 link。
- **识别 badge**：正在 public share（enabled）的 note 在 file tree 中名称旁显示 accent 色的 **globe icon**。
  share 列表缓存在 store 中，登录后加载并在每次操作后刷新（dialog 与 Settings 共用），因此 badge 始终正确。
- **集中管理**：Settings → "Sharing" tab 列出所有已 share 的 note，带有按 path
  过滤的 search 框、快速 enable/disable toggle、copy link、删除。

---

### FR-11 · 移动端 / 响应式 UI（触摸屏智能手机）
目标：在触摸屏手机上便捷地**阅读 note**和**编写 note**，参考 Obsidian Mobile 的 UX。按 breakpoint
（`max-width: 768px`）激活 —— 不是独立 app，同一个 React codebase。
- **Layout drawer**：ribbon + 左侧 sidebar 和 right sidebar 变为**滑入覆盖内容的 drawer overlay**
  （不推开 layout）。默认关闭 → editor 占满整屏。打开方式：tab 栏上的 hamburger 按钮（☰）、
  **从左/右边缘滑动**（edge-swipe）、或各 panel 的 toggle 按钮。有模糊的 **backdrop**；
  触摸 backdrop 或选择 note → drawer 自动关闭。左侧 drawer 包含 ribbon strip（切换 Files/Search/
  Graph/Bookmarks/Tags/Settings 面板）+ 内容 panel。
- **Drawer 状态是本设备本地的**（不 persist，不通过 WebSocket broadcast）→ 在手机上打开/关闭 drawer
  不影响正在共用 `uistate` 同步的 desktop sidebar 状态。
- **Touch targets**：folder tree 行、工具按钮、tab ≥ 44px；增大触摸 padding；去掉仅 hover 的 affordance
  （close tab 按钮在 mobile 上始终显示）。
- **Format toolbar**：编写（Live/Source）时的格式工具栏：bold、italic、heading、list、
  checklist、quote、link、internal link `[[`、code、tag、indent/outdent、undo/redo。每个按钮直接
  作用于当前 active 的 editor。**Mobile**：浮在键盘上方（通过 visualViewport 锚定），如 Obsidian
  Mobile。**Desktop**：位于 view-header 正下方的 in-flow 工具条（应需求方要求）。
- **Viewport & safe-area**：`viewport-fit=cover`；为 notch/home-indicator 留出 `env(safe-area-inset-*)`；
  禁用 double-tap zoom（类 app）但保留 reading 中的图片 pinch-zoom。

### FR-12 · Canvas（无限画布 —— JSON Canvas）
目标：克隆 Obsidian 的 **Canvas** 功能 —— 一个无限的平面，用于排列 card/note/图片/link 并以带箭头的
连线连接它们，用于 brainstorm、moodboard、示意图。参考 Obsidian Canvas 的 UX。

- **`.canvas` 文件格式**：遵循开放标准 **JSON Canvas**（jsoncanvas.org），以便与
  Obsidian 双向兼容。文件为 JSON `{ "nodes": [...], "edges": [...] }`。
  - **Node**（通用）：`id`、`type`、`x`、`y`、`width`、`height`、`color?`。`color` 是 preset `"1".."6"`
    （红/橙/黄/绿/蓝/紫）或 hex `"#RRGGBB"`。
    - `type:"text"` → `text`（markdown）。
    - `type:"file"` → `file`（vault-relative 路径）、`subpath?`（heading/block）。
    - `type:"link"` → `url`。
    - `type:"group"` → `label?`、`background?`、`backgroundStyle?`。
  - **Edge**：`id`、`fromNode`、`fromSide?`(top/right/bottom/left)、`fromEnd?`(none/arrow)、`toNode`、
    `toSide?`、`toEnd?`(none/arrow，默认为 arrow)、`color?`、`label?`。
- **Canvas 交互**：**在背景上左键拖动 = pan**；**Shift+拖动 = marquee 多选 node**；pan 也可
  通过 Space+拖动和中/右键拖动；触屏单指 pan。用滚轮 zoom（以光标为中心），zoom in/out/fit/100% 按钮。
  背景点状网格。
- **Node**：double-click 背景 → 创建 **text node** 并立即进入编辑模式；double-click text node 进行编辑
  （textarea），Esc/blur 退出。拖动 node 移动；8 个 handle resize。从树（或按钮）drop note/图片文件
  → 创建渲染 embed 的 **file node**（note = markdown preview，图片 = `<img>`）。通过 6 色调色板 +
  默认色改色。删除（Delete/Backspace）。
- **Edge**：hover node 显示 4 个边缘圆点；从一个圆点拖到另一个 node/edge → 创建 edge。Edge 按方向
  用 Bézier 曲线绘制，在 `to` 端有箭头。double-click edge 中间添加/修改 **label**。选择 edge
  以改色/删除。
- **Select**：click 选择 1 个 node/edge；在背景上拖 marquee 多选；Shift+click 增/减；按组移动/删除。
  有选择时浮动显示上下文工具栏（改色、删除）。
- **Alignment snap（对齐辅助线）**：拖动 node 时，node 的边缘/中心会自动对齐到其他 node 的边缘/中心并
  显示**对齐辅助线**（移植 Obsidian 的 `getSnapping/O3/P3` 算法：snap 点 = 4 个角 + 中心，阈值
  `ceil(15/scale)` canvas 单位）。按住 **Alt**（macOS 上为 ⌃）自由拖动（关闭 snap）；按住 **Shift** 锁定轴。
- **text card 内格式**：快捷键与主 editor 相同（`obsidianKeymap`）—— ⌘B 加粗、⌘I 斜体、⌘K 添加 link、
  ⌘L task、`⌘/` comment（toggle marker）；右键菜单**正好在光标处**打开并自动平移进屏幕内。
- **文本对齐**（JSON Canvas spec 之外的扩展）：`TextNode.textAlign` = `left|center|right`，通过
  selection menu 中的按钮（选中 text node 时）或右键菜单的 "Align" 子菜单选择；同时应用于 textarea 和渲染内容。
  *注意：真正的 Obsidian 在重新打开时会忽略该 field。*
- **保存**：像 editor 一样防抖 autosave（~900ms），通过 `PUT /api/files/content` 写入（store `content`/`save`，
  `.canvas` 已包含在 `TEXT_RE` 中）。不新增 endpoint。
- **新建 canvas**：folder tree 右键菜单（"New canvas"）+ command palette；名称 `Untitled.canvas` 不
  重名，初始内容为 `{"nodes":[],"edges":[]}`。
- **v1 范围（non-goals）**：没有 realtime collaborative cursor；group 不按成员 auto-resize；
  不支持 portal/embed canvas-in-canvas；不从 file node link backlink graph（保持简单）。

### FR-13 · 桌面应用（Electron，多平台）
目标：将 WebObsidian 打包为**机器上的安装版应用**（macOS/Windows/Linux），让用户下载后像 native app 一样
使用，无需自己搭建 server 或 Docker。其本质是一个 **Electron shell**，包裹现有的 Express server
+ SPA（不 fork 代码，不改架构）—— 因此所有 web 功能都原样运行。

- **架构**：Electron `main` 通过 `ELECTRON_RUN_AS_NODE` 将**现有 server 作为子进程 spawn**
  （直接使用 Electron 内嵌的 Node，无需机器上预装 Node），bind **`127.0.0.1` + 随机空闲
  端口**（localhost-only，不开放到网络），然后 `BrowserWindow` 加载 `http://127.0.0.1:<port>`。
  Server 用 esbuild **打包成单个 `.mjs` 文件**（所有 deps inline；`fsevents` 因 optional 而设为
  external）。SPA build（`server/public`）随附在 `resources/server/public`。
- **数据 & vault**：首次运行弹出**选择 vault 目录**对话框（若跳过则默认
  `~/Documents/WebObsidianVault`）。`DATA_DIR`（settings.json、index）位于 Electron 的 per-user
  `userData` 目录。菜单 **File → Switch Vault…** 切换 vault（relaunch 以 re-index）、**Open Vault/Data Folder**、**Open Logs**。
- **无缝登录**：app 自动生成**随机/机器密码**保存在 `userData` 中，通过
  `WEBOBSIDIAN_PASSWORD`（override）传入 → **auto-login**（将 JWT cookie seed 到窗口 session）并自动设置
  自定义 password，使首次**不强制改密**。用户无需输入 password；仍可在
  Settings 中修改。
- **多平台 / 多架构**：因为 server **运行时无 native module**，cross-arch 只需打包
  对应的 Electron binary。用 **electron-builder** 打包：macOS `dmg`+`zip`（arm64/x64）、Windows
  `nsis`(installer)+`portable`（x64/arm64/ia32）、Linux `AppImage`+`deb`（x64/arm64）。
- **发布**：GitHub Actions workflow `release.yml` 在推送 tag `v*` 时运行 —— macOS/Windows/Ubuntu matrix，
  每个 runner 为其 OS build native 包然后 **publish 到 GitHub Release**（draft）供用户下载。
- **外部依赖**：Git sync 功能需要机器上有 `git`（PATH 会补充常见位置）；缺少
  git 时 app 仍可正常运行以进行本地 note 编辑，只是关闭 sync。App **尚未 code-sign/notarize**（会出现
  Gatekeeper/SmartScreen 警告 —— 对免费 self-hosted 而言可接受）。
- **范围（non-goals）**：暂无 auto-update（用户手动下载新版本）；暂无数字签名；不内嵌 git
  portable；不在 1 个 instance 中并行运行多个窗口/vault（single-instance lock）。

---

## 4. 非功能需求（NFR）
- **安全**：password hash scrypt、自动生成的 JWT secret、API key 存储时 hash、path traversal guard
  （阻止 `..`、`.git` segment、逃逸 vault 的 symlink）、受限 CORS、rate limiting（`/auth/login`：
  每 15 分钟 10 次 —— **按真实 TCP socket 地址锁定，而非按 `req.ip`/`X-Forwarded-For`**，因此
  无法通过轮换 XFF 绕过，**无论 `trust proxy` 配置如何**；因此 `trust proxy` 默认
  开启（`true`，通过 `TRUST_PROXY`），以便 `X-Forwarded-Proto`/Secure-cookie 在 proxy 之后正常工作）。
  首次登录后**必须**修改默认密码（`123456`）（`mustChangePassword`）。Security headers 通过
  `helmet` + CSP（script-src 'self'+nonce；不强制 HTTPS
  以保留 self-host HTTP）。git token/PAT 会从所有返回 client 的错误信息和 log 中 redact。WebSocket
  `/ws` 要求有效的登录 session。Plugin `id` 在成为 path segment 前会 validate；通过 API 修改
  `vault.path` 被限制在 `allowedRoots` 内。
- **性能**：对 ~10k notes 的 vault，search < 100ms；大型 file tree lazy load。
- **可靠性**：settings & notes 使用 atomic writes；覆盖前 backup；git 操作不丢数据。
- **可移植性**：可在 Linux/macOS、ARM & x86 上运行。
- **可用性**：responsive（desktop/tablet/mobile）、dark/light theme。

---

## 5. API surface（摘要）

### Web/session API (cookie auth)
```
POST   /auth/setup            # （旧版）首次设置密码 —— 已有默认密码时失效
POST   /auth/login            # 登录 → cookie
POST   /auth/logout
POST   /auth/change-password  # 修改密码：{ currentPassword, newPassword }（需要登录）
GET    /auth/me
GET    /api/files            # 目录树
GET    /api/files/*path      # 读取文件（md/二进制）
PUT    /api/files/*path      # 写入
POST   /api/files/*path      # 创建 / 上传
PATCH  /api/files            # 重命名/移动
POST   /api/files/copy       # 递归复制文件/文件夹 {from,to}（先 Copy 后 Paste）
DELETE /api/files/*path      # 删除 → .trash 或彻底删除（依据 vault.deleteMode）
GET    /api/files/trash      # 列出 .trash 中的文件
POST   /api/files/trash/restore   # 将 {path} 还原到原位置
DELETE /api/files/trash/item # 永久删除回收站中的一项
DELETE /api/files/trash      # 清空回收站（全部彻底删除）
GET    /api/search?q=...
GET    /api/backlinks?path=...
GET    /api/git/status | POST /api/git/{pull,commit,push,sync}
GET/PUT /api/settings
GET/POST/DELETE /api/keys     # 管理 API key
GET    /api/plugins | POST /api/plugins/install | PATCH enable
GET    /api/shares            # 列出分享（管理）
POST   /api/shares            # 为某篇笔记创建分享 {path} → {id,...}
PATCH  /api/shares/{id}       # 启用/禁用 {enabled}
DELETE /api/shares/{id}       # 删除分享
```

### 公开分享（无需认证）— `/public` & `/share`
```
GET    /public/shares/{id}        # 已分享笔记的内容 {title, content}（禁用时返回 404，
                                  # 有密码且未解锁时返回 401 {passwordRequired}）
POST   /public/shares/{id}/unlock # {password} → 设置 httpOnly unlock cookie（JWT 12h）
GET    /public/shares/{id}/file?path=  # 笔记中嵌入的文件（仅限该笔记引用的文件）
GET    /share/{id}                # 公开 HTML 页面 —— 服务端渲染（SEO meta + OG + 内容
                                  # 内嵌于 HTML；locked → 密码表单 noindex）
```

### Agent API（API-key 认证）— `/api/v1`
```
GET    /api/v1/notes                 # 列表（分页）
GET    /api/v1/notes/{path}          # 读取
PUT    /api/v1/notes/{path}          # 创建/更新
PATCH  /api/v1/notes/{path}/append   # 追加内容
DELETE /api/v1/notes/{path}
GET    /api/v1/search?q=...&limit=
GET    /api/v1/backlinks?path=
GET    /api/v1/tags
```

---

## 6. 数据模型 —— `settings.json`
```jsonc
{
  "version": 1,
  "auth":   { "userPasswordHash": "scrypt$...（密码已修改；为空 = 使用默认 123456）",
              "passwordHash": "scrypt$...（恢复用覆盖；为空 = 无）",
              "jwtSecret": "..." },
  "vault":  { "path": "/vault", "allowedRoots": ["/vault"], "trash": ".trash", "deleteMode": "trash" },
  "git":    { "enabled": false, "remote": "", "branch": "main",
              "token": "", "authorName": "", "authorEmail": "",
              "autoSync": false, "intervalSec": 300,
              "lfsPatterns": ["*.png","*.jpg","*.pdf","*.mp4"] },
  "search": { "fuzzy": 0.2, "indexFrontmatter": true },
  "api":    { "keys": [ { "id": "...", "name": "agent1",
                          "hash": "...", "scopes": ["read","search"],
                          "createdAt": "...", "lastUsed": "..." } ],
              "rateLimitPerMin": 120 },
  "ui":     { "theme": "obsidian-dark", "defaultView": "live" },
  "plugins":{ "enabled": ["dataview"], "installed": [] }
}
```

### `data/shares.json` (public share links — FR-10)
```jsonc
[
  { "id": "base64url-16-bytes", "path": "Folder/Note.md",
    "enabled": true, "createdAt": "2026-06-10T00:00:00.000Z",
    "passwordHash": "scrypt$...salt...$...hash..." } // 可选 —— 无密码的分享可省略该字段
]
```

---

## 7. 风险与决策
- **插件兼容性**：许多 plugin 使用 Electron 专有的 API/DOM → 仅保证 subset。决策：shim 常用 API，对缺失 API 软失败，记录警告。
- **git token/API key 安全**：存储在服务端 settings.json（chmod 600），建议通过独立 secret/volume mount。
- **大文件**：强制 Git LFS；提交超过阈值且未 track LFS 的文件时警告。
- **同步冲突**：v1 优先通知 + 手动 resolve，不做破坏数据的 auto-merge。

---

## 8. v1 的完成标准（Definition of Done）
1. 用 1 个 password 登录，打开 vault，查看 folder tree。
2. 使用 editor + live preview + wikilinks/backlinks 打开/编辑/创建/删除 note。
3. 在示例 vault 上 QMD search 返回结果 < 100ms。
4. 配置 git，成功 sync（pull/commit/push），包括 LFS 文件。
5. 创建 API key，AI Agent 调用 `/api/v1` 成功 read/write/search。
6. 安装并启用至少 1 个简单的 community plugin。
7. `docker compose up` 运行整个 stack。
