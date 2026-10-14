# IMPLEMENTATION PLAN — WebObsidian

> 跟踪开发进度。设计参考：[PRD.md](PRD.md)。
> 约定：`[ ]` 未做 · `[~]` 进行中 · `[x]` 已完成。
> **每当**某个条目状态改变时更新本文件。

最后更新：2026-10-08 (QUT fork — 编辑分支自动跟进主分支 + 投稿前分支检查)

---

## Phase 0 — 基础与脚手架
- [x] M0.1 初始化 monorepo (根 `package.json` + workspaces)
- [x] M0.2 Server 脚手架：Express + TS，`tsconfig`，dev 脚本 (tsx)，build (tsc)
- [x] M0.3 Web 脚手架：Vite + React + TS
- [x] M0.4 按 PRD §2.2 的目录结构
- [x] M0.5 `.gitignore`、`.env.example` (ESLint/Prettier：稍后处理，不阻塞 build)

## Phase 1 — 设置存储 (JSON db) — FR-5
- [x] M1.1 `settings` 模块读写 `data/settings.json` (原子写入 + 备份)
- [x] M1.2 用 zod 校验 schema，默认设置，迁移 `version`
- [x] M1.3 路由 `GET/PUT /api/settings`

## Phase 2 — 认证门禁 — FR-3
- [x] M2.1 密码哈希 (scrypt)，自动生成 JWT secret
- [x] M2.2 `POST /auth/setup`、`/auth/login`、`/auth/logout`、`GET /auth/me`
- [x] M2.3 中间件 auth guard (httpOnly cookie)，保护路由
- [x] M2.4 首次运行设置流程 (UI + env 种子 `WEBOBSIDIAN_PASSWORD`)
- [x] M2.5 默认密码 123456 + 修改密码 (Settings→Account) + 恢复用 override (`auth.passwordHash`/`WEBOBSIDIAN_PASSWORD`)；旧密码迁移 → `userPasswordHash`

## Phase 3 — 仓库文件系统 — FR-1
- [x] M3.1 vault 服务：列出树、读取、写入、创建、重命名/移动、删除→回收站
- [x] M3.2 路径穿越防护 + allowedRoots
- [x] M3.3 上传附件 (二进制)，按 mime 提供二进制
- [x] M3.4 用于选择 vault 路径的安全文件夹浏览器
- [x] M3.5 文件系统监视器 (chokidar) → 事件通过 WebSocket
- [x] M3.6 回收站 UI + 删除模式 (FR-1)：`vault.deleteMode` (trash/permanent) + Settings 选择器；
      service `listTrash/restoreFromTrash/deleteFromTrash/emptyTrash/remove`；路由 `/api/files/trash*`；
      TrashView 模态框 (Restore / 永久删除 / Empty trash) 从 Files 头部 + command palette 打开

## Phase 4 — QMD 搜索引擎 — FR-7
- [x] M4.1 基于 MiniSearch 的 QMD 模块：索引 content/title/headings/tags/path/frontmatter
- [x] M4.2 启动时构建索引 + 持久化 `data/qmd-index.json`
- [x] M4.3 通过 watcher + 每次写入后增量更新
- [x] M4.4 查询：全文、前缀、模糊、字段化 (`tag:`、`path:`、`title:`)
- [x] M4.5 路由 `GET /api/search`

## Phase 5 — 链接图谱 — FR-2
- [x] M5.1 解析 wikilinks/embeds/tags → 链接索引
- [x] M5.2 反向链接 `GET /api/backlinks`
- [x] M5.3 图谱数据接口 `GET /api/graph`

## Phase 6 — GitHub 同步 — FR-4
- [x] M6.1 git 服务 (simple-git)：init/clone、status、pull、commit、push
- [x] M6.2 Git LFS：检测、`.gitattributes`、track patterns (verified lfsAvailable)
- [x] M6.3 通过嵌入 remote URL 的 PAT 认证
- [x] M6.4 自动同步间隔 (service autosync)
- [x] M6.5 基础冲突检测 + 通知用户
- [x] M6.6 路由 `/api/git/{status,init,clone,pull,commit,push,sync}`

## Phase 7 — API 网关 (Agent) — FR-6
- [x] M7.1 API key 模型：创建/列出/吊销，哈希存储在 settings 中，scopes
- [x] M7.2 中间件 apikey guard + scope 检查 + 速率限制 + 审计日志
- [x] M7.3 `/api/v1`：notes 列出/读取/写入/追加/删除，search，backlinks，tags
- [x] M7.4 key 管理路由 `GET/POST/DELETE /api/keys`
- [x] M7.5 agent API 文档 (`docs/AGENT_API.md`)

## Phase 8 — 社区插件 — FR-8
- [x] M8.1 读取 `.obsidian/plugins/*` (manifest + main.js)
- [x] M8.2 Obsidian API shim (App, Vault, Workspace, Plugin, Notice, Setting…)
- [x] M8.3 插件加载器 (eval main.js) + 启用/禁用
- [x] M8.4 从社区浏览 + 安装 (GitHub releases)

## Phase 9 — Web 前端 — FR-2
- [x] M9.1 API client + 认证流程 + 应用外壳 (ribbon/sidebar/tabs/statusbar)
- [x] M9.2 文件树 (上下文菜单 CRUD，新建笔记/文件夹)
- [x] M9.3 CodeMirror 6 编辑器 (markdown, keymap, autosave)
- [x] M9.4 阅读视图 (remark/rehype, wikilinks, embeds, callouts, tasks, properties)
- [x] M9.5 搜索面板 + 命令面板
- [x] M9.6 反向链接/大纲/标签面板
- [x] M9.7 图谱视图 (在标签页中打开 + Obsidian 风格 Filters 面板)
- [x] M9.8 设置 UI (vault/git/api keys/plugins/theme)
- [x] M9.9 仿 Obsidian 主题 (深色/浅色)
- [x] M9.10 后退/前进导航 (所有视图上的工具栏 ←/→，历史栈)
- [x] M9.11 搜索：过滤/排序 (match case, collapse, more context, sort) + 粘性查询框

## Phase 10 — Docker 与文档 — FR-9
- [x] M10.1 多阶段 `Dockerfile` (web build → server runtime, git+git-lfs)
- [x] M10.2 `docker-compose.yml` (vault + data volumes, env secrets, healthcheck)
- [x] M10.3 `README.md` 快速开始 + `docs/AGENT_API.md`
- [~] M10.5 根据 QUT fork 的 Git 历史重写中文 README，覆盖部署、目录配置、GitHub App 投稿、公开编辑及图床，并核验文档链接与示例。
- [x] M10.4 自托管部署加固：compose `.env` 驱动 (`VAULT_HOST_PATH`、
  `HTTP_BIND/HTTP_PORT`、`WEBOBSIDIAN_WATCH`) → 重新部署时不覆盖；watcher 在 inotify
  `ENOSPC/EMFILE` 时自动回退到 polling；`start_period=90s`；README 增加 Deploy-to-VPS 章节

## Phase 11 — QA 与 DoD
- [x] M11.1 端到端冒烟测试 (login → edit → search → backlinks → agent API CRUD)
- [x] M11.2 用于演示的示例种子仓库 (`sample-vault/`)
- [x] M11.3 检查 Definition of Done (PRD §8) — 通过 curl + UI 截图验证

## Phase 12 — 对齐与 UI 保真 (第 2 批)
- [x] M12.1 实时预览所见即所得 (CM6)：隐藏格式标记、缩放标题、wikilink/checkbox/图片 widget
- [x] M12.2 Frontmatter → Properties 块，同时适用于实时预览 (StateField) 与阅读模式
- [x] M12.3 阅读模式中的 Embeds/transclusion `![[note]]` + 图片 `![[img]]`
- [x] M12.3b 嵌入音频/视频 `![[clip.mp4]]`/`![[song.mp3]]` → HTML5 `<video>`/`<audio>` (Live Preview `MediaWidget`、Reading `markdown.ts`、public share `renderhtml.ts`) + 在树中直接打开媒体文件 → 播放器；二进制通过 HTTP Range (206) 提供以支持 seek；MIME/扩展名归集到 `services/mime.ts` 与 `lib/media.ts`
- [x] M12.4 真正的右键上下文菜单 (new/rename/delete/open-to-side/bookmark)
- [x] M12.5 在树中拖放移动文件 + 粘贴/拖入图片 → 上传附件 + 插入 embed
- [x] M12.6 快速切换器 (⌘O) + 命令面板命令 + 快捷键 (⌘P/⌘O/⌘N/⌘E/⌘⇧F/⌘\\/⌘S)
- [x] M12.7 书签 + 最近面板；每日记事命令；分屏窗格 (向右打开)
- [x] M12.8 Git 保存时自动提交 (防抖) + Settings 中的开关
- [x] M12.9 代码分割 bundle (react/codemirror/markdown chunks)

## Phase 13 — Obsidian 外观与体验 (根据用户反馈)
- [x] M13.1 扁平 Lucide 图标集 (组件 `Icon`) 替换全部 emoji
- [x] M13.2 默认主题 = Light (与 Obsidian 一致)，调色板/间距/边框贴合 Obsidian
- [x] M13.3 文件树仅用 chevron (markdown 无图标)，活动高亮精致
- [x] M13.4 仓库页脚 (仓库名 + settings)；右下角小状态栏
- [x] M13.5 右侧边栏 "Linked mentions" + "Outline" 与参考图一致
- [x] M13.6 标签栏含左侧/右侧边栏切换 + 新建标签页按钮

## Phase 14 — 所见即所得编辑器与上下文菜单 (根据用户反馈)
- [x] M14.1 实时预览按 Obsidian 风格渲染：干净标题 (隐藏 `#`)，bold→加粗，
      italic→斜体，`code`→mono 背景，删除线，bullet→•，tag→pill
- [x] M14.2 **在光标处按 token 逐个**显示原始语法 (不显示整段) — 编辑流畅
- [x] M14.3 修复将深色主题 (oneDark) 应用到浅色界面 → 按主题高亮
- [x] M14.4 Callout/blockquote 在实时预览中内联渲染
- [x] M14.5 实时预览中 Frontmatter → Properties widget (块)
- [x] M14.6 编辑器右键菜单：Format/Paragraph/Insert (子菜单) + Cut/Copy/Paste/Select all + Search
- [x] M14.7 扩展的文件树右键菜单：Open/Open to right/Bookmark/Make a copy/Rename/Move/Copy path/Delete
- [x] M14.8 阅读视图右键菜单：Copy/Search/Select all；ContextMenu 支持子菜单 + icon

### 剩余 / 未来改进 (不阻塞)
- [ ] 针对 git 的高级冲突解决 UI
- [ ] 超大目录树懒加载；canvas/whiteboard
- [ ] ESLint/Prettier CI；实时预览渲染深多层嵌套的表格/列表
- [ ] Graph：将 d3-force 模拟移植到 web worker (如 Obsidian app 运行 worker + WASM)
      以免 5.9k 节点图谱"展开"时 UI 卡顿 — physics/render 已对齐，仅剩
      线程架构 (参见 obsidian.asar 中的 sim.js；web 保持参数不变，仅改变运行位置)

---

## Phase 15 — 持久化与同步工作区状态 (根据用户要求)
- [x] M15.1 将 UI/工作区状态保存**到服务器文件** `data/uistate.json` (不使用 localStorage)
      — 打开的标签页、活动笔记、viewMode、展开的文件夹、split、recent、bookmarks、面板布局
- [x] M15.2 加载时恢复状态 (F5 不丢失笔记；在其他浏览器/设备打开依然保持)
- [x] M15.3 通过 WebSocket 在标签页/设备间**实时同步**：此标签页变更 → 广播 →
      另一标签页应用 (按 `originId` 去除回声，切换前保存正在编辑的内容，re-hydrate)
- [x] M15.4 单击一次即可编辑标题 (posAtCoords precise=false)；标题去除下划线

## Phase 16 — Deep-link URL 与公开分享 — FR-10 (根据用户要求)
- [x] M16.1 URL `/note/<path>` 与打开的笔记同步 (pushState/popstate，登录后打开 deep-link，
      Graph = `/graph`)
- [x] M16.2 Server：service `shares` (`data/shares.json`，原子写入) + 路由 `/api/shares`
      (list/create/toggle/delete, auth) + `/public/shares/:id{,/file}` (无 auth，guard 仅
      提供该笔记内嵌的文件，不提供 `.md`)
- [x] M16.3 公开页面 `/share/<token>` 只读 (渲染阅读视图，无需登录)
- [x] M16.4 UI：笔记上下文菜单 "Copy public link"；Settings → "Sharing" 标签页集中管理
      (搜索、快速 enable/disable 切换、复制链接、删除)
- [x] M16.5 每个 share 可选密码：在 Sharing 标签页设置/删除 (scrypt 哈希，仅返回
      `hasPassword`)；public 401 `{passwordRequired}` → 密码输入表单 → 解锁 JWT cookie
      (httpOnly，scope `/public/shares/{id}`，12h)
- [x] M16.6 `/share/{id}` 页面 SSR：服务器渲染完整 HTML (可被 Google 索引) + SEO meta
      (title、description、canonical、Open Graph + og:image、Twitter card)；锁定时 → 密码表单
      noindex；替换 React /share 页面 (web 移除 PublicNote，dev proxy 将 /share 指向 server)
- [x] M16.7 每个笔记的分享对话框 + 徽标 (根据反馈，PRD 0.7)：菜单 "Share…" (文件树 +
      ⋯ 窗格菜单，替换 "Copy public link") 打开弹窗以创建链接/复制 URL/开关切换/密码/删除；
      文件树中正在分享的笔记名旁有 accent 颜色的 globe 图标；store 中的 shares 缓存
      供对话框 + Settings → Sharing + 徽标共用

## Phase 17 — 窗格菜单 (⋯) 与右侧边栏标签页 (根据用户反馈，PRD 0.3)
- [x] M17.1 所有窗格 view-header 上的 "More options" (⋯) 菜单：note (Split right/down、Bookmark、
      Copy public link、Make a copy、Rename/Move/Copy path/Delete、Close tab/Close others)，
      Graph (Copy screenshot PNG → clipboard、Close tab)
- [x] M17.2 双向 split 窗格：right + down (在 uistate 中持久化 `splitDirection`)
- [x] M17.3 右侧边栏图标标签条 (Backlinks · Outgoing links · Tags · Outline)，
      持久化所选标签页 (`rightPanel`)
- [x] M17.4 Unlinked mentions (搜索标题 + 通过 `/api/search/matches`
      `phrase:true` 匹配**整个短语**，排除已链接的笔记) + Outgoing links (解析 wikilinks，resolved/unresolved，
      从 unresolved 中过滤 attachment，点击打开/创建)

---

## Phase 18 — Markdown 编辑器对齐 Obsidian Desktop (docs/obsidian-desktop-internals.md)
- [x] M18.1 按 app.css 1.12.7 的 CSS design tokens (§19)：accent HSL 258/88%/66% + accent-1/-2
      light/dark 公式，color-base ramp 值正确，extended colors + `-rgb`，语义
      tokens (`--background-*`、`--text-*`、`--interactive-*`)，heading 1.618/1.462/1.318/
      1.188/1.076/1em + letter-spacing，`--bold-modifier: 200`，`--file-line-width: 700px`，
      callout slots RGB triplet (§21)；为现有组件保留旧 var 别名
- [x] M18.2 标准 DOM classes (§20)：根 `markdown-source-view cm-s-obsidian mod-cm6
      is-live-preview is-readable-line-width`；line `HyperMD-header-1..6 / -list-line /
      -task-line[data-task] / -quote / -codeblock(-begin/-end/-bg) / -hr / -footnote`；span
      `cm-hashtag(-begin/-end), cm-strikethrough, cm-inline-code, cm-hmd-internal-link,
      cm-formatting(-header/-highlight), cm-comment, cm-math, cm-footref, cm-url, cm-blockid`
- [x] M18.3 实时预览新 token (§7)：`==highlight==` 隐藏 marker；`%%comment%%` 淡化；
      footref `[^id]` 上标 + 渲染 definition 行；block id `^abc-123` 淡化；
      HR widget；当 caret 在 block 外时隐藏 fence ```；隐藏转义 `\.` (Trilium 导出文件)；
      task 任意非空白字符 = done (x/X 划线 + muted)；callout 正则
      `/^\[!([^\]]+)\]([+-]?)(?:\s|$)/` + 完整色板/图标表 §21 + 默认标题 + fold mark
- [x] M18.4 Wikilink 遵循 §7 规则：`|` 后的 alias 在最前，排除嵌套 `[[`，NBSP→空格 + NFC；
      LP label 保留原始 `Note#Head` (aria-label = `Note > Head`，如 Obsidian)；
      图片 size param `![[img|300]]` / `![[img|300x200]]`
- [x] M18.5 精确 Tag regex §7 (unicode 字符集，排除纯数字，需 ≥1 个字母)；
      pill 两半 cm-hashtag-begin/-end
- [x] M18.6 默认快捷键 §4 (lib/editorCommands.ts)：Mod+B/I/K/L/D、Mod+/ (%%)、Mod+E
      (edit↔reading)、Mod+S、Alt+Enter 跟随链接；智能 toggle pair (wrap/unwrap +
      word-at-caret)；Enter/Backspace 继续 list markup
- [x] M18.7 Suggester `[[` (文件) + `#` (标签) — 完整移植 §9 的模糊评分公式
      (lib/fuzzy.ts：token pass → per-char pass，penalty mid-word/span/offset/length，
      basename 优先于 path −1)；标准 §20 的 dropdown `.suggestion-container`，接近
      底部时向上翻转；Enter/Tab/↑↓/Esc 通过 keymap Prec.highest (lib/suggest.ts)
- [x] M18.8 Math 渲染 KaTeX 懒加载 (内联 `$..$` + 单行 `$$..$$`)；code block
      语法高亮 (@codemirror/language-data)；GFM base (strikethrough/table/tasklist)；
      Obsidian 风格 checkbox (accent bg，radius 4px，size --font-text-size)
- [x] M18.9 行距匹配真实 app.css：`.HyperMD-header { padding-top: var(--p-spacing) }`，
      inline-title margin-bottom 0.5em，scroller line-height var(--line-height-normal)
- [x] M18.10 根据用户报告的 11 个 bug 的修复批次 (与 app 并排对照)：
      (1) 独立 HighlightStyle (lib/highlight.ts) 按 Obsidian 调色板着色 token — 消除来自
      defaultHighlightStyle 的 escape/bracket 异常红色；(2) 真正的 Embed：`![[note]]` transclusion 通过
      api.resolve + renderMarkdown 渲染 (NoteEmbedWidget，depth ≤3)，缺失的图片/文件 → box
      "could not be found"；(3) 嵌套 list 的纵向 indent guide (cm-indent 每单位 tab/4-space)；
      (4) 嵌套 blockquote `> >` 渲染多条竖线 (data-quote-depth + layered gradient)；
      (5) checkbox/bullet 在 callout/quote 内**工作** (在 marker 之后处理 body)；
      (6) callout fold +/-：StateField (存储 toggle，状态 = default XOR toggle → 对
      async load 稳健)，chevron 点击，`-` 默认折叠；(7) code block 颜色正确 + 语言标签
      在右侧 (data-lang)；(8) display math `$$` 修复 escape-pass 顺序 (最后运行，不
      占用 range)；(9) HR 去除多余 margin；(10) inline-HTML 行 (`<u>…`) 作为 HTML 渲染，
      mermaid 真正渲染 (lazy mermaid.js，StateField block widget)；(11) block comment `%%`
      多行整块变灰
- [x] M18.12 修复批次 3 (4 个编辑器 bug + Reading parity)：(1) HTML embed 中的表格与
      reading table 采用相同 metrics；(2) 内联 footnote `^[...]` 上标；(3) fenced code 背景内
      有 padding (16px)，indented code 去除背景 + 如 app 一样有 indent guide；(4) embed note 添加
      `markdown-embed-title` (文件名) + 修复多余空白 (在 widget 中重置 `white-space: normal`
      — cm-content 的 pre-wrap 会把 HTML 块之间的 \n 变成空行)；
      (5) Reading mode 与 Live 同步：task 自定义状态 `[/] [-] [>]`… 变为 checkbox
      (remark plugin `remarkObsidianTasks`，data-task，仅 x/X 划线)，li 去除 bullet，
      Properties 以 pill 形式显示 list value (tags/aliases)
- [x] M18.13 Reading mode 与 Live 完全同步 (根据 "Reading 与 Live 不同" 的反馈)：
      拆分出共用的 lib/callouts.ts；remark pipeline 新增：remark-breaks (换行 = <br>, §7)，
      ==highlight== → <mark>，%%comment%% 内联 + block 被丢弃，block id 隐藏，tag pill 与
      editor 相同字符集，math $/$$ → span[data-tex] 在 sanitize 后渲染 KaTeX，mermaid 在
      sanitize 后渲染，callout 遵循 §20 的 DOM (icon + title-inner + content，颜色按
      data-callout→slot CSS，fold +/- 点击切换，`-` 默认折叠)，wikilink 显示
      `Note > Head` (reading 规则 §7)，图片 size param。修复 sanitize bug：defaultSchema 限制
      a.className (仅允许 footnote class) 导致丢失 internal-link/tag class — filter 移除
      默认 entry；将 mark/u 加入 tagNames
- [x] M18.14 Reading mode = 将 Live Preview editor 本身设为 readonly (根据用户要求，
      替代 2-pipeline 架构)：Workspace 为 reading 模式移除 <Preview/>，Editor 添加
      compartment `EditorView.editable(false)` + `EditorState.readOnly` + StateField
      `livePreviewReadonly` 关闭所有随 caret 的 reveal-syntax (touches/lineActive/htmlBlock/
      mermaid/calloutFold)；CSS `.is-reading-mode` 隐藏编辑 affordance (table handles、property
      add/del、contenteditable) — checkbox 和链接仍可点击，如 Obsidian。两种模式如今
      结构上一致，不会偏离。(Preview 的 remark pipeline 仍用于
      split-pane source + public share。)
- [ ] M18.11 未来：用 MathJax 替代 KaTeX (绝对 glyph 对齐)，heading/block 模式
      suggester (`#`/`#^`)，多行 `$$` block，点击 tag → search，折叠 heading/indent，
      fold chevron 置于 title 之后 (现在置于之前)

---

## Phase 19 — 移动端 / 响应式 UI (FR-11，根据用户要求)
- [x] M19.1 Hook `useIsMobile` (matchMedia 768px) + store 中的本地 state `mobileDrawer` ('left'|'right'|null)
      (不持久化，不广播) → 手机 drawer 不影响桌面 `uistate` 同步
- [x] M19.2 CSS `@media (max-width: 768px)`：`.app` 单列 (workspace 全宽)；ribbon + 左侧边栏
      成为滑动 overlay drawer (translateX) + 右侧边栏右 drawer；模糊 backdrop；触摸目标 ≥44px
- [x] M19.3 App shell：移动端始终渲染侧边栏 (drawer)，添加关闭 drawer 的 backdrop；打开笔记时
      自动关闭 drawer；tab-bar 上的 hamburger (☰) + panel-right 按钮打开 drawer 而非切换宽度；
      移动端 view-header 上隐藏 crumbs + split 按钮 (防溢出)
- [x] M19.4 Edge-swipe：从左边缘滑动打开左 drawer，右边缘打开右 drawer，反向滑动关闭
- [x] M19.5 Format 工具栏 (组件 `FormatToolbar`，共用)：bold/italic/heading/list/checklist/
      quote/link/internal-link/code/tag/indent/outdent/undo/redo，通过 `lib/activeEditor`
      操作活动 editor；仅在编辑 (Live/Source) .md 笔记时显示。移动端 = 通过 visualViewport 固定锚定在
      键盘上方；**桌面端 = view-header 下方的 in-flow 工具栏** (根据用户要求)
- [x] M19.6 Viewport `viewport-fit=cover` + `interactive-widget=resizes-content` + safe-area insets；
      在 Chrome 设备模拟 390×844 上验证
- [x] M19.7 移动端对齐第 2 轮 (根据用户反馈)：(a) note 的 "…" 菜单 (ContextMenu) 被
      裁剪 → 在 viewport 内 clamp 位置 (top/left ≥8px，按 `innerHeight` 估算高度限制) +
      `max-height: 100dvh` 可滚动，行更大便于触摸；(b) 锁定 note 内容的横向平移
      (`.cm-host`/`.markdown-preview` 上 `overflow-x: hidden`，文字换行 `overflow-wrap: anywhere`，
      图片/code/表格自动收缩/内部滚动)；(c) 移动端 Settings + Version history 模态框全屏
      (`position: fixed; inset:0`)，settings-nav 变成横向滚动条，`.setting-row` 纵向堆叠，
      input 全宽，version-history 列表置于 preview 之上；share 对话框全宽

## Phase 20 — Graph 节点搜索与跳转 (根据用户要求，PRD 0.5)
- [x] M20.1 Graph view 上的浮动 "Find node…" 输入框：输入关键词 → 候选节点列表 (匹配
      label/path 的所有词，排序 tag 优先 > prefix > label > path + degree，前 50 个)；点击或 Enter (第一个
      结果) → 相机飞行 (pan+zoom lerp 15%/frame，最小缩放 2×) 到节点 + hover 风格
      高亮 (accent + 淡化无关联部分) 直到鼠标移动；Esc 关闭；wheel/drag 取消飞行

---

## Phase 21 — 窗格 ⋯ 菜单对齐 Obsidian (根据用户要求，PRD 0.6)
- [x] M21.1 ⋯ 菜单按 Obsidian Desktop 结构重建：分组 Backlinks in document →
      Split/Open in new window → Rename/Move/Make a copy/Bookmark/Add file property/Export to PDF →
      Find → Copy path/Version history/Open linked view → Reveal in navigation/Share → tabs → Delete
- [x] M21.2 note 中的 Find/Replace：集成 `@codemirror/search` (search panel top，⌘F/⌘⇧F/⌘G)；
      "Find…" 项通过 `editorFind()` 调用 `openSearchPanel` (activeEditor handle)
- [x] M21.3 Reveal file in navigation：`store.revealInTree` 展开祖先文件夹 + 打开 Files 面板，
      FileTree 监听事件 `wo-reveal-file` → scrollIntoView + 闪烁高亮 1.2s (data-path lookup)
- [x] M21.4 Add file property：不使用 prompt — `triggerAddProperty(view)` 精确触发 Properties widget 的
      "+ Add property" 按钮 (focus key 输入框 + 打开如 Obsidian 的 key 建议 dropdown)；如果 note 尚无
      frontmatter，则创建空 `---` block 后轮询直到 widget mount；菜单先切换到 Live。
      widget 中附带的修复：(a) list/tags value dropdown 在选择后卡住 (dd mount 在 theme
      wrapper 上，不被 widget rebuild 移除 → `choose()` 总是在 `mutate()` 前 `cleanup()`)；(b)
      Property type/Copy/Remove 菜单在左键点击图标时抖动 (用 `mousedown` 打开后紧接着的 `click`
      立即关闭) → 改为 `click` (openPropMenu 已 `stopPropagation`)
- [x] M21.5 Export to PDF：切换到 Reading view 后 `window.print()`；CSS `@media print` 隐藏 ribbon/
      sidebar/tab/header/toolbar/status，仅打印 note 内容 (黑字白底，`@page` margin 16mm)
- [x] M21.6 Open version history (FR-4)：server `git.log(path)` + `git.showFile(hash, path)` →
      路由 `GET /api/git/log|/show`；模态框 `VersionHistory.tsx` 列出触及文件的 commit，预览
      版本内容，"Restore this version" 覆盖 + reload；未启用 Git Sync 时为空
- [x] M21.7 Open in new window：`window.open(pathToUrl(path))` 在新标签页打开 deep-link `/note/<path>`；
      Open linked view 子菜单 (Backlinks/Outgoing links/Outline → `setRightPanel`)

---

## Phase 22 — 文件夹选择器 "Move file to…" + Bookmarks/Recent 上下文菜单 (根据用户要求)
- [x] M22.1 Obsidian suggester 风格的文件夹选择器模态框 (`FolderPicker.tsx`)：输入筛选文件夹，↑↓
      导航，↵ 移动到所选文件夹，⇧↵ 按输入名称创建新文件夹后移动，esc 关闭；footer
      提示按键。由 `store.movePath`/`setMovePath` 驱动。替换 ⋯ 菜单 (Workspace)
      和文件树右键菜单 (FileTree) 中的旧 `prompt()`。移动文件夹时过滤掉当前文件夹 + 其自身/子项。
- [x] M22.2 Bookmarks & Recent 面板的右键上下文菜单 (`BookmarksPanel.tsx`)：
      Open/Open to right/Reveal in navigation/Move file to…/Bookmark↔Remove bookmark/Copy path；
      Recent 项添加 "Remove from recent" (`store.removeRecent`)。此前 right-click 会落入
      浏览器原生菜单，因为该面板没有 `onContextMenu`。
- [x] M22.3 将 Bookmark/Recent 行拖放到文件树中的文件夹以移动 (共用 FileTree 已读取的 payload
      `text/wo-path`) + 每行 hover 时显示操作按钮 (📁 Move file
      to… 和 ✕ Remove bookmark / Remove from recent)。

## Phase 23 — 在 ```html code block 中渲染 HTML (根据用户要求)
- [x] M23.1 每个 ` ```html ` block 上的 "Render HTML" 按钮 — `htmlPreviewField` (StateField block
      widget 在 `livePreview.ts` 中，在 `Editor.tsx` 注册)。由于 Reading/Live 都是 CodeMirror
      (M18.14)，按钮必须位于 editor 中而非 `Preview.tsx`。Widget 放置在 fence 开头行的
      **正上方** (`side: -1`) — HTML block 可能巨大 (保存的整个页面约 296KB)，如果放在 block 之后
      按钮会落到 viewport 之外 (CodeMirror 虚拟化 DOM) → 无法点击。点击切换显示/隐藏
      `<iframe sandbox="allow-scripts allow-popups allow-forms allow-modals">` (非 same-origin →
      保存页面的 script 会运行但与 vault/app 的 cookie/localStorage 隔离)，source 仍显示
      在下方。CSS `.cm-html-preview` + iframe 70vh 纵向 resize。同一按钮加入 `Preview.tsx`
      (`setupHtmlPreview`，包裹 `.html-block`) 用于 public 页面 `/share`。通过 CDP 实际验证：
      iframe 正确渲染已保存的 ChatGPT 页面。Typecheck + build 干净。
- [x] M23.2 (根据反馈)：渲染时 (a) 同时隐藏 code block，(b) iframe 全宽窗格。
      添加 state `htmlRenderedState` + effect `toggleHtmlRender` (类似 callout fold) 以获知哪个 block
      正在渲染 → rendered 时 `Decoration.replace` 整个 block (隐藏 code + 插入 iframe)，collapsed
      时仅在顶部插入按钮 (code 仍显示)。Full-width：内容在 `--file-line-width`
      700px 列中居中，故 `.is-rendered` 使用 `left:50% + translateX(-50%)` + width = `view.scrollDOM.clientWidth`
      (JS，resize 时 sync) 以铺满 scroller 宽度。CDP 验证：iframe 992px 与窗格吻合，code 隐藏，
      双向 toggle OK。

## Phase 24 — 文件树上下文菜单中的 Copy/Cut/Paste (FR-1，根据用户要求)
- [x] M24.1 store 中的 Clipboard state：`clipboard: {path, mode:'copy'|'cut'} | null` + `setClipboard`
      (session-local，不在 `PERSIST_KEYS` 中，故不保存到服务器/不广播)。文件右键
      菜单添加 Copy/Cut，文件夹添加 Copy/Cut；Paste 项仅在 clipboard 有数据时渲染。被
      Cut 的行变淡 (`opacity .5`)。
- [x] M24.2 `doPaste` (FileTree)：目标 = 点击的文件夹或文件的父目录。Cut → `api.rename`
      (移动文件/文件夹；粘贴到原位置 = no-op；阻止将文件夹粘贴到其自身/子目录；粘贴后
      清除 clipboard)。Copy → `api.copy` 递归，`uniqueChildName` 避免重名 (`… copy`/`… copy N`)，保留
      clipboard 以便多次粘贴。
- [x] M24.3 Server：`vault.copy(from,to)` 使用 `fs.cp` recursive (文件 + 文件夹)，返回创建的文件
      列表以 reindex；如果目标已存在则抛出异常。路由 `POST /api/files/copy` 为新的 `.md` upsert search + link graph
      然后 schedule auto-commit。Client `api.copy`。Typecheck server + web 干净。
- [x] M24.4 (根据反馈)：右键文件树空白区域现在弹出 app 的上下文菜单 (此前落入
      浏览器原生菜单)。FileTree 的 div 上的 `onRootContext` (`minHeight:100%` 覆盖整个 `.sidebar-body`)：
      New note / New folder (vault root) + Paste (仅在有 clipboard 时) → `pasteToRoot` 粘贴到 vault root
      (Cut = `rename` 到 root，Copy = `api.copy` 避免重名)。同样适用于 "Vault is empty." 分支。

## Phase 25 — Canvas (FR-12，PRD 1.0，根据用户要求)
- [x] M25.1 `web/src/lib/canvas.ts`：JSON Canvas types (CanvasNode text/file/link/group，CanvasEdge)，
      安全 parse/serialize (为空/损坏时默认 `{nodes:[],edges:[]}`)，id helpers (genId)，
      preset colors `1..6`→hex，edge 几何 (按 side 的 anchor + Bézier path)，hit-test bbox。
- [x] M25.2 `web/src/components/CanvasView.tsx`：自管理视图 (如 GraphView) 读取 store `content`，
      parse，render。Pan/zoom (wheel 以光标为中心缩放，拖动背景 pan，space+drag)，点状背景网格。Nodes
      在 transform container 中绝对定位；edges 使用 SVG layer (在 nodes 之下)。工具栏 zoom in/out/fit/100%。
- [x] M25.3 Node 交互：double-click 背景 → text node + 编辑；drag 移动；8 个 resize handles；
      double-click text node → textarea 编辑 (Esc/blur 退出)；file node 渲染 embed (note=Preview，
      图片=`<img src=rawUrl>`)；link node = `<a>` card；切换调色板颜色；删除 Delete/Backspace。
- [x] M25.4 Edge 交互：hover 显示 4 个边点；拖动点到其他 node 创建 edge (箭头朝向 `to`)；
      double-click edge 添加/编辑 label；选中 edge 切换颜色/删除。Select：点击、marquee、Shift+click，
      移动/删除组；浮动 context 工具栏 (颜色、删除)。
- [x] M25.5 通过 `setContent`+`save` 的自动保存防抖 ~900ms (标记 dirty → 写入 `.canvas`)。接入
      `Workspace.tsx` (当 path 为 `.canvas` 且非 folder/graph 时渲染 CanvasView)。CSS `.canvas-*`。
- [x] M25.6 创建新 canvas：store `newCanvas(dir)` (Untitled.canvas 避免重名，body `{"nodes":[],"edges":[]}`)；
      "New canvas" 加入 FileTree 上下文菜单 (file/folder/root) + command palette。Typecheck web 干净。
- [x] M25.7 **Marquee select (Shift+拖动) + 对齐吸附 (parity Obsidian，reverse-engineer asar)：** 在背景上向左拖动
      = **pan** (按用户意愿保留 — 放弃 marquee-默认 的实验)，**Shift+拖动 = marquee 选择**；
      pan 也可通过 Space/中键/右键拖动，单指触摸 pan。拖动 node：边/中心吸附到其他 node (`snapMove`
      在 canvas.ts 中，移植 `getSnapping/O3/P3`，
      吸附点 = 4 角 + 中心，dist = `ceil(15/scale)`)，绘制 **guide line** (`.canvas-snaps`)；Alt (mac 上 ⌃) 关闭
      snap；拖动时 Shift = 锁定轴。CDP 验证：marquee 选中 5 个 node，对齐时 guide 出现，释放时消失。
- [x] M25.8 **text card 中的格式快捷键** (mirror `obsidianKeymap`)：textarea 上的
      ⌘B/I/K(add link)/L(task)/`⌘/`(comment)；`toggleWrap` 开关 marker。**Text alignment**：`TextNode.textAlign` (left/center/right) —
      selection menu 中的按钮 (选中 text node 时) + 右键菜单中的 "Align" 子菜单；CSS 同时应用于 textarea
      和 body render。(扩展超出 JSON Canvas spec — 真实 Obsidian 忽略此字段。)
- [x] M25.9 **根据反馈的 UX 修复：** (1) edge 箭头更大 (marker 14×14，refX 11)。(2) card 右键菜单
      在**光标处**打开 + `position:fixed` + 测量尺寸后移入屏幕内 (不溢出)。

## Phase 26 — 图片：resize + zoom lightbox (FR-2，PRD 1.2，根据用户要求)
- [x] M26.1 `web/src/lib/imageLightbox.ts`：全屏 lightbox 单例 (挂载到 `document.body`)。
      按光标 wheel zoom + 双指 pinch 以中心缩放 (transform-origin 0 0，保持固定点的公式)，
      鼠标拖动/单指 pan，double-click 重置 (fit ≤ natural)，Esc/点击背景/× 按钮关闭；pan listener
      按每次拖动绑定，故不泄漏。
- [x] M26.2 Live Preview `ImageWidget` (livePreview.ts)：hover 时显示左/右 2 个 handle，拖动改变
      宽度 (clamp 40..contentDOM width，保持比例)。`writeImageWidth()` 通过 `posAtDOM` 恢复位置，重
      新找到覆盖该位置的 embed token 并写入 size param：`![[img|W]]` (wikilink) / `![alt|W](url)` (markdown) —
      若有最后的数字 segment 则替换，否则 append。点击图片 (非拖动) → `openLightbox`。
- [x] M26.3 markdown 图片 `![](…)` 的 Size param：alt 携带 `|W`/`|WxH` → width/height **同时**应用于 Live
      (livePreview.ts imgRe) 和 Reading (markdown.ts) — 此前仅 wikilink `![[…]]` 才有 size。
- [x] M26.4 Reading view (Preview.tsx) 点击 `<img>` → `openLightbox(currentSrc, alt)`；CSS handle resize
      (`.cm-image-resize`) + `.image-lightbox*` + cursor `zoom-in`。Typecheck 干净。

## Phase 27 — 桌面应用 (Electron，多平台) — FR-13，PRD 1.5 (根据用户要求)
- [x] M27.1 Workspace `desktop/` (Electron shell)。`src/main.ts`：单实例锁；首次选择 vault
      (dialog，默认 `~/Documents/WebObsidianVault`)；`DATA_DIR`/config/logs 在 `userData` 中；**将现有 server
      作为子进程 spawn** 通过 `ELECTRON_RUN_AS_NODE` 绑定 `127.0.0.1` + 随机空闲端口；等待
      `/healthz`；`BrowserWindow` 加载 `http://127.0.0.1:<port>`；菜单 File (Switch Vault / Open Vault·Data·Logs)，
      Edit/View/Window/Help；将外部链接在系统浏览器中打开；退出时 kill server。`src/preload.ts` 极简。
- [x] M27.2 无缝 Auto-login：生成随机/机器密码 (保存到 `userData`)，传递 `WEBOBSIDIAN_PASSWORD`
      (override)；通过 Electron `net` login，从 `Set-Cookie` 获取 JWT，用 Bearer 将默认密码改为 secret 以
      关闭 `mustChangePassword`，然后**将 JWT cookie seed 到 `session.defaultSession`** → 窗口直接进入 app，不
      询问密码。验证：fresh data dir → `login` 返回 `mustChangePassword:false`，`userPasswordHash` 已设置。
- [x] M27.3 Build pipeline `scripts/build.mjs`：esbuild bundle `desktop/src` (main+preload，external `electron`)
      → `dist/`；esbuild 将**已编译的 server** (`server/dist/index.js`) bundle 成 1 个 ESM 文件
      `.gen/server/dist/index.mjs` (external `fsevents`，banner `createRequire`)；复制 `server/public` →
      `.gen/server/public`。Bundle server 冒烟测试可运行 (healthz/login OK)。
- [x] M27.4 electron-builder config (在 `desktop/package.json` 中)：`extraResources` map `.gen/server`→
      `resources/server`；目标 macOS `dmg`+`zip` (arm64/x64)、Windows `nsis`+`portable` (x64/arm64/ia32)、
      Linux `AppImage`+`deb` (x64/arm64)；icon 从 `assets/logo.png`→`buildResources/icon.png` (1024²)；
      `electronVersion` pin 33.4.11 (workspace hoist)。验证：`electron-builder --dir` 打包 `WebObsidian.app`，
      运行 packaged 版本 → server 从 `resources/server/dist/index.mjs` 启动，healthz/login OK。
- [x] M27.5 CI：`.github/workflows/release.yml` 触发 tag `v*` (+ manual)，matrix macOS/Windows/Ubuntu，每个
      runner `npm ci` → `npm run build` → `npm --workspace desktop run dist:publish` (electron-builder publish
      GitHub Release draft，`GH_TOKEN`，`CSC_IDENTITY_AUTO_DISCOVERY=false`)。`ci.yml` 添加 typecheck + build
      bundle desktop。根 scripts `desktop`/`desktop:dist`/`desktop:publish`；`.gitignore` 添加 `desktop/.gen`，
      `desktop/release`。

### 进度日志
- 2026-10-08（修复容器健康检查）：健康检查地址由 `http://localhost:8787/healthz` 改为
  `http://127.0.0.1:8787/healthz`。容器内 `localhost` 解析为 IPv6 `::1`，而服务只监听 IPv4
  `0.0.0.0`，导致健康检查连接被拒、容器被标记 unhealthy（实际服务正常）。改 Dockerfile 与
  docker-compose.yml。
- 2026-10-08（编辑分支自动跟进主分支）：新增 `github.autoFollowBase` / `followIntervalSec`；`git.ts` 抽出
  `preSyncCheck`（投稿前检查：有未合并 PR → 中止并提示等待维护者；Actions 空窗期 → 触发 `sync-web-edit.yml`
  并轮询，失败/超时回退本地合并）、`followBase`（定时/手动把 `baseBranch` 合并进 `editBranch`，无 PR 时执行）；
  新增 `services/basefollow.ts` 调度器、`POST /api/git/follow-base`（owner）、`githubApp.ts` 的
  `findOpenPullRequest` / `dispatchWorkflow`；Settings 增加开关与「立即跟进主分支」；更新 GITHUB_APP.md。
  typecheck + build 通过。
- 2026-10-06（开始 M10.5）：核对 `origin/main..HEAD` 的 28 个提交及当前实现，开始重写 QUT WiKi 定制版 README；以代码校正分支默认值与访客权限说明。
- 2026-06-27 (安全修复 — 通过 share token 提权)：`verifyToken()` (server/src/services/auth.ts)
  仅检查签名，因此**任何**用 `auth.jwtSecret` 签名的 token 都会被接受为 owner 会话。公开
  endpoint `POST /public/shares/:id/unlock` 用相同 secret 签发 unlock-cookie → 被分享者 (知道 share
  密码) 可将该 JWT 作为 Bearer token 重放并读写整个 vault、`/api/settings`、`/api/keys`、WS stream。
  **修复：** (1) `verifyToken()` 强制 `sub === 'owner'` 并固定 `algorithms: ['HS256']` (同时阻止 alg=none)。
  (2) `issueToken()` 固定 HS256。(3) 纵深防御：unlock token 现在携带 `sub: 'share'`，且 `isUnlocked()`
  (shares.ts) 验证 `sub === 'share'` + 正确的 `share.id`，固定 HS256。已验证：owner=接受，share=拒绝，
  alg=none=拒绝。Typecheck 干净。来自 enduser 的私人报告，依据 SECURITY.md (v0.1.0，commit 8c5c283)。
  **附带同一报告中的 2 项低级别加固：** (a) `rendercanvas.ts` — 来自 `.canvas` JSON 的几何 node
  (`x/y/width/height`) 和 `textAlign` 被直接插值到 `style="…"` 而未转义/强制类型 → 恶意 `.canvas`
  (导入/下载后分享) 可能逃逸 attribute & 注入 HTML。修复：在
  parse nodes 时将几何强制为有限数字 (`num()`) (对 `style`、`bbox`、`shifted` 加法均安全)，白名单
  `textAlign` ∈ {left,center,right}。
  已测试：payload `<script>`/`onerror` 被失效。(b) `settings.ts#sanitizeVault` — `allowedRoots` 现在过滤仅
  非空 string 并 `path.resolve` 为绝对路径，避免持久化垃圾元素导致 `path.*` 崩溃。**推迟 (item 1)：**
  default-password (`123456`) 通过 API 登录是有意设计 ("即可用"，auth.ts §10-11) — 不悄悄
  修改；若收紧需先更新 PRD。Prod 现已设置自定义密码，故不受暴露。
- 2026-06-24 (安全修复 F-03 — 通过 `X-Forwarded-For` 绕过 login 速率限制)：此前
  `app.set('trust proxy', 1)` 始终开启 ⇒ `req.ip` 取自 `X-Forwarded-For`；直接暴露的实例
  (绑定 `0.0.0.0`) 允许攻击者每次请求自行设置 XFF → 每个"IP"一个 bucket → 突破
  10 次/15 分钟的限制 (暴力破解 6 字符默认密码)。**修改 3 处：** (1) `server/src/config.ts` —
  添加从 env `TRUST_PROXY` 解析的 `trustProxy`，**默认 `false`** (无代理时不信任 XFF)；
  接受 `true`/跳数/子网列表。(2) `server/src/index.ts` — `app.set('trust proxy', config.trustProxy)`
  替代硬编码值 `1`。(3) `server/src/middleware/ratelimit.ts` — limiter 按
  `req.socket.remoteAddress` (**不可伪造**的 TCP peer 地址) 而非 `req.ip` 限流，故 throttle
  无论 `trust proxy` 配置如何都稳固。更新 PRD (FR-9 env `TRUST_PROXY` + 安全 NFR)。Typecheck 干净。
  **2026-06-27 调整 (合并 PR #1 时)：** 由于上述按 TCP socket 的 rate-limit 修复已自动修补 F-03
  而无论 `trust proxy`，故**保持 `trust proxy` 默认为开启 (`true`)** 而非改为 `false` — 避免
  打扰在反向代理后运行的大多数用户 (丢失 cookie 的 `Secure` 标志 + 需额外配置)。`TRUST_PROXY`
  仍可配置以在需要时降至 `false`/跳数/子网。
- 2026-06-23 (修复 — 指向 `.canvas` 文件的 internal link)：点击指向 `Foo.canvas` 的 wikilink 被导航到
  新的 markdown 笔记 `Foo.canvas.md`。原因：link graph (`keyToPath`) 仅索引 markdown 文件，故
  `/api/.../resolve` 对带 `.canvas` 后缀的 target 返回 `null` → client 落入创建笔记并追加 `.md` 的分支。
  修改 2 处：(1) `server/src/routes/search.ts` — 当 `resolveLink` miss 且 target 后缀**非 md** 时，fallback
  到 `resolveFile` (全 vault 文件索引) 以正确打开 canvas；裸 `[[Foo]]` 保持旧行为。(2)
  `web/src/lib/store.ts#openWikilink` — 仅当 target **无后缀**时才追加 `.md`，避免 `Foo.canvas.md`。Typecheck 干净。
  **部署时额外发现 2 个 bug：** (a) 已移入 `.trash` 的 note 仍被 link graph 索引，故垃圾文件
  `Foo.canvas.md` (由旧 bug 本身创建) **遮盖**真实 canvas → `/api/resolve` 返回 `.trash` 中的 path。修复：在
  `listMarkdownFiles()` + `updateLinkGraphForFile()` 中跳过 dotfile/dot-dir (与 tree view & fileindex 同步)。(b)
  `.dockerignore` 未排除 `obsvault` (~6 GB LFS bind-mount)，故 `COPY . .` 吞掉整个 vault → prod build 挂起 ~30 分钟；
  添加 `obsvault`/`*.tsbuildinfo`/`desktop/dist|release` → COPY 降至 ~1.5s。**已在 prod 部署并验证**
  (`xnohat.i234.me:8787`)：resolve `Agent SLM Business Model.canvas` → 正确的真实 canvas，裸 wikilink & 缺失 note 无 regression。
- 2026-06-22 (FR-13 — 跨平台 Electron 桌面应用，根据用户要求)：将 WebObsidian bundle 成可从
  GitHub Release 下载的 mac/win/linux (arm64/x64/ia32) 安装应用。添加 `desktop/` workspace 作为 **Electron
  shell**，将现有 Express server 作为子进程 spawn (`ELECTRON_RUN_AS_NODE`，`127.0.0.1` + 随机
  端口) 然后在 `BrowserWindow` 中加载 SPA — 不改动一行 server/web 代码。打包关键：server
  **没有 native runtime module** (仅 `fsevents` 可选/macOS) 故 esbuild 可将其 bundle 成 **1 个文件
  `.mjs`**，且跨架构只是下载对应的 Electron binary (无需 rebuild/qemu/wine)。无缝 UX：首次
  选择 vault，数据进入 `userData`，通过每机器随机密码 **auto-login** (将 JWT cookie seed 到
  session，自行设置自定义密码以避免被要求改密)。electron-builder 打包：dmg/zip · nsis/portable ·
  AppImage/deb；CI `release.yml` matrix 3 个 OS 在 push tag `v*` 时 publish GitHub Release (draft)。
  **在 macOS arm64 上真实验证**：(1) bundle server 独立运行 → healthz `{ok:true}`，login override OK；
  (2) 用 seed config 运行 Electron (unpacked) → server 在随机端口 boot，`userPasswordHash` 已设置，
  `mustChangePassword:false`，无错误；(3) `electron-builder --dir` → `WebObsidian.app`，布局
  `resources/server/{dist,public}` 正确，运行 packaged 版本 → server 从 resources 启动，healthz/login OK。
  Typecheck desktop 干净。*Gotcha：* shell 有
  `ELECTRON_RUN_AS_NODE=1` (来自 crawbot) 使测试时 `require('electron')`→string → 启动测试须
  `env -u ELECTRON_RUN_AS_NODE` (packaged app 不受影响)；electron hoist 到根 node_modules 故须为 builder pin
  `electronVersion`。**未完成：** code-sign/notarize、auto-update。
- 2026-06-22 (修复 CSP 下不允许 `unsafe-eval` 的 Graph view)：在 production host (如 `360of.me`) Graph
  view 白屏 + 错误 `Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval module`。
  PixiJS v8 用 `new Function()` 生成 shader/UBO 代码，被 CSP 阻止。修复：在 `GraphView.tsx` 中 import
  `pixi.js/unsafe-eval` (自动安装 non-eval polyfill 的模块) 于 `app.init()` 之前；为
  `vite-env.d.ts` 中的 subpath 添加 `declare module` (Pixi 未为此 subpath 导出 `types`)。Typecheck + build 通过。
- 2026-06-19 (FR-2 — 音频/视频 embed 如 Obsidian 般可播放，根据用户要求)：`.mp4` note
  (Trilium 导出：frontmatter + `![[clip.mp4]]`) 此前仅显示蓝色链接，现在渲染**真正的 HTML5
  播放器**。修改 3 条渲染路径 — Live Preview (`livePreview.ts` 中的 `MediaWidget`，当前
  同时用于 Reading 只读)、Reading/transclusion/canvas (`markdown.ts`)、public share SSR
  (`renderhtml.ts`)；三者都在 `rehype-sanitize` allowlist 中添加 `<video>/<audio>/<source>` (否则
  sanitizer 会删除 tag)。从树中直接打开媒体文件 → 播放器 (`Workspace.tsx`，如同图片)。扩展名集匹配
  Obsidian (视频 `mp4/webm/ogv/mov/mkv`，音频 `mp3/wav/m4a/3gp/flac/ogg/oga/opus`) 归集到
  `web/lib/media.ts` + `server/services/mime.ts`；size param `![[clip.mp4|W]]` 设置视频 width。
  **关键：** 提供二进制的 route (`GET /api/files/content` + raw share) 从 `readFileBuffer`→`res.send`
  (将整个文件读入 RAM，无法 seek) 改为**stream + HTTP Range** (`services/httpfile.ts` →
  `sendFileWithRange`)：返回 206 Partial Content 故可 scrub/seek 视频且 Safari 可播放。真实验证：
  login `access` → `GET …/8257903_hd (2).mp4` (从 `Attachments/` 解析 basename，17MB) 返回 206
  (`Content-Range: bytes 0-1023/17758055`，`video/mp4`，`Accept-Ranges: bytes`)，完整 GET 200，非法
  range 416；sanitizer 保留 `<video>/<audio>` (测试 `renderNoteHtml`)。应用内视觉截图
  被阻止 (Chrome debug profile 被其他实例锁定 — 不擅自 kill) → 通过 bundle 含
  `cm-embed-video`/`media-embed` + server/sanitizer 契约验证。
- 2026-06-19 (修复 Files 面板的 2 个 bug — 在测试 vault 上用 Chrome DevTools 端到端验证)：
  **(1) Sort 按钮不工作：** sort 菜单用**左键点击**打开后立即被该次点击关闭。
  `ContextMenu` 绑定 `window 'click'` listener 以在点击外部时关闭；对于左键点击，React commit effect 之后，
  该点击仍在向 `window` 冒泡 → listener 捕获 → 关闭菜单。(右键菜单不受影响，因为
  `contextmenu` 事件不发出 `click`。)修复：在**下一个 tick** (`setTimeout(…, 0)`) 绑定关闭 listener，
  位于 `web/src/components/ContextMenu.tsx`。验证：点击 Sort 按钮 → 菜单显示全部 6 项 (与 Obsidian app 一致：
  File name A→Z/Z→A、Modified new→old/old→new、Created new→old/old→new) → 选择 "File name (Z to A)" → 文件重排 (文件夹仍分组在前)。
  **(2) 拖放移动文件无效：** 仅**文件夹行**接受 drop；将文件放到**另一个文件**或
  **已展开文件夹的子区域**时 drop 事件冒泡到 root handler → no-op (原文件) 或误移到 vault root。
  修复：文件行也成为 drop target (`onDragOver/onDragLeave/onDrop` + class `drop-target`)，放到文件 = 移到
  **该文件的父目录** (与 Obsidian 行为一致) 在 `web/src/components/FileTree.tsx` 中。验证：将 root 文件拖放到
  Alpha 文件夹 (已展开) 中的文件上 → 文件完全移入 Alpha (此前原地不动)。
- 2026-06-18 (Phase 30 — Canvas 交互升级 + Canvas public share + 根据持续反馈的一批 UX 修复)：
  **Canvas (M25.7–25.9)：** marquee 拖动选择多个 node + 对齐引导线 (alignment snap-guides) 移植自
  Obsidian asar 的 `getSnapping/O3/P3` (snap 4 角 + 中心，dist `ceil(15/scale)`，Alt 关闭 snap，Shift 锁定轴)；
  格式快捷键 (⌘B/I/K/L/`⌘/`，`toggleWrap`) + 文本对齐 (`TextNode.textAlign`，selection-menu 按钮 + 子菜单)。
  **Canvas public share (FR-10 扩展)：** `server/src/services/rendercanvas.ts` 将 `.canvas` 渲染为静态 HTML
  (node 绝对定位 + edges SVG，text/embed 通过 `renderNoteHtml`，图片 allowlist 通过 `canvasEmbedTargets`)；`sharepage.ts`
  canvas 分支 (布局 `bare`，og:meta)，`shares.ts` 允许 `.canvas`；client 为 canvas 打开 "Share…" (Workspace +
  FileTree)。CDP 端到端验证：创建 share → `/share/:id` HTTP 200 渲染完整 node/edge/arrow + og:title。
  **UX 修复：** (a) edge 箭头更大；(b) card 右键菜单在光标处打开 + 屏幕内 clamp (fixed + 测量)；
  (c) **收起左侧面板不再留下右侧空隙** — `.app` grid 改为按 `--sidebar-width/--right-width` 变量分列
  + 逐列 pin `grid-column` (editor 列始终 `1fr`)；(d) **拖动 resize 左侧边栏** (`.sidebar-resizer`，clamp 180–560px，
  保存到 `localStorage`)；(e) 移除 Files 头部多余的 **Refresh** 按钮 (下方已有 Sync)；(f) **修复 2 个
  Attachments/attachments 文件夹** — upload 以**不区分大小写**解析文件夹 (`vault.resolveDirCaseInsensitive`) 故复用现有 folder 而非创建重复。
  Typecheck + build (server + web) 干净。
- 2026-06-15 (Phase 29 — 按修改/创建时间排序，借助 stat cache 提速)：向 Files 头部 dropdown 添加 4 个按
  时间排序选项 (Modified/Created · new→old / old→new)。**快：** server 在 RAM 中维护
  `statCache` (Map path→{mtime,ctime}) — `listTree()` 填 1 次 (按目录并行 stat)，
  稳态读 cache → 0 syscall；watcher 在文件 add/change/unlink 时调用 `invalidateStat(rel)` 故仅
  对改变的文件 re-stat。彻底避免旧注释警告的 27k stat/次-fetch 问题。`TreeNode` 添加 `ctime`
  (server 取 `birthtimeMs || mtimeMs`)。Sort 客户端按 folder 递归 (folder 始终分组在前，按
  名称排序；file 按所选标准) — 正如 Obsidian 仅对面板中**当前可见**的 item 排序 (collapsed
  不渲染)。`treeSort` 扩展为 6 个值，持久化。Typecheck + build 干净。
- 2026-06-14 (Phase 28 — 根据用户要求对齐 Obsidian 的 Files 文件树头部工具栏)：重建 Files
  侧边栏头部，按钮齐全如 Obsidian：**New note** (icon `square-pen`)，**New canvas** (`layout-dashboard`)，
  **New folder** (`folder-plus`)，**Change sort order** (dropdown：File name A→Z / Z→A，当前
  选中项有 ✓ — `treeSort` persisted，客户端递归排序，folder 始终在前)，**Auto reveal current file**
  (toggle `autoReveal` persisted — 切换文件时自动展开 ancestors + 滚动到 active 文件)，**Collapse all /
  Expand all** (1 个按钮根据 `expanded.length` 切换状态；expand-all 通过
  `collectFolderPaths` 收集所有 folder path)，+ 保留 Refresh/Trash。Store：`setExpanded`、`treeSort/setTreeSort`、
  `autoReveal/toggleAutoReveal` (加入 PERSIST_KEYS + applyPersisted)。CSS：`.nav-header` 用 `flex-wrap`
  (8 个按钮在移动端不溢出)，`.nav-action.active` 用 accent 色。注意：按 modified/created time 排序尚未
  实现，因为 server 有意不对每个文件 stat mtime (~27k 文件 → 每次 fetch tree 27k syscall)。Typecheck +
  build 干净；bundle 含足够按钮字符串。
- 2026-06-14 (Phase 27 — 根据用户反馈的 Canvas 移动端 edit-save + New canvas 按钮)：(1) **修复
  Android Chrome 双击编辑 node 时无法保存 text**：原因是软键盘关闭时 `<textarea>` 的 blur
  通常**不**触发 → 编辑丢失。添加 `commitTextEdit()` (幂等，
  通过 `editingNodeRef` guard) 汇集所有保存路径，并在 document 上添加 **capture-phase 的 `pointerdown` listener**
  (编辑时运行)：在 textarea 外触摸/点击 (除 `.canvas-textmenu/.canvas-linkpicker/.canvas-notepicker`)
  → commit。onBlur/linkPicker-dismiss 现在也经由 `commitTextEdit` 路由。(2) **double-tap touch 自动识别**
  在 `beginNodeDrag` 中 (同一 node 2 次 tap <350ms) → `activateNode` (text→edit，file→open，link→open)
  因为 Android 不可靠地发出 `dblclick`。(3) 在 Files
  侧边栏头部 New note/New folder 旁的 **"New canvas" 按钮** (icon `layout-dashboard`) — 此前只能通过右键创建 canvas (移动端
  不可用)。Typecheck + build 干净；bundle 含 tap-outside selector + 350ms 阈值。
- 2026-06-14 (Phase 26 — 图片：根据用户要求的 resize + zoom lightbox)：(1) **拖动 resize** 嵌入
  图片 — Live Preview 中 hover 时显示左/右 2 个 handle 条，拖动改变宽度 (clamp 40..content 宽度，
  保持 height auto 比例) 并通过 `writeImageWidth()` **写回 source** 为 Obsidian 风格 size param：
  `![[img|W]]` 用于 wikilink embed，`![alt|W](url)` 用于 markdown 图片 (通过 `posAtDOM` 恢复 widget 位置然后
  重新匹配覆盖该位置的 token)。(2) **markdown 图片的 Size param** `![](…)`：alt 携带 `|W`/`|WxH` 现应用于
  宽度/高度，Live (imgRe) 和 Reading (markdown.ts) 均适用 — 此前仅 `![[…]]`。(3) **Lightbox zoom**
  (`lib/imageLightbox.ts`)：在两种模式点击图片 → 全屏 overlay；按光标 wheel zoom，双指
  pinch 以中心缩放，拖动/单指 pan，double-click 重置，Esc/点击背景/× 关闭。Typecheck 干净。Build + deploy prod。
- 2026-06-13 (Phase 25s — Canvas drag handle + 修复移动端 node 左侧被裁切)：(1) **drag handle** (圆点
  grip) 浮动在每个 node 顶部 — tap/长按拖动以移动 node (便于触摸)；hover/selected 时显示且
  **移动端始终显示**；`onPointerDown→beginNodeDrag`，`touch-action:none`。(2) **修复移动端 Safari 某些
  zoom 级别下 node 左侧被裁切一块**：`.canvas-world` 原本 `width:0;height:0` → Safari 裁切位于原点左侧/上方的
  缩放后代 → 改为 `width:100%;height:100%;overflow:visible`。冒烟测试
  (viewport 390px)：node 渲染完整左边框；grip 通过 touch +200/+150 和 mouse −150/−100 拖动 node；背景 pan
  仍 +120；无 console 错误。Typecheck + build 干净。Deploy prod。
- 2026-06-12 (Phase 25r — Canvas 移动端：pinch-zoom + 工具栏不重叠)：手机上 canvas 无法
  pinch-zoom (`touch-action:none` 阻止浏览器手势) 且 2 个下方工具栏互相覆盖。修复：(1)
  在 viewport 上通过 **capture-phase** pointer listener 实现 **pinch-to-zoom + 双指 pan** (第 2 指取消 1 指
  drag 后 pinch，即使放置在 node 上也运行)；1 指 pan 仍用旧 pointer drag。(2) `@media
  (max-width:768px)`：将 **zoom 工具栏 (左下)** 和 **add 工具栏 (右下)** 分开，触摸目标更大。
  冒烟测试 (viewport 390px，synthetic touch)：pinch 缩放 1.5→4 和 4→0.8；1 指 pan Δx 正确；工具栏分
  2 角；无 console 错误。Typecheck + build 干净。Deploy prod。
- 2026-06-12 (M3.6 — Trash UI + deleteMode，根据用户要求)：添加设置 `vault.deleteMode`
  (`trash` 默认 | `permanent`) — DELETE `/api/files/` 分支 trash vs `vault.remove()` 彻底删除。
  Service vault：`listTrash/restoreFromTrash/deleteFromTrash/emptyTrash` (+ `pruneEmptyDirs`，guard
  `assertInTrash` 防止在 `.trash` 之外操作)。路由 `/api/files/trash` (GET list · POST restore ·
  DELETE item · DELETE empty)。Frontend：`api.listTrash/restoreTrash/deleteTrashItem/emptyTrash`，store
  `trashOpen/setTrash`，模态框 `TrashView` (Restore / 永久删除 / Empty trash) 从 Files 头部 🗑 按钮打开，
  command palette "Open trash"。Settings → Vault & Files 添加删除模式 select。Confirm/notify 文件树 +
  pane 菜单改为通用 "Delete" + 按 response 报告 "Moved to trash" / "Deleted permanently"。已
  在临时 vault 上通过 curl 端到端验证：trash list 保留目录结构，restore 避免重名 + prune 空 dir，
  permanent mode 彻底删除 (不保留副本)，empty trash，guard "Not a trash item"，PUT deleteMode 保留
  `vault.path`。Typecheck 2 个 workspace 干净。
- 2026-06-12 (Phase 25q — 根据反馈的 Canvas 外部链接新标签页 + 打开时 zoom-to-fit)：(1) card 中的
  **external link** (`http(s)://`) → node 上 `onClickCapture` `window.open(href,'_blank')` 打开新浏览器
  标签页 (wikilink href="#" 仍回落到 openWikilink)。(2) **打开 canvas 自动 Zoom-to-fit**：移除硬编码
  view reset {60,60,1}；effect `fittedFor` 对每个 canvas 调用一次 `zoomFit()` (data parse + viewport 有尺寸
  后的 rAF)。冒烟测试：2 个相距较远的 node 的 canvas 以 53% 打开 fit 两者；点击 external link → window.open _blank；
  无 console 错误。Typecheck + build 干净。
- 2026-06-12 (Phase 25p — 修复 canvas card 中点击 wikilink)：点击 text card 中的 `[[link]]` 无法
  navigate — 因真实点击有 jitter >1px → lazy `setPointerCapture` (node move) 将 click 重定向离开
  link。修复：在 `beginNodeDrag` 中，若 pointerdown 落在 `[data-wikilink]`/`a` 上则**提前 return** (不
  开始 drag/capture，不 stopPropagation) → 让 click 传到 Preview.onClick → `openWikilink`；viewport
  仍不 pan (target 在 .canvas-node 内)。冒烟测试：真实 CDP 点击 card 中 "NoteA" 链接 →
  导航 `/note/NoteA.md`；无 console 错误。Build 干净。
- 2026-06-12 (Phase 25o — Canvas "Add link" dropdown 如 Obsidian 搜索 note)："Add link" 现在在
  caret 处打开 **note 搜索 dropdown** (复用 notepicker 样式) 而非仅包裹 `[[]]`。保存 caret
  (`linkInsertPos`)，dropdown 打开时 guard `onBlur` (保持 card editing)，选择 note → 在 caret 插入 `[[basename]]`
  然后 refocus；Esc/点击背景 → 关闭 + commit。Search 按 path 过滤；Enter 选择第一项；item
  `onMouseDown preventDefault`。冒烟测试：Add link → dropdown 列出 note (K.canvas/NoteA/Task)；输入 "task"
  → 过滤剩 Task；选择 → 插入 `[[Task]]`；无 console 错误。Build 干净。
- 2026-06-12 (Phase 25n — Canvas text menu：Add link/external 提到顶层)：按 Obsidian，**Add link**
  (`[[…]]`) 和 **Add external link** (`[…](https://)`) 是菜单第 1 级项 (不在 Insert 内) — 已
  移到顶层 + 从 Insert 子菜单移除。冒烟测试：顶层菜单 = Add link/Add external link/—/
  Format/Paragraph/Insert/—/Cut/Copy/Paste/Select all；Add link → `[[word]]`；无 console 错误。Build 干净。
- 2026-06-12 (Phase 25m — 根据反馈让 Canvas resize 更简单)：此前中间边 handle 被**端口连接覆盖**
  (z) 故只能拖动 4 个小角。与 Obsidian 一致：**4 个清晰角 handle** (12px，白底 + accent 边框，z8
  在端口之上) 用于对角 resize + **边拖拽条** (`.canvas-edge-resize` n/s/e/w，inset 距角 12px，
  z6 在端口之下故边中点连接点仍可连接)。修复 resize 不保存 (commit 用了延迟 1 帧的 `dataRef`)
  → 拆出 `resizeRect()` 从 event 坐标计算，在 pointerup 从 event commit (robust)。冒烟测试：选择 node →
  4 角 + 4 边条；拖动角 SE +120/+80 → 240×140 → 360×220，autosave 正确；无 console 错误。Typecheck +
  build 干净。
- 2026-06-12 (Phase 25l — Canvas text-card 菜单层级克隆 Obsidian bundle)：reverse-engineer
  `obsidian.asar` i18n 获取正确的 editor 菜单结构 → 构建**层级**菜单 (`TextFormatMenu`，
  hover 时子菜单向右打开) 匹配 Obsidian：**Format›** (Bold/Italic/Strikethrough/Highlight/Code/
  Math/Comment/—/Clear formatting)，**Paragraph›** (Bullet/Numbered/Task list/—/Heading 1-6/Body/—/Quote)，
  **Insert›** (Add link/Add external link/—/Table/Callout/Code block/Math block/Horizontal rule/Footnote)，
  —，Cut/Copy/Paste/Select all。Helpers：`setLinePrefix` (替换行首 heading/list/quote 前缀)，
  `insertAtCaret`，`clearFormatting`，clipboard execCommand。仍保持 textarea focus (mousedown
  preventDefault)。冒烟测试：右键 card "hello world" → 菜单 3 个子菜单 + clipboard；Paragraph›Heading
  2 → `## hello world`，blur 渲染 `<h2>`，无 console 错误。Typecheck + build 干净。
- 2026-06-12 (Phase 25k — 根据反馈的 Canvas text-card 格式菜单)：右键**正在编辑的 text card 内部**
  → 如 Obsidian 的 markdown 格式菜单：Bold/Italic/Strikethrough/Highlight/Code (包裹 selection
  `**`/`*`/`~~`/`==`/`` ` ``)，Heading/Bullet list/Quote/Checkbox (行首前缀)，Link/Wikilink。菜单
  `onMouseDown=preventDefault` 使 textarea **不 blur** (保持 focus + selection)；`applyFormat` 直接修改
  `textarea.value` (uncontrolled，blur commit)。点击背景 / blur 时关闭菜单。冒烟测试：编辑
  card "hello world"，全选，右键 → 菜单完整 11 项；Bold → `**hello world**`，blur 渲染
  `<strong>`，autosave 正确；无 console 错误。Typecheck + build 干净。
- 2026-06-12 (Phase 25j — 根据反馈的 Canvas 彩色 node 样式 + node 右键菜单)：(1) 带色 node 现在显示
  **node 周围均匀 3px 彩色边框 + 浅色底纹** (`color-mix --c 10%`) 而非左侧竖线 —
  scope `:not(.canvas-group)` 以免覆盖 group。(2) **右键 node → 多功能 context 菜单**
  (用 store `openContextMenu`)：Edit/Open/Open link (按 node 类型)，**Set color** (子菜单 Default+6 色)，
  **Duplicate** (复制 node + 内部 edge，偏移 40px，新 id)，Zoom to selection，**Bring to front/Send to
  back** (改 z-order = 数组顺序)，**Align** (left/center-h/right/top/center-v/bottom — 多选时)，
  Remove。添加 `selRef` (始终最新的 selection) 使菜单回调/handler 操作正确 selection (修复右键
  未选中的 node 时的 stale)。冒烟测试：彩色 node 有 3px 边框 + 底纹；菜单项齐全；Duplicate 2→3
  node，autosave 正确；无 console 错误。Typecheck + build 干净。
- 2026-06-12 (Phase 25i — 按 Obsidian 标准 + 自定义 Canvas color picker)：调色板现在包含 **default
  (灰) + 6 个 preset 色 + 自定义按钮 (彩虹圆环)** 包裹 `<input type=color>` 以选择任意颜色 (将 hex 存入
  `color` — JSON Canvas 支持，Obsidian 可读)。当前选中的 swatch 有 **accent ring** (匹配当前选中
  node/edge 的颜色；hex → 自定义按钮上的 ring)。冒烟测试：打开 palette 见 8 个 swatch + input color，ring 在
  "Color 2" (颜色 2 的 node)；设置自定义 `#1e90ff` → 正确写入 `color:"#1e90ff"`，card 变蓝；无 console
  错误。Typecheck + build 干净。
- 2026-06-12 (Phase 25h — 根据反馈的 Canvas 修复)：(1) canvas 背景白色 (`--background-primary` 替代
  `--background-secondary`)。(2) connector label **去边框** (仅线上的文字，仍保留模糊背景便于阅读)。
  (3) **双击 card 创建新 card 而非编辑的 bug**：原因是 `beginNodeDrag` 在 pointerdown 时立即调用 `setPointerCapture`
  → click/dblclick 被重定向到 `.canvas-view` 故 node `onDoubleClick` (编辑) 不
  运行，背景 handler 创建新 card。修复：**lazy capture** — 仅在第一次真实 move 时
  `setPointerCapture` (mode 'move')，不在 pointerdown 时 capture。保留背景 double-click 在点击点创建 node (如
  Obsidian app)。冒烟测试：double-click card → 编辑，nodeCount 保持 1；double-click 背景 → 创建新 card +
  编辑；label border=none；背景白色；无 console 错误。Typecheck + build 干净。
- 2026-06-12 (Phase 25g — Canvas connect-to-anchor parity，reverse-engineer Obsidian)：用户反馈从 anchor
  拖到其他 node "只显示虚线"。测试确认 edge **仍能**创建，但缺 UX：目标 node
  不显示 anchor + line 不 snap。Reverse-engineer `app.css`：Obsidian 有 canvas
  **`is-connecting`** 状态 → 所有 node 显示 `canvas-node-connection-point`，目标 anchor 发亮。Clone：添加 state
  `connecting` (begin connect/reconnect 时开启) → 拖动时**所有 node 显示 4 个 anchor**；move 计算
  目标 node 的 `nearestSide` → preview line **snap 到**该 anchor + 该 anchor 获得 class `.active` (发亮 +
  glow)；drop 连接到离光标最近的 anchor (connect & reconnect 都用 `nearestSide(over, cursor)`)。移除
  旧的 `reconnectEdge` (inline)。冒烟测试：拖动中有 8 个 anchor (2 node)，B.left `.active`，preview snap；
  释放 → edge `a:right→b:left` 正确 anchor；无 console 错误。Typecheck + build 干净。
- 2026-06-12 (Phase 25f — 根据反馈的 Canvas 双向箭头 + 拖动 endpoint reconnect)：(1) **两端箭头不显示**：
  marker `orient="auto"` 使 `from` 端 arrowhead 转错方向 + 被 node 遮挡 → 改为 `orient="auto-start-reverse"`
  (SVG 双端 line 标准) → bidirectional 显示两端箭头。
  (2) **可拖出箭头端点**如 Obsidian：选中的 edge 显示 2 个 endpoint 圆点 (circle，vector-effect
  non-scaling-stroke)；拖动 endpoint → 放到其他 node = **reconnect** (改 from/to-Node + nearest side)；
  放到空白 = 菜单 **Add card / Add note from vault** 在放置点创建新 node 并连接 (card 立即进入
  edit；note 通过 `pendingConnect` 打开 picker)。实时预览拖拽路径。重构 pointerup connect/
  reconnect 从 event 坐标计算 target (去除对延迟 1 帧的 `connectTo` state 的依赖 → robust)。Menu drop
  在 viewport 内 clamp。冒烟测试：zoom-fit 见两端箭头；拖动 endpoint→Other reconnect (toNode=c)；
  拖到空白→menu→Add card 创建连接 node (4 nodes，edge.toNode=新 node)，autosave 正确；无 console 错误。
  Typecheck + build 干净。
- 2026-06-12 (Phase 25e — Canvas 箭头方向 dropdown 匹配 Obsidian)：箭头方向按钮此前点击
  cycle → 改为**3 选项 dropdown**如 Obsidian：**Nondirectional** (— 无箭头)，
  **Unidirectional** (→ 箭头朝向 `to`)，**Bidirectional** (⇄ 两端)，当前项有 ✓；按钮
  icon 随状态改变。添加 `minus` icon。CSS `.canvas-dir-menu/.canvas-dir-item`。冒烟测试：选择
  edge → 打开 dropdown 见 3 项 + ✓ Unidirectional；选择 Bidirectional → 2 个 marker arrow，dropdown 关闭，
  autosave `fromEnd/toEnd=arrow`；无 console 错误。Typecheck + build 干净。
- 2026-06-12 (Phase 25d — 根据反馈的 Canvas edge label/menu 修复)：(1) **label 位于线的正中**：
  此前用 Bézier t=0.5 (偏斜) → 改为**按弧长的中点** (`bezierArcMidpoint`，采样 24
  段，走一半弧长)；foreignObject 200×32 + wrapper flex center → chip 位于曲线正中央
  (验证 distToLine=0)。(2) edge 有 label 时在 edge menu 中添加 **Remove label (X)** 按钮 (匹配
  Obsidian：trash·palette·zoom·⇄·X·pencil)。(3) 箭头方向按钮改为 icon **⇄ (arrow-left-right)**；toggle
  产生两端箭头 (验证 marker-start+end)。点击 label = 选中 edge，double-click = 编辑。冒烟测试：
  label center=0px 偏斜，direction→bidirectional，remove label 隐藏按钮 + 清除 label，autosave 正确，无
  console 错误。Typecheck + build 干净。
- 2026-06-12 (Phase 25c — 根据要求深入 Canvas parity，reverse-engineer Obsidian app)：extract
  `obsidian.asar` (`app.css`/`i18n.js`) 获取正确的 Canvas 菜单词汇 (`actionRemove`/`actionSetColor`/
  `actionZoomToSelection`/`actionEditLabel`/arrow ends `none|arrow`) + 确认 6 个 preset 色 = red/orange/
  yellow/green/cyan/purple (已匹配)。**(1) Obsidian 风格 Selection 菜单**浮动在 selection 上，对
  node 和 **edge** 均生效 (此前 edge 无删除按钮 → "无法删除 connector")：Remove、Set color (palette 打开
  swatch 行)、Zoom to selection；edge 额外有 **Arrow direction** (cycle toEnd→both→fromEnd→none) 和
  **Edit label**。菜单位置从 selection bbox 计算，包含 edge 的 endpoint。**(2) Undo/redo**：stack
  serialized (≤200)，`commit` 压入 history + 清除 redo；`undo`/`redo` + 键 **⌘Z/⌘⇧Z/⌘Y**，zoom
  栏中的 ↶↷ 按钮 (为空时 disabled)，切换文件时清除。将 icon `palette`+`zoom-in` (Lucide) 加入 Icon.tsx。
  冒烟测试：选择 edge → 菜单项齐全；Remove 删除 edge，Undo 恢复，Redo 再删；无 console 错误。
  Typecheck + build web 干净。
- 2026-06-12 (Phase 25b — 根据用户反馈的 Canvas UX)：(1) 中下方的 **add** 栏如 Obsidian，
  有 3 个按钮 **Add card / Add card from note / Add image** (与左下 zoom 组分开)。"Add card from
  note" 打开搜索弹窗列出 vault 文件 (note + 图片) → 在 view 中心插入 file node；"Add image" 打开文件
  dialog → `api.upload` → 插入 image node。(2) **拖动背景以 pan viewport** (此前须按住 Space)：拖动
  空白背景 = pan，**Shift+拖动** = marquee 多选，点击背景 (非拖动) = 取消选择；cursor `grab`/`grabbing`。
  `setPointerCapture` 包裹 try/catch (对 synthetic/inactive pointer robust)。浏览器冒烟测试：pan 改变
  transform 正确 delta，Add note 插入 embed，Add image 渲染 image node，autosave 写入完整 text+2 file node，
  无 console 错误。Typecheck + build web 干净。
- 2026-06-12 (Phase 25 — Canvas FR-12，clone Obsidian Canvas)：添加 `web/src/lib/canvas.ts` (读写
  开放格式 **JSON Canvas** `.canvas`，tab-indent 如 Obsidian，安全 parse 为 `{nodes:[],edges:[]}`，
  6 色 preset，按 side + auto-side + nearest-side 的 edge Bézier 几何，bbox/fit) 和
  `web/src/components/CanvasView.tsx` (~620 行)：无限画布 pan/zoom (wheel 以光标为中心缩放，拖动背景/
  space+drag pan)，点状网格随 zoom 缩放；nodes 在 transform layer 中 DOM 绝对定位，edges 用 SVG 绘制 (下层)
  曲线 + 箭头 `marker`；node **text** (Preview markdown / textarea 编辑)、**file** (note=Preview
  embed，图片=`<img>`)、**link** (card)、**group** (最后方的模糊背景)；double-click 背景 / + 按钮创建 card，drag
  移动组，8 个 resize handle，4 个边点拖动创建 edge，double-click edge 编辑 label，marquee + Shift 多
  选，浮动颜色/删除工具栏，Delete/Backspace 删除。通过 store `content`/`save` 自动保存防抖 900ms
  (`.canvas` 已在 `TEXT_RE` 中)，不添加 API。接入 `Workspace` 为 `.canvas` 渲染 CanvasView；store
  `newCanvas`；"New canvas" 加入 FileTree 上下文菜单 (file/folder/vault root) + command palette。CSS
  `.canvas-*` 在 obsidian.css 中。Typecheck + build web 干净；浏览器冒烟测试 (临时 vault)：渲染
  group/箭头 edge/label/embed note 正确，zoom-to-fit，创建 card + 改色，autosave 写入正确 JSON Canvas
  round-trip (保留旧 node/edge)，无 console 错误。PRD 升到 1.0 + FR-12。
- 2026-06-12 (安全加固 — 全仓库审计)：git 中无泄露 secret (history + tracked
  files 干净；`data/`/`.env`/`.claude/skills/` gitignored)。修复 9 处：**(1)** 仍在
  使用默认 `123456` 时强制改密 — `/auth/login`+`/me`+`/status` 返回 `mustChangePassword`，web 用
  `ForceChangePassword` 阻止 (仍绑定 0.0.0.0)。**(2)** 从所有返回 client 的 error + log 中
  redact git PAT (`https://<token>@…`) (`lib/redact.ts`，用于 `errorHandler`、`git.ts` sync/autosync)。
  **(3)** `helmet` + CSP (script-src 'self'+nonce；**不**含 `upgrade-insecure-requests` 以保持 HTTP
  self-host；为 `/share` 页面 inline script 提供 nonce)。**(4)** rate-limit `/auth/login` 10 次/15
  分钟/IP (`middleware/ratelimit.ts`)。**(5/6)** 在 install 时校验 plugin `id` (`^[a-zA-Z0-9._-]+$`) (remote
  manifest.id) + serve asset → 防止读写 path traversal。**(7)** `/ws` 在 upgrade 步骤要求 cookie
  auth。**(8)** `resolveInVault` 阻止 `.git` segment (通过 hooks 的 RCE) + realpath guard
  防止 symlink 逃逸 vault。**(9)** 通过 API 改 `vault.path` 必须位于 allowedRoots + 是存在的
  文件夹。Typecheck + build 干净；冒烟测试验证全部。PRD §安全已更新。
- 2026-06-12 (Phase 24 — 文件树上下文菜单中的 Copy/Cut/Paste 文件 & 文件夹)：store 添加
  `clipboard {path, mode}` + `setClipboard` (session-local)。FileTree：`doClipboard('copy'|'cut')`
  设置 clipboard + toast；`doPaste` 粘贴到目标文件夹 — Cut = `api.rename` (移动，支持 folder，
  阻止粘贴到其自身/子目录，粘贴到原处 = no-op)，Copy = `api.copy` 递归并用 `uniqueChildName`
  避免重名。文件菜单：Copy/Cut/Paste；文件夹菜单：Copy/Cut/Paste。被 Cut 的行变淡，Paste 仅
  在有 clipboard 时显示。Server：`vault.copy` (`fs.cp` recursive 返回创建的文件列表) + 路由
  `POST /api/files/copy` (reindex 新 `.md`，auto-commit)；client `api.copy`。PRD 0.9 (FR-1 + API row)。
  补充 (M24.4)：右键文件树空白区域弹出 app 菜单 (New note/New folder/Paste 到 vault root)
  而非浏览器原生菜单。Typecheck server + web 干净。
- 2026-06-12 (New folder 不 prompt + 目录树内 inline rename)：store action
  `newFolder(dir?)` 直接创建文件夹 "Untitled" (重名时自动递增 "Untitled 1/2…")，展开
  ancestor + 打开 Files 面板然后设置 `renamingPath` = 新 path。FileTree 添加组件
  `RenameInput` (accent 边框 input 框替代 `.name`)：autofocus + 预选名称部分 (保留
  文件扩展名)，Enter/blur → `api.rename`，Escape → 取消；stopPropagation 使 click/pointerdown
  不 toggle/打开行。Store 添加 state `renamingPath` + `setRenamingPath`。菜单 "New folder"
  (FileTree) 和 New folder 按钮 (Sidebar) 调用 `newFolder()`，移除 `prompt('Folder name')`。顺带
  将 file/folder 的 "Rename…" 改为 inline rename (去掉 prompt path)；保留 "Move to…" 用于
  更改目录。CSS `.tree-rename`。Typecheck + build web 干净。
- 2026-06-12 (New note 不 prompt + tab-bar 控件不被 scrollbar 遮挡)：(1) 添加 store action
  `newNote(dir?)` 直接创建笔记 "Untitled.md" (目标文件夹内重名时自动递增 "Untitled 1/2…")，
  body 为空 → inline-title 如 Obsidian 显示文件名，不再 `prompt('Note name')`。
  替换所有调用点：⌘N (App.tsx)、Command palette、tab-bar "+"、Sidebar Files header、上下文菜单
  FileTree (文件夹内 New note → `newNote(node.path)`)、FolderView header。为 New
  folder 保留 prompt，点击不存在的 wikilink 时按名称 auto-create。(2) Tab-bar：将标签列表包
  在 `.tab-scroll` 中 (overflow-x:auto，用 `scrollbar-width:none` 隐藏 scrollbar)，控制按钮
  (左/右切换、"+" new note) 加 class `tab-ctl` flex-shrink:0 位于滚动区外 → 不
  被 scrollbar 吞掉高度或在多标签时滚走。Typecheck web 干净。
- 2026-06-12 (Phase 23 — Render HTML block)：从 Trilium 导入的 note 包含 ` ```html ` fence 中的
  完整 HTML 页面 (SingleFile)。要求添加 render block 按钮。首次误改了 `Preview.tsx` (该组件
  现在**仅**用于 share 页面 — 真正的 Reading mode 是 CodeMirror editor readonly，M18.14)。正确修复：
  将 `htmlPreviewField` (StateField widget) 加入 `livePreview.ts` + 在 `Editor.tsx` 注册。将按钮
  放在 block 顶部 (side:-1)，因为 CodeMirror 虚拟化 DOM — 巨大 block 之后的按钮会在 viewport 外。iframe
  sandbox `allow-scripts` 非 same-origin (隔离)。为 `/share` 在 `Preview.tsx` 中保留按钮。用 chrome-devtools
  端到端验证 (login pw 123456)：按钮显示，点击 → iframe 正确渲染页面。Build 干净。
- 2026-06-12 (Folder deep-link → Folder view)：打开指向 folder 的 URL (`/note/<folder>`) 此前被
  渲染为以 folder 命名的空 note (Editor)。添加 `lib/tree.ts` (`findNode`/`isFolderPath`) + 组件
  `FolderView.tsx` 列出 folder 内容 (子 folder + note，folder 优先排序；图片缩略图；可拖放；
  + 按钮在 folder 内创建 note)。`store.openFile` 通过 tree 检测 folder → 跳过 `api.read` 并
  不加入 Recent。Workspace 在 `isFolderPath(tree, activePath)` 时渲染 FolderView，隐藏 ⋯ 按钮
  (文件菜单不适用于 folder)。Typecheck + build 干净。
- 2026-06-12 (Phase 22 — Move file to… + Bookmarks/Recent 上下文菜单)：功能 "Move file to…"
  此前是手输 path 的 `prompt()` — 改为 Obsidian 风格的 folder-picker 模态框
  (`FolderPicker.tsx`，在 App 中与 ContextMenu 并排 mount)：输入筛选 folder，↑↓ 选择，↵ move，⇧↵ 按输入名
  创建新 folder 后 move (vault.rename 自动创建父目录)，esc 关闭。State 通过 `store.movePath`/
  `setMovePath` (不 persist)。⋯ 菜单 (Workspace) 和文件树右键菜单 (FileTree) 现在只
  调用 `setMovePath(path)`。Bookmarks/Recent 面板 (`BookmarksPanel.tsx`) 添加 `onContextMenu` →
  `openContextMenu` (此前 right-click 落入浏览器原生菜单)：Open/Open to right/
  Reveal/Move file to…/Bookmark/Copy path；Recent 还添加 "Remove from recent" (`store.removeRecent`)。
  补充：Bookmark/Recent 行 `draggable` (拖入文件树 folder 以 move，共用 payload
  `text/wo-path`) + 每行 hover 按钮 (📁 Move / ✕ Remove)。Typecheck + build web 干净。
- 2026-06-12 (Copy path → Copy URL path)：文件右键菜单 (FileTree)、⋯ 菜单 (Workspace) 和
  Bookmarks/Recent 面板将 "Copy path" 改为 "Copy URL path"，复制完整 deep-link
  `${location.origin}${pathToUrl(path)}` (如 `http://localhost:8787/note/...`) 而非 vault path。
  文件夹右键菜单仍保留 "Copy path" (folder 无 note URL)。Typecheck + build 干净。
- 2026-06-12 (为 "Rebuild search index" 添加 Toast)：reindex 命令 (~12s，含 6000+ note 的 vault) 此前
  静默运行，UI 无反馈。`notify()` (store.ts) 添加参数 `ms` (默认 2500，`0` =
  保留至被替换)。CommandPalette：开始时显示 "Rebuilding search index…" (persistent)，
  完成时改为 "Search index rebuilt" (或出错时 "Failed to rebuild…")。Typecheck + build
  web 干净；输出到 server/public 故只需 reload，不重启 server。
- 2026-06-11 (修复 Browse vault 时的 "Path outside allowed roots")：folder browser
  (`/api/settings/browse`) 只允许在 `vault.allowedRoots` 内活动，但 roots 默认从
  `sample-vault` 推导，故其外的 vault (如 `~/ObsidianVault-Trilium`) 被 403。根因修复：添加
  `ensureVaultBrowsable()` (services/settings.ts)，当 vault 父目录未被覆盖时自动将其加入 `allowedRoots`
  — 在保存 vault path (routes/settings.ts) 时调用，并在 `loadSettings`
  时回填以修复旧文件。已 rebuild + restart server，settings 自动修复 (`allowedRoots` 添加 `/Users/xnohat`)。
- 2026-06-11 (修复 search 返回 0 结果)：server/data/qmd-index.json 被持久化为空
  (`documentCount: 0`，可能因 build 在不可读的临时 vault 时运行)。`QmdEngine.restore()`
  加载该空 index 后设置 `ready=true` → 所有查询返回 0 且永不 rebuild。修复：`restore()`
  将 0-doc index 视为 cache miss (`return false`) 使 `initSearch()` 从 vault 重建。已 live reindex
  (6048 docs)。Typecheck server 干净。
- 2026-06-11 (M2.5 — 修改密码 + 默认密码 + override)：新 auth 模型。登录密码
  默认 `123456` (无需 setup 步骤)；已修改的密码存于 `auth.userPasswordHash` (空 = 默
  认)。`auth.passwordHash` (settings.json，手动编辑) 和 env `WEBOBSIDIAN_PASSWORD` 现在是恢复用
  override 密码，login 始终接受。Server：`checkPassword` 检查有效密码 + 2 个
  override 来源 (`auth.ts`)；endpoint `POST /auth/change-password` (requireAuth，验证旧密码)；bootstrap
  不再 seed 密码；`redactSettings` 返回 `hasCustomPassword`/`hasOverridePassword`。`loadSettings`
  中的迁移：旧文件有 `passwordHash` → 转为 `userPasswordHash` (避免 123456 后门)，
  重新持久化。Web：`api.changePassword`，Settings→Account 标签页改密表单 + 警告正在使用默认
  密码。Typecheck 2 个 workspace 干净。PRD FR-3 + data model 已更新。
- 2026-06-11 (M19.7 — 移动端对齐第 2 轮)：修补 3 个用户报告的移动端 bug。(1) note 的 "…" 菜单被
  屏幕底部裁剪：`ContextMenu.tsx` clamp `x/y ≥ 8px` + 按 viewport 估算高度限制 (不再
  出现负 top)，移动端 CSS 为 `.context-menu` 添加 `max-height: 100dvh; overflow-y:auto` (桌面 hover
  子菜单不受影响因 media query) + 行 9px 便于触摸。(2) note 内容可横向拖动
  (pan/布局偏移)：锁定 `.cm-host`/`.markdown-preview` 上的 `overflow-x:hidden` + `max-width:100vw`，
  文字换行 `overflow-wrap:anywhere`，图片 `max-width:100%`，表格 `display:block; overflow-x:auto`，code
  内部滚动；`.prop-key` min-width 92px + prop-row wrap。(3) Settings & Version history 模态框溢出
  右边缘：`position:fixed; inset:0` 全屏，settings-nav 变为横向滚动条，`.setting-row`
  纵向堆叠 + input 全宽 (覆盖 inline width 260/120)，version-history 列表置于 preview 之上，
  share 对话框全宽；nav/head 的 safe-area top。Build web 干净 (7.4s)。
- 2026-06-11 (描述性 Commit message)：vault 自动提交生成明确说明哪些 note 改变的标题而非
  泛泛的 "WebObsidian auto-sync"。`describeChanges(StatusResult)` 按 Added/Modified/
  Deleted/Renamed 归集文件 → 单行 subject (`Add <note>` / `Sync N notes (3 new, 2 edited): a, b, c +X more`)
  + body 逐条列出 path (cap 100)。`commitAll()` 在无手动 message 时用自动生成的 subject；
  移除 autosync/auto-commit-on-save/Commit 按钮中的通用 message。服务 Version History UI。
- 2026-06-11 (Phase 21 — Pane ⋯ 菜单 parity)：添加 note 右上角 3 点菜单功能以匹配
  Obsidian app (根据用户要求)。新增：note 中的 **Find/Replace** (`@codemirror/search`，
  panel top，item "Find…" → `editorFind()`)；**Reveal file in navigation** (`store.revealInTree`
  展开祖先 folder + scrollIntoView + flash，FileTree 监听 `wo-reveal-file`，row 有 `data-path`)；
  **Add file property** (将空 key 插入 frontmatter YAML，尚无时创建 block)；**Export to PDF**
  (Reading view → `window.print()` + CSS `@media print` 仅打印 note 内容)；**Open version history**
  (server `git.log`/`git.showFile` + 路由 `/api/git/log|/show`，模态框 `VersionHistory.tsx` 列出
  commit + preview + Restore)；**Open in new window** (`window.open(/note/<path>)`)；**Backlinks in
  document** + **Open linked view** 子菜单 (→ `setRightPanel`)。菜单按 Obsidian Desktop
  的分组顺序重建。跳过 "Reveal in Finder"/"Open in default app" (仅桌面，不适合 web)。
  Typecheck 2 个 workspace 干净。PRD bump 0.6 (FR-2/FR-4)。
- 2026-06-11 (面向开源 self-host 的部署加固)：审查部署到干净 VPS 时的断点
  (实际部署到 Synology NAS 时遇到)。(1) `docker-compose.yml` 硬编码 `./sample-vault`
  + port → 自托管者须修改 tracked 文件，且每次重新部署都被覆盖。修复：改为
  `${VAULT_HOST_PATH:-./sample-vault}` / `${HTTP_BIND}:${HTTP_PORT}` / `${WEBOBSIDIAN_WATCH}`，参数
  放在 `.env` (git-ignored) → 重新部署不丢配置。(2) Watcher `ENOSPC`：干净 VPS
  `fs.inotify.max_user_watches=8192` < 大型 vault 文件数 → native watch 死亡。修复：拆出 `startWatcher()`，
  添加 `.on('error')`，遇到 `ENOSPC/EMFILE` 时自动 `close()` + 以 `usePolling` 模式重启，log 指引
  提升 sysctl；env `WEBOBSIDIAN_WATCH=polling` 从头强制 polling。(3) `.env.example` 按
  真实 docker 流程重写。(4) 为大型 vault 首次索引设置 healthcheck `start_period=90s`。README 添加
  "Deploy to a VPS" 章节 + sysctl 命令。PRD ↑0.6，FR-9 扩展。typecheck server pass。
- 2026-06-15 (Git Sync 修复 — `index.lock` 卡死 / "彻底失效")：Git Sync 彻底死亡 → log 循环
  `fatal: Unable to create '/vault/.git/index.lock': File exists`。Root cause：**3 个来源在
  **同一 repo 上并发运行 git，未协调**：autosync tick (30s)、debounced commit-on-save (保存后 5s)，
  以及手动 `/api/git/*` route。每次 `git()` 创建**新的 simple-git 实例**故 per-instance task-queue
  无法跨实例串行化 → 2 个 `git add .` 在 `.git/index.lock` 上冲突；1 条命令在中途被 kill/
  crash 留下 **stale lock** → 之后所有 op 永久死亡。修复 (server/src/services/git.ts)：
  (1) **`withGitLock`** — 1 个全局 async queue，所有写 op (status/pull/push/commitAll/init/clone/sync)
  都经过它，永不重叠；失败的 op 不"毒化" queue。将 public 函数 (包裹锁) 与 `*Impl`
  (在锁内运行，彼此直接调用以避免 deadlock) 分离。(2) 每个 op 开头的 **`clearStaleLocks`** — 删除
  `index.lock`/`HEAD.lock`/`config.lock` 若 mtime 早 ≥15s (足够宽以免抢到外部正在运行的 Obsidian-git
  的锁，足够快以在 crash 后自愈)。(3) 为 simple-git 设置 **`timeout.block: 120s`** 使死掉的网络 op
  不永久挂起 queue。Prod (Synology)：找到 0 字节的 `index.lock`，mtime 早 ~10h →
  删除 → `git status` 重新运行 → `/api/git/sync` = `{ok:true, [Committed, Pulled, Pushed]}`。部署
  该修复以防复发。Typecheck 2 个 workspace 干净。
- 2026-06-11 (Git Sync 修复 — `spawn EBADF`)："Git Sync 无法运行" 的 bug → 错误 `spawn EBADF`。Root
  cause 不在 git：**chokidar v4** 在 macOS 上通过 kqueue 逐文件 watch → 持有**1 fd/文件**，vault
  ~11k 文件使进程打开 ~11k fd；当 `simple-git` spawn `git` 时，libuv 耗尽 fd 构建 stdio pipe →
  `spawn EBADF` (repro：持有 11k fd 后 spawn = 正是该错误)。修复：降级到 **chokidar ^3.6.0** (mac 上 FSEvents
  = 整树 1 fd；Linux/Docker 上 per-dir inotify) → fd 从 11.003 → ~20。向 `pull()` 添加 `--allow-unrelated-
  histories` (本地 init 的 vault vs 已有 commit 的 remote)。在 routes + autosync 中记录 `[git]` log
  (供监控)。UI：log `<pre>` → **可滚动、累积、带 timestamp + Clear 的 textarea** (Settings ▸ GitHub Sync)；
  左侧 Ribbon 上的 **Sync now** 按钮 (仅启用 git sync 时显示，sync 时 icon 旋转，出错 → notify)。
  一次性 reconcile vault↔obsvault.git (分离历史)：无数据丢失的 union (`merge -s ours
  --allow-unrelated-histories` 连接历史 + restore 2,646 个仅 remote 的文件，冲突时 local 胜)。
  验证：`/api/git/sync` → `{ok:true, [Committed, Pulled, Pushed]}`，HEAD==origin/main，两侧 0 文件丢失。
  在 vault 中备份 refs `backup/pre-union-{local,remote}` (放心后可删除)。
- 2026-06-11 (Phase 19 — Mobile UI)：为触摸智能手机做移动友好 (参考 Obsidian
  Mobile)。`useIsMobile` (matchMedia 768px) + 本地 state `mobileDrawer` (不 persist/broadcast →
  不影响 desktop uistate 同步)。CSS `@media ≤768px`：workspace 全宽，ribbon+左侧边栏和
  ight sidebar 成为滑动 overlay drawer (translateX) + 模糊 backdrop；tab-bar 上的 hamburger (☰) +
  左/右边缘 edge-swipe 打开/关闭 drawer；打开 note 时自动关闭 drawer；触摸目标 ≥36–44px；隐藏
  crumbs+split 使 view-header 不溢出；status bar 隐藏让位给工具栏。Format 工具栏 `FormatToolbar`
  通过 `lib/activeEditor` (singleton EditorView) 共用：14 个按钮 bold/italic/heading/list/checklist/
  quote/link/[[ /code/tag/indent/outdent/undo/redo。根据用户反馈：**桌面端也启用**
  (view-header 下方的 in-flow 栏)；移动端通过 visualViewport 锚定在键盘上方。Viewport
  `viewport-fit=cover` + `interactive-widget=resizes-content` + safe-area insets。验证 Chrome
  390×844：左/右 drawer 滑动+backdrop，hamburger，工具栏 Bold 写入 `**` + Undo 恢复，Reading
  隐藏工具栏；桌面 1440 无 regression + 工具栏 Bold/Undo OK。typecheck + build web 干净。
- 2026-06-11 (第 5 批)：根据要求改变 Reading mode 架构 — Reading = Live Preview editor
  readonly (单一 renderer)，附带 callout fold chevron + code 语法高亮 (CM grammar)
  用于剩余的 Preview pipeline。验证：reading 是 .cm-editor contenteditable=false，callout/
  checkbox/fold/code/math/footnote/HTML 渲染与 Live 完全一致。
- 2026-06-11 (第 4 批)：Reading mode 与 Live 对齐 — 共用 callout constants、KaTeX +
  mermaid + highlight + tag pill + comment strip + breaks:true + Reading 中的 callout fold。
  用 node repro 调试 sanitize：a.className 被 defaultSchema 限制值 → filter entry。
  验证 Reading：4 tag pill，2 mark，8 internal-link，3 katex，1 mermaid svg，1 折叠 callout，
  17 callout icon。
- 2026-06-11 (第 3 批)：修复 4 个编辑器 bug (HTML table、inline footnote、code block padding +
  indented code guide、embed note title/空白) + Reading mode 与 Live 同步
  (task 自定义状态、bullet、properties pill)。用截图验证两种模式。
- 2026-06-11：Phase 18 第 2 批 — 修复用户将 "Markdown Test" note 与 Obsidian app 并排对照时
  报告的 11 个渲染 bug (M18.10)：独立 highlight style 消除 escape 红色；真正的 embed note
  transclusion + box "could not be found"；indent guides；多层 quote 竖线；callout
  中的 checkbox；callout fold +/- 工作 (默认用 - 折叠，用 chevron toggle)；code block
  Obsidian 调色板颜色 + 语言标签；display math $$ 渲染 (KaTeX)；HR 去除多余 margin；
  inline-HTML 行 + mermaid 真正渲染 (lazy)；block comment %% 整块变灰。添加 deps：
  katex、mermaid、@codemirror/language-data (均为独立 lazy-load chunk)。用 Chrome 在真实 vault 上
  逐项截图验证；typecheck + build 干净。
- 2026-06-10：Phase 18 — 按 docs/obsidian-desktop-internals.md 复制 Obsidian Desktop markdown editor。
  CSS token verbatim (accent HSL + ramp + heading sizes + bold-modifier 200 + callout RGB slots)；
  标准 DOM class HyperMD-*/cm-*；LP 添加 highlight/comment/math(KaTeX)/footref/blockid/HR/
  隐藏 fence + escape；callout 完整 14 色 slot + lucide icon + 默认标题；wikilink 规则 §7
  (alias | 开头，NBSP+NFC，图片 size param，label 原始 Note#Head)；tag 标准 unicode 字符集；
  快捷键 §4 (Mod+B/I/K/L/D, Mod+/, Mod+E, Alt+Enter, list continuation)；suggester [[ + #
  以完整移植 §9 公式的 fuzzy scoring；行距对照真实 app.css
  (heading padding-top --p-spacing，inline-title 0.5em)。用 Chrome 在真实 vault 上与 Obsidian app
  并排验证：heading/highlight/tag pill/callout/task/code/footnote/math/suggester 匹配；
  typecheck + build 干净；测试 note 已删除。
- 2026-06-03：初始化 PRD.md、IMPLEMENTATION_PLAN.md、CLAUDE.md。
- 2026-06-03：完成 Phase 0–10。Backend (auth、vault、QMD search、links/graph、git+LFS、
  API gate、plugins) + 仿 Obsidian 前端 (ribbon/sidebar/tabs/editor/reading/search/
  backlinks/outline/graph/settings/command-palette)。Build web+server 干净，typecheck pass。
- 2026-06-03：Smoke test pass — login、file tree、full-text + fielded search、backlinks、
  tags、agent API (list/read/write/append/search，401 no-key，403 wrong scope)、SPA served、
  git status (LFS available)。截图 UI 确认 editor + reading view + callout +
  properties + wikilinks 渲染正确。
- 2026-06-04：Phase 12 — Live Preview WYSIWYG、embeds/transclusion、context menu、drag&drop +
  paste image、quick switcher + hotkeys、bookmarks/recent/daily note、split pane、
  git auto-commit-on-save、code-split bundle。
- 2026-06-04：Phase 13 — 根据反馈大改 UI：扁平 Lucide 图标集替代 emoji，默认 Light
  theme，文件树仅 chevron，vault footer，状态栏在右下，"Linked mentions"。截图
  对照真实 Obsidian 图：editor light + properties block + linked mentions 匹配。
- 2026-06-04：按 Obsidian 风格解析 attachment/图片：添加全 vault 文件索引 (basename→path，
  shortest-path)；path 不匹配时 /content route 按 basename fallback。图片按协议通用 —
  浏览器可加载的 URL (http(s)/data/blob/file) 直接加载，其余 (相对 path
  或任何 scheme) 通过文件索引按 basename 解析。适用于 Live preview 和 Reading。
  验证：图片内联显示 (naturalWidth>0)。Watcher 在 add/unlink 时更新索引。
- 2026-06-04：解决大型 vault (5.9k note) 上的 OOM：build index 不保留整个 doc，cap body
  100k，debounce link-graph + loadTree，NODE_OPTIONS=--max-old-space-size=4096 (Dockerfile)。
- 2026-06-04：Live Preview 渲染缺失的标准 Markdown：link `[text](url)` (隐藏 URL，点击打开
  external/internal)，图片 `![alt](url)` (http/relative → <img>，奇怪 scheme 如 trilium-att:// →
  placeholder "🖼 名称")，带空格的 URL。为 replace decoration 添加 overlap-guard (防 crash)。
- 2026-06-04：重写 Graph view：canvas 2D + d3-force (Barnes-Hut)，pan/zoom，仅 hover/zoom 时显示
  label，点击打开 note，默认隐藏 orphan (689/5929 node 有链接) + toggle。不再卡顿。修复布局
  全高 (theme wrapper) + 状态栏锚定到 workspace 底部 (不覆盖 right sidebar)。
- 2026-06-04：将 WebObsidian 指向真实 Obsidian vault `/Users/xnohat/ObsidianVault-Trilium`
  (5928 md，27k files，5.5GB)。在树中隐藏 dotfiles，folder 默认折叠，光标初始化
  在 frontmatter 之后，Properties 将 YAML list 渲染为 pill。截图匹配真实 Obsidian 图。
- 2026-06-04：Phase 14 — 将 Live Preview 重写为真正的 WYSIWYG (heading/bold/italic/code/tag/
  callout 渲染，隐藏 syntax，仅在光标处显示 token；修复 light 上的 oneDark bug)。添加
  editor 右键菜单 (Format/Paragraph/Insert submenu + clipboard + search)，扩展 file tree 菜单，
  reading view 菜单。截图确认：光标本在别的段落时 bold 渲染加粗，Format 子菜单显示正确。
- 2026-06-04：修复 Markdown 渲染偏离 Obsidian：(1) Obsidian/wikilink/embed 语法位于 inline
  code/code block 中 (如 `` `![[file]]` ``) 被变成 link — 现在在 Live (当 syntaxTree 匹配 InlineCode/FencedCode/CodeBlock node 时 skip regex)
  和 Reading (preprocess 前 stash code span，之后 restore) 中均保持字面量。(2) Markdown 表格未在 Live 渲染 — 添加 scanTables + TableWidget 通过
  StateField `tableField` (像 frontmatter 一样的 block widget)，在 cell 内 inline 渲染 (code/bold/italic/
  link)，光标在表格内时显示 raw；plugin 跳过已渲染表格的行以避免重叠 decoration。
  验证：typecheck + build 干净，scanTables 正确识别 README 表 (header Type/Count，10 行)。
- 2026-06-05：Live Preview 更多匹配 Obsidian：(1) external link http(s) 有 ↗ icon (SVG lucide) +
  下划线；internal link/wikilink 下划线；link widget `inline-block` 使 `]]` 后的文字仍能
  如 Obsidian 般换行。(2) List：折叠 marker 后多余空白 (`-   Item`→`• Item`，
  `1.  x`→`1. x`)。(3) Blockquote 用 normal 文字色 (此前为 muted)。(4) 渲染原始 HTML block
  (CKEditor/Trilium `<table>`) 通过 StateField `htmlBlockField` + sanitize (移除 script/on*/js: URL)，
  点击 HTML 中的 link 打开 external/internal；plugin 跳过已渲染 HTML block 中的行。用
  Chrome DevTools 在真实 vault 验证：↗ icon + link 下划线，list 1-space，blockquote 加粗文字，HTML 表
  "Điểm Mạnh/Điểm Yếu" 渲染含 bullet + tiktok/Google link。注意：同 vault 上打开的 Obsidian app 自行将若干 HTML 表
  转换为 markdown 并在 session 中删除 scratch 文件 — 不是 WebObsidian 所为
  (server 原样读/写，code 仅添加 decoration)。
- 2026-06-05：根据反馈微调：(1) markdown 表格将 cell 内 `<br>` 渲染为换行
  (appendInline 添加 token `<br>`)，header 左对齐 + valign top + 按 Obsidian table CSS vars
  样式 (Live 和 Reading 均适用)。(2) Blockquote：左侧紫色边框 `--interactive-accent` + padding-left 24px；
  用专门 selector `.cm-line.cm-blockquote` 修复被 CodeMirror `.cm-line` 覆盖的 padding bug
  (类似 `.cm-callout`) → 文字不再贴边。Chrome DevTools 验证：cell 中 br=3，th
  左对齐，blockquote border rgb(120,82,238) + padding 24px。须重启 server 2 次 (minisearch
  vacuuming crash + reload 时 reindex 的 OOM) — 既有 bug，与本次改动无关。
- 2026-06-05：Obsidian 风格交互式 Table editor (重写 TableWidget)。Cell click-to-edit
  (contenteditable 嵌套在 widget 中，focus 显示 raw，blur/Enter commit；Escape 取消)，每个操作
  re-serialize model → replace 源 range → tableField rebuild (DOM 始终同步)。Hover 显示 +column (右侧) /
  +row (底部) 按钮。右键 cell 打开格式菜单 (通过
  setLivePreviewMenuHandler 注入 store 的 openContextMenu)：insert column 左/右，insert row 上/下，move column/row，align
  column left/center/right (子菜单)，delete column/row。表格现在**始终**渲染 widget (移除选中时的 reveal-raw) 如
  Obsidian — 通过 cell 改内容，通过 Source mode 改 raw。用 Chrome DevTools 在
  note "Test Table" 上验证：编辑 cell 正确写出 GFM 到文件，+column 4→5，context menu 项齐全，delete column 5→4。
- 2026-06-05：Obsidian 风格 Inline title (note 名称) 显示在 Live 中 note body 顶部 (block widget `inlineTitleField`
  在 pos 0，title 由 Editor 通过 `setNoteTitle` 注入) 和 Reading (Preview prepend `.inline-title`)。Dedup：
  若 note 以 `# <名称>` 开头且与 title 相同则跳过 (Trilium note 将标题重复为 heading) → 不显示 2
  次。验证："Test Table" (无 heading) 显示 title；"Trilium System Notes" (有 `# Trilium System Notes`)
  不显示 inline title (只剩 heading)。
- 2026-06-05：Obsidian 风格交互式 Property editor (重写 FrontmatterWidget)。Header "Properties"，
  每个 prop：按类型设 icon (text=T / list=≣ / date=🗓 / number=# / checkbox=☑)，key + value
  contenteditable (Enter/blur commit)，list (tags/aliases/[...]) 显示带 × 删除按钮 + "+" 添加
  item 的 pill，hover 时 × 删除 prop 按钮，"+ Add property"。每个操作 parse→serialize YAML→replace block
  frontmatter [0,blockEnd]。Frontmatter 现在**始终**渲染 widget (移除 reveal-raw) 如 Obsidian。value 含特殊字符时
  YAML 加引号。用 Chrome DevTools 验证：README 显示正确的 title/created icon，Add
  property 将 `property:` 写入文件后干净删除，Trilium System Notes 将 aliases 显示为 pill + add。
- 2026-06-05：Obsidian 风格 Property name suggester (dropdown) 用于 Add property。Server：QmdEngine
  收集全 vault 的 frontmatter key→type (`propMeta` map，随 index persist/restore)，endpoint
  `GET /api/properties` 返回 {key,type,count} 按 count 排序；`inferPropType` 分类
  text/list/number/checkbox/date/datetime，core props (tags/aliases/cssclasses) 始终 = list 且始终
  在建议中。Web：`api.properties()` + 注入 `setLivePreviewPropertyProvider`；"+ Add property" 按钮
  打开 input + 按名称过滤的 dropdown (排除已有 key)，选择建议创建正确类型的 prop (list→pills)。修复：
  readProps 排除 `.prop-newrow` (此前误 commit 正在输入的名称)。用 Chrome DevTools 验证：
  /api/properties 返回 76 key (created 5938，aliases 5937…)，dropdown 过滤 "tag"→tags/tag/taskTagNote，
  选择 "source" 正确向文件添加 1 个 prop 后干净删除。须删除 data/qmd-index.json + reindex 以获得 propMeta。
- 2026-06-05：完成剩余 3 项。(1) 稳定 server：在 newIndex + loadJSON 中关闭 minisearch `autoVacuum` (discard/replace 时
  TreeIterator.dive crash 的来源)；添加 process uncaughtException/
  unhandledRejection guard (log，不死亡)。(2) Table handle：列选择条 (th 上边缘) + 行选择条 (首
  cell 左边缘) — hover 高亮整列/整行 (.cm-cell-hl)，点击打开正确作用域的格式菜单。(3) Obsidian 风格 Property
  type registry：service 读写 `.obsidian/types.json` (format {types:{key:type}}，
  text/multitext/number/checkbox/date/datetime/tags/aliases) + route GET/POST `/api/property-types`；
  web 注入 registry，右键 key/icon → 菜单 "Property type" (6 种类型，✓ 当前类型) + Copy value
  + Remove；改类型持久化 types.json，若改变 list-ness 则 convert YAML scalar↔list 后 commit，其余
  只就地改 icon。用 Chrome DevTools 验证：菜单项齐全 + 对 created 显示 ✓ Date&time；将 title→List 写入
  types.json {"title":"multitext"} + YAML 变为 list，revert→Text 干净；handle 高亮 3 个 cell + 打开菜单。
- 2026-06-05：按 property type 的 Value input (如 Obsidian)。`makeScalarField(dt,value)` 构建正确类型的
  control：text=span contenteditable，number=`<input type=number>`，checkbox=`<input type=checkbox>`，
  date=`<input type=date>`，datetime=`<input type=datetime-local>`。每个 field 保存 `dataset.raw` =
  标准 YAML 值 (readProps 读取 raw → 未被触碰的 field 不被覆盖，如 timestamp
  `…:48.273Z` 在仅显示 `19:23` 时保持原样)。scalar↔scalar 改类型就地 swap control (修复：此前
  仅改 icon)。用 Chrome DevTools 验证：created→datetime picker (raw 保留秒/Z)，dateNote (Obsidian 在
  types.json 中设 datetime) 也显示 datetime picker — 双向 interop；将 dateNote 循环经
  number/checkbox/date/text/datetime input 正确切换；README 干净，types.json 匹配。
- 2026-06-05：Obsidian 风格 List property (tags…) 编辑/添加 value。Pill 现在 contenteditable (点击编辑，
  blur commit) + × 删除按钮；"+" 按钮打开输入框 + value 建议 dropdown (通过 `setLivePreviewTagProvider`
  取 vault tag → /api/tags，1302 tag)，实时过滤，选择或 Enter 添加。移除 Add-property suggester 的 12 cap (现在
  显示全部 ~72 key，可滚动) — 修复 "props 太少" 的抱怨。Value dropdown 用 position:fixed append body，
  通过 getBoundingClientRect 锚定在 input 下方 (修复 UI bug：此前被下推产生空隙 + dropdown
  弹向右侧)。mutate 中的 flushActive 避免有其它操作时丢失未完成的 edit。用 Chrome
  DevTools 验证：gap 0px，dropdown 位于 input 正下方，过滤 "linu"→linux/linuxjournal，选择→`tags: - linux` 写入
  文件，编辑 pill linux→linuxedit persist，干净删除；Add-property dropdown 72 项。
- 2026-06-05：Graph view 从独立 modal → 如 Obsidian 在 workspace 标签页中打开 (sentinel
  path `graph://view`，activePath 为 graph 时在 Workspace 中渲染；setGraph/openGraph 添加或
  激活标签页，随 workspace state 保存)。添加 Obsidian 风格 Filters overlay 面板 (逐 section 折叠)：Filters (search files, Tags/Attachments/Existing files only/Orphans toggle)，Groups
  (New group：颜色 + query → 给匹配 node 着色)，Display (Arrows, Text fade, Node size, Link thickness,
  Animate)，Forces (Center/Repel/Link/Link distance slider 0..1 映射到 d3-force)。Backend 扩展
  `graphData()`：返回带 `kind` (note/attachment/unresolved) + `tags` 的 node，为
  嵌入附件生成 attachment node，为尚无文件的 wikilink 生成 unresolved node → toggle 真正生效；
  buildLinkGraph 额外保存 rawLinks + tags。graphSettings 通过 /api/uistate persist。typecheck + build
  web 干净 (414 modules)。
- 2026-06-05：修复 Tags toggle 导致白屏。原因：server 8787 正在运行**旧** dist 版本
  (无 tags) → `n.tags` = undefined；client 执行 `for (const tag of n.tags)` 在 useEffect 中同步抛出 "undefined is not
  iterable" → React unmount 整棵树 (白屏，refresh 无效因 tags:true 已
  persist)。修复 client：guard `n.tags ?? []` + 跳过无 tags 的 node，将 link 解析为 node-object 引用
  (消除 forceLink 抛 "missing node" 的可能)，用 try/catch 包裹整个 build →
  显示 "Reset filters" overlay 而非白屏。Rebuild server (tsc) + restart `node
  server/dist/index.js` (PORT=8787 DATA_DIR=./data ALLOWED_ROOTS=/Users/xnohat；vault 来自
  settings.json，"sample-vault" log 是 defaultVaultPath 造成误解)。通过 CDP (port 9223) 在
  真实 vault 上验证：/api/graph 返回 22718 node 含 kind+tags (3085 node 有 tag)，开启 Tags → tagsOn=true，无
  错误/无 crash，orphan 2533→1213 (note 连到 tag node)。typecheck + build web+server 干净。
- 2026-06-05：修复性能 — server 持续占用 ~88% CPU + Files 面板卡在 "Loading..."。3 个 O(全 vault) 反复运行的
  原因：(1) chokidar 未 ignore `.obsidian` → 打开同 vault 的 Obsidian app 持续写入
  workspace.json/state → 每个事件广播 `fs` → client refetch 整棵树。(2) `listTree`
  对每个文件 `fs.stat()` → 每次 fetch tree 27k syscall (UI 不使用 size/mtime)。(3) onChange + API
  reindex 调用 `buildLinkGraph()` 每次 1 个文件改变就读取+重新 parse 全部 5938 note。修复：在 watcher 中 ignore
  `.obsidian`；去除 listTree 中的 `fs.stat` (仅用 dirent)；添加
  `updateLinkGraphForFile(rel, removed)` 增量更新 1 个文件的 graph (watcher onChange + PUT content/rename/delete 的 reindex
  都用；agent + /api/reindex 仍 full 因罕见)。在真实 vault 上通过 CDP 验证：CPU 88%→0% idle，/api/files/ ~190ms，
  Files 面板不再 "Loading" (38 row)。RSS ~1.1GB 稳定 (MiniSearch + index，不增长)。typecheck + build server 干净。
- 2026-06-05：根据反馈提升 Graph 质量 + 交互 (对比 Obsidian)。(1) 点击 TAG node →
  search notes：store 添加 `searchFor(q)` (set leftPanel=search + searchQuery)，SearchPanel adopt
  searchQuery；GraphView onUp：note→openFile，tag→`searchFor('tag:'+name)`。验证 API：tag:license→50
  hits (首个 note "12min Lifetime License" 匹配 Obsidian)，tag:Android→40。(2) 流畅 zoom：移除 React
  onWheel (passive，preventDefault 被忽略) → native listener {passive:false}，连续 scale
  `exp(-deltaY*speed)` 而非固定步进 1.1×；ctrlKey=pinch amplify。(3) 更锐利的图形：node
  radius 改为 sqrt `(1.5+√deg*0.9)*(0.4+size)` (不再巨大 blob)，node 周围加底色边框以
  分隔，edges 细淡 hairline (alpha 0.18+)，label 有背景 halo (strokeText) 易读。(4) Zoom 性能：
  cull viewport 外的 edge (若两端同侧在屏幕外则 skip)。typecheck + build web 干净。
- 2026-06-05：根据反馈的 Graph layout & label fade：(1) 提高推力 (charge −66→−120)，hub 按 √deg
  强推，link 更长 (67→100)，distanceMax 480→1400，center 更轻，按真实半径 collide → graph 展开通透，不再 "hairball"。(2) Line 更细 + 颜色更深 (改为 --text-faint，alpha
  ~0.7)。(3) Label 按 zoom fade (hub 先显示，小 note 仅 zoom 近时显示) 而非全部显示。
- 2026-06-05：将 graph renderer 从 canvas-2D (CPU) 改为如 Obsidian 的 **PixiJS WebGL (GPU)** (用户
  选择)。Pixi v8 dynamic-import (chunk 246KB gzip，仅打开 graph 时加载；主 bundle 仍 ~40KB)。
  架构：node = Sprite (共用圆形 texture，按颜色/组 tint，按半径 scale)，edges =
  Graphics，label = 独立 screen-space Text 层 (pool ≤400，背景 halo，按 zoom fade)。Pan/zoom = 在
  world Container 上变换 camera (world.position/scale) → **不重绘几何**，无论多少 node 都流畅；
  仅 sim tick 时重绘 geometry。Render on-demand (ticker.stop + app.render 经 rAF batch)。保留
  d3-force + Filters/Forces 面板 + 点击 tag→search。CDP 验证真实 vault：WebGL context 存活
  (未 lost)，0 console 错误，改 filter 时 scene rebuild 正确 (tags off→1258 node)，截图确认
  绘制 node/edge/label 锐利。typecheck + build web 干净。
- 2026-06-06：经多轮 CDP 截图微调 WebGL graph 匹配 Obsidian：(1) Node size：
  sqrt 带 CAP `(3+min(√deg,11))*(0.45+size)` → hub tag 仅 ~3.5× note (此前 ~9×，巨大 blob)，
  note 有 base 清晰可见。(2) Label：屏幕半径阈值降低 + **greedy 防重叠**
  (sort hover→deg，丢弃与已放置 label 重叠的 label，最多 220) → label 干净如 Obsidian，在正确
  zoom 层级显示而非过晚/重叠。(3) 按**核心区域** Auto-fit (median center + percentile 82% 半径，
  去除飞远的 orphan 簇 outlier) → 默认 zoom 合理，不将 graph 缩成屏幕中心的点；
  布局期间定期 fit，user pan/zoom 时停止。(4) Edge 在屏幕上保持**固定粗细**
  (width=base/k，zoom 时重绘；pan 仍纯 transform) → 不再在深度 zoom 时变成粗灰条。
  多个 zoom 层级 CDP 验证：line 均匀细，label 清晰不重叠 (note+tag)，node 平衡，tag cyan
  点击→search。typecheck + build web 干净。
- 2026-06-06：根据 "显示过晚 + 模糊" 反馈调整 Label：降低 rMin 阈值 (1.1−fade) → label 在默认
  zoom fit 层级即显示；font 11→13 + fontWeight 600 + 颜色 --text-normal (深/黑) + halo width 4 + alpha
  ramp 加快 → 不再模糊。CDP 验证：fit 和 zoom +2 层级，label 深黑粗，不重叠 (greedy
  仍防重叠)，完整显示 tag + note 名称如 Obsidian。
- 2026-06-06：Label 按 zoom 平滑 fade 如 Obsidian：放宽 alpha ramp 区域 (屏幕半径 over ~4.5px)
  → label 在远 zoom 时模糊显示然后随 zoom 逐渐清晰，hub 先清晰，小 note 后清晰。CDP
  验证：fit 层级 label 模糊/多级 opacity，zoom +4 label 完全清晰-加粗。
- 2026-06-10：Obsidian 风格 Navigation back/forward (M9.10)。Store 添加 history stack (`history`/
  `histIndex`，cap 100) + `goBack`/`goForward`；openFile/openGraph 通过 `pushHistory` push entry (截断
  forward 分支，借助 `navByHistory` 标志在 replay 时跳过)。View-header 现在为**所有** view
  渲染 (此前仅 markdown)，左角 2 个 ←/→ 按钮，无后退/前进时 disabled+模糊；Graph view 也有
  toolbar。Icon 添加 arrow-left/arrow-right。typecheck 2 个 workspace + build web 干净。
- 2026-06-10：Search panel 添加 filter/sort + sticky (M9.11)。查询框 (input + match-case
  按钮 "Aa" + clear + options) 合并为一个带边框 box，`.search-head` 在
  `.sidebar-body` 内 `position: sticky; top:0` → 滚动结果时**不**漂移 (修复抱怨)。Options 面板 (通过
  sliders 按钮 toggle)：Collapse results (隐藏 snippet)，Show more context (移除 line-clamp)。Dropdown Sort：
  Relevance (默认 = server 顺序) / File name A→Z / Z→A / Path — client-side sort。Match case
  按 free-text 客户端过滤 (去掉 operator tag:/path:)。Limit 从 50 提高到 100。注意：按 Modified/
  Created time 排序**尚**未实现 — search index 不保存 mtime/ctime，需添加 server field + reindex。
  typecheck + build web 干净。尚未 live 验证 (browser profile CDP 被占用)。
- 2026-06-10：移除硬编码 100 结果 cap (反馈 "为什么总是 100？")。Server：route 移除
  Math.min(...,100)，`limit<=0`/省略 → 返回**所有** match；QmdEngine.search 仅当 limit>0 时 slice
  (agent API 仍传 limit 故不变)。Client：api.search 移除默认 100 (不 limit 调用)，
  SearchPanel 通过 IntersectionObserver 每次**递增**渲染 50 条 (sentinel + rootMargin 300px)，改动
  query/sort/match-case 时重置为 50，显示 "Showing X of Y…"。计数现在为真实总数。在真实 vault 上验证 API：
  q=nginx → 166 hit (此前截为 100)，limit=100 仍 cap 100。重启 server dist。typecheck + build web+server 干净。
- 2026-06-10：修复 search 框上方的缝隙 (结果漏到搜索框上方)。移除
  `.search-head` 上的 `position: sticky` (在带 padding-top 的 `.sidebar-body` 中 sticky → 缝隙)。改用固定布局：
  `.search-panel` height 100% flex-column，`.search-head` flex-shrink:0 (固定不动)，`.search-results`
  flex:1 + overflow-y:auto 自行滚动 → 列表顶部不可能覆盖框。IntersectionObserver 将 root 改为
  `.search-results` (ref) 而非 viewport。typecheck + build web 干净。
- 2026-06-10：Phase 16 (FR-10) — deep-link URL + public share。URL `/note/<path>` 与打开的标签页双向
  同步 (module `web/src/lib/urlsync.ts`：改 note 时 pushState，popstate → openFile，
  首次 sync 用 replaceState；deep-link 优先于 workspace restore)。Public share：`data/shares.json`
  (1 record/note，token 16-byte base64url)，`/api/shares` CRUD + toggle enabled，`/public/shares/:id`
  返回 {title, content} 不泄露 path，`/public/shares/:id/file` 仅提供该 note 内嵌的
  文件 (`![[...]]`/`![](...)`，按 basename 解析如 files API，阻止 `.md`)。页面 `/share/<id>`
  独立渲染 Reading view (main.tsx 在 App 前分支，无 auth)，wikilink 无链接。UI：上下文
  菜单 "Copy public link" (FileTree)，Settings → Sharing 标签页 (search，Copy link，Disable/Enable，
  Delete；点击 path 打开 note)。重命名 note 自动更新 share path。通过 curl 端到端验证
  (401 file API vs 200 public，allowlist 404，disable→404，re-enable→200) + Chrome (share 页面
  在隔离 context 无 cookie 渲染内嵌图片；deep-link 打开正确 note；browser Back 改 note；
  Sharing 标签页显示完整 controls)。Typecheck + build 干净。
- 2026-06-10：M16.5 — 每个 share link 独立密码。Server：`ShareRecord.passwordHash`
  (scrypt，复用 auth service 的 hash/verify；从不返回 hash — API 返回 `hasPassword`)，
  PATCH /api/shares/:id 接受 {password: string|null} (设置/删除)，POST /public/shares/:id/unlock
  用密码换取 JWT cookie httpOnly scope `/public/shares/:id` TTL 12h (内嵌图片自动发送 cookie)；
  未 unlock 时 GET content/file 返回 401 {passwordRequired}。Web：PublicNote 添加 unlock 表单
  (密码错误报错，正确 → 渲染)；Sharing 标签页添加 "Password…/Password ✓" 按钮 (prompt 设置/
  修改/删除) + "password-protected" 徽标。验证 curl (set→401→unlock 错误 401→unlock 正确→cookie
  →200 content+file，删除 password→又 200，shares.json mode 600 含 scrypt hash) + Chrome 隔离
  context (表单显示，错误报错，正确打开 note + 图片加载，Sharing 标签页状态正确)。
- 2026-06-10：M16.6 — public share 页面的 SSR + SEO。Server 将 `GET /share/:id` 渲染为完整
  HTML (route `sharepage.ts` 在 static 前 mount)：note 内容直接在 HTML 中 (Google
  可索引，无需 JS)，head 含 title / meta description (strip markdown ~160 字符) / canonical /
  og:type=article + og:site_name + og:title/description/url/image (note 内嵌的第一张图片 — 通过 public endpoint 的绝对 URL，
  或第一张 web 图片) / twitter:card summary_large_image。用 service `renderhtml.ts` 渲染 — 从 web 移植
  unified/remark/rehype+sanitize pipeline (保持 sync)，deps 加入 server workspace；SPA 的 CSS bundle 被
  inline 故界面匹配 Reading view。带密码的 Share → SSR unlock 表单 (noindex，不泄露内容/metadata；inline JS POST unlock
  然后 reload)；unlock cookie 改 path '/' 使 /share/:id 和 /public/shares/:id 都接受。移除 React
  页面 PublicNote (SSR 替代)，vite proxy 添加 /share。验证 curl：locked → noindex + 不泄露，
  解锁 → 完整 meta + content + img + 内联 CSS，错误 id → 404 noindex；Chrome 隔离 context：unlock
  表单错误报错，正确 → reload 显示与 Reading view 完全一致的 note。Typecheck + build 干净。
- 2026-06-10：Graph view — 修复布局偏离 Obsidian (图被拉成丝，孤立簇飞散，
  hub tag 变成带刺"蒲公英")：(1) 用真正的 gravity `forceX`+`forceY` (按 Center force slider map) 替代 `forceCenter` (仅平移重心，
  不吸引)；(2) link strength 改为 d3 默认的自适应风格 `slider/min(deg)` 使 hub 周围簇压成密实圆盘；
  (3) 按度数 cap 排斥系数 (hub ~2× leaf 而非 ~8×) + distanceMax 900；(4) 用叶序螺旋初始化位置
  而非将全部 5.4k node 放在 r=250 的圆上；(5) link distance 默认
  100→50，alphaDecay 0.02；(6) tag node 改为 Obsidian 风格绿色。Chrome 在真实
  vault 5.9k note 验证：图凝聚为带绿色 tag 均匀分布的联系球体，label/zoom
  稳定，console 干净。Typecheck + build 干净。
- 2026-06-10：Phase 17 (PRD 0.3) — pane 菜单 (⋯) + 根据 "缺少 3 点菜单 + 缺少右侧边栏功能" 的反馈大改 Right sidebar。(1) **所有** view 的 view-header 上的 ⋯ "More options" 按钮：
  note = Split right/Split down + Bookmark + Copy public link + Make a copy + Rename/Move/Copy
  path/Delete + Close tab/Close other tabs；Graph = Copy screenshot (extract Pixi stage → PNG
  composite 叠加 theme 背景 → clipboard；因 WebGL 不 preserveDrawingBuffer 需重渲染) + Close
  tab。(2) 双向 Split pane：`splitDirection` right/down 在 uistate 中 persist，`.editor-area.
  split-down` flex-column。(3) Right sidebar 成为 Obsidian 风格 icon tab strip：Backlinks
  (Linked mentions + **Unlinked mentions**) · Outgoing links (resolved/unresolved，从 unresolved 过滤 attachment
  以免误建 .md note) · Tags (复用 TagsPanel，点击 → search tag:x
  正确 query) · Outline；`rightPanel` persist + sync。(4) Server：`/api/search/matches` 添加
  `phrase:true` → 匹配整个短语 (unlinked mentions 精确如 Obsidian 而非逐词 OR —
  验证 curl：同一 note 上 phrase=0 hit vs word-based=1679)。新 icon：more-horizontal/rows/
  list/arrow-up-right/camera。CDP 在真实 vault 验证：note ⋯ 菜单完整 11 项，Split down 生成
  下方带 header+close 的 pane，Copy screenshot → clipboard 含 image/png，tab strip 切换 panel，
  unlinked mentions phrase 修复后 30→0 (长 title 不再 verbatim 出现)，rightPanel reload 后
  恢复。Typecheck + build web+server 干净；重启 server dist。环境注意：
  用户的旧 client (先前 bundle) 开着 /graph 持续推送 uistate 在测试时覆盖 — 不是
  新代码的 bug。
- 2026-06-10：Graph view — 将 slider 同步到 Obsidian app 的单位/原始默认值：Text fade
  -3..3=0，Node size 0.1..5=1，Link thickness 0.1..5=1，Center force 0..1=0.52，Repel force
  0..20=10，Link force 0..1=1，Link distance 30..500=250 (内部映射到已校准的 d3 参数
  使默认产生与 tune 版相同的 layout)。Filters 面板默认 collapsed — 仅显示 cog icon
  如 Obsidian。迁移：server-side persist 的旧 graphSettings (0..1 刻度) 通过
  linkDistance ≤ 1 检测 → 将 display/forces 重置为新默认，保留 filters/groups。Chrome 验证：
  panel 关闭 + cog，打开 panel slider 的 min/max/value 正确，layout 保持球体。Typecheck + build 干净。
- 2026-06-10：Graph view — 通过 reverse-engineer 机器上安装的 obsidian.asar 来**精确**移植 Obsidian app 的 physics
  (sim.js = 在 worker 中运行 d3-force + WASM，app.js = panel/renderer)：
  charge = -repelSlider³ (默认 10 → -1000，distanceMin 30，theta .9，**无** distanceMax)；
  link distance = 原始 slider (250)；link strength = slider × 1/min(deg) (d3 自适应)；
  gravity forceX/Y 其中 strength = MJ easing (0.01^(1-e)-0.01)/0.99 → 0.52 ⇒ 0.1；collide 固定
  半径 60 strength 0.5；alphaDecay 1-0.001^(1/300)；velocityDecay 0.4。Node radius 按
  Obsidian 的 getSize()：nodeSize × clamp(3√(deg+1), 8, 30)。Edge 在屏幕上绘制固定粗细
  (lineSizeMult/scale) 淡色；note node 灰色 (非 accent)。结果：图凝聚为如 app 的单块球体。
  Chrome vault 5.9k note 验证 + typecheck/build 干净。
- 2026-06-10：Graph view — 完成与 Obsidian app 的 render parity (继续挖掘
  app.js 中的 renderer)：(1) node 按 Obsidian 的 nodeScale = √(1/zoom) 规则绘制 — 屏幕半径 =
  getSize()·√k 故 zoom out 时 node 仍大得几乎相接形成密实蜂窝盘，edges 沉在后方
  (此前 node 随 zoom 线性缩小 → 萎缩消失，只剩 edges 形成 "烟花" 束)；
  (2) label 用如 app 的全局 fade textAlpha = clamp(log₂(zoom) − textFade, 0, 1) (默认：
  zoom 1× 后开始显示，2× 完全清晰) 而非逐 node 半径阈值；(3) hover/click 的 hit-test + 箭头 + hover 缩放乘数按新的屏幕半径同步。不复制
  Obsidian 代码 — 仅提取常量/公式并在 d3-force (BSD) 上重写。Chrome 与 app 在
  同一 vault 并排验证：密实簇球体相似。Typecheck + build 干净。
- 2026-06-10：用 4 个并行 agent 全面 reverse engineering Obsidian Desktop 1.12.7 (extract obsidian.asar：
  app.js 3.6MB，app.css 588KB，main.js，worker.js，sim.js)。将知识写入
  docs/obsidian-desktop-internals.md (22 项)：精确 Markdown dialect 正则 (wikilink/
  callout/tag/block-id/footnote)，6 步 link resolution 规则，完整 .obsidian/* schema +
  workspace.json + graph.json + .canvas + .base，search operators grammar，带评分公式的 fuzzy 算法，
  d3-force graph 常量 (velocityDecay 0.6，repel −slider³，slider curve)，
  Live Preview/reading view 机制 (DOMPurify config，embed depth ≤5)，196 command id + 默认
  hotkey，31 个 core plugin 的 registry，2 个 theme 的全部 CSS design tokens + DOM class + 表
  14 组 callout。作为后续克隆功能的原始文档。
- 2026-06-10：Graph view — 复制 Obsidian app 的 viewport 行为：初始化 scale = 1 按
  DEVICE pixel (CSS k = 1/devicePixelRatio)，spawn 中心置于框中央，**不** auto zoom-to-fit
  (移除随 tick 运行的 fitView — 正是它使两侧 zoom 层级不同故同一 node 看到的
  密度/距离不同)；node 从中心小的叶序盘 "big bang" spawn 并
  如 app 般展开。重新开启已保存 uistate 中的 Orphans (Obsidian 默认 = on；2.289 orphan 填充
  簇之间的空隙 — 缺少它们故此前看起来比 app 更 "空")。修复后：相同 zoom
  层级，node 距离/大小与 app 一致，因 physics + render 规则 + viewport 都相同。
  Chrome 对比 zoom 到 hub #FRT 与 app。Typecheck + build 干净。
- 2026-06-10 (续)：Graph view — 完成与 Obsidian app 的 zoom/spacing/typography parity
  (继续挖掘 app.js + 通读整个 sim.js)：(1) 所有 scale 规则改为 DEVICE pixel 如 app
  (node 屏幕半径 = getSize·√scale_device → Retina 上 node 缩小 √dpr，簇距离
  匹配 app)；(2) wheel zoom 精确按 app 公式：target ×= 1.5^(−ΔY/120)，clamp [1/128, 8]，
  zoom-in 锚定 cursor / zoom-out 锚定中心，scale lerp 15%/frame (如 app 般平滑)；(3) label 按
  app renderer：fontSize 14 + getSize()/4，font stack ui-sans-serif…，scale = nodeScale
  (随 √zoom 缩放如 node)，offset (getSize+5)·nodeScale，hover 不小于 1/scale；
  textAlpha = clamp(log₂(scale_device) + 1 − fade, 0, 1) (此前缺 +1 和 dpr → label 过晚显示 4×)；移除自制的
  greedy declutter (app 没有)；(4) edge 粗细精确为 lineSizeMult DEVICE px
  (此前粗 dpr 倍)，箭头按 clamp(2·(scale−0.3),0,1) fade，size 2√mult/scale；
  (5) app 风格 hover fade：与 hover node 不连的 node/edge 渐隐至 alpha 0.2 (lerp 0.9/frame)，
  相连 edge 改高亮色；移除 hover 时放大 1.25 (app 不放大)；(6) 改 forces 时 sim.alpha(0.3)
  (app post alpha .3)；为 automated UI test 添加 hook window.__graphCam。
  在真实 vault 5.9k notes 的 Chrome 上验证：球体 + 蜂窝 orphan 环，label 在正确
  scale ~0.5–1 阈值显示，hover dim 标准，console 干净，typecheck + build 干净。
- 2026-06-11：Phase 20 (PRD 0.5) — Graph "Find node"：canvas 左上角浮动 search 框，keyword
  在显示中的 node 上匹配 (label/path，AND 所有词，rank tag-first>prefix>label>path+degree，top 50，
  kind 着色 tag 绿/attachment 黄/unresolved 模糊 + 副 path)；click/Enter → flyTo：camera
  lerp pan+zoom 15%/frame (与 Obsidian 的 updateZoom 同频) 到 scale ≥2 的 node，setHover 高亮
  accent + 淡化非连接的直到鼠标移动；wheel/drag 取消 fly；Esc/clear 关闭 list。验证
  CDP 真实 vault：输入 "docker" 50 结果 rank 正确，点击飞到 node 居中 scale 2.0，query
  自动清除，console 干净。Typecheck + build 干净。PRD bump 0.5 (FR-2)。
- 2026-06-11：M16.7 — 每个 note 的 Share dialog + globe 徽标 (反馈："Copy public link" 不
  告知 note 是否已 share)。组件 `ShareDialog.tsx` (modal)：未 share → Create public link 按钮；
  已 share → toggle pill 开关，URL 框 + Copy，Set/Change password，Delete link。Store 添加
  `shares` cache + `loadShares()` + `shareDialogPath` (login 后 load，每次操作后 refresh)；
  Settings → Sharing 改用 store 故徽标在所有地方同步。文件树上下文菜单和
  ⋯ pane 菜单项改为 "Share…" (globe icon) 打开 dialog。File tree：已启用 share 的 note 显示
  accent 色 globe icon 在名称旁。Icon `globe` 加入 Lucide 集。通过 CDP 用 headless Chrome 验证
  (MCP 被其他 session 占用)：徽标正确显示 share note + accent 色，菜单有 "Share…"，dialog 打开完整
  controls (URL 正确 token，toggle on，Set password…，Delete)。Typecheck + build 干净。
