# Obsidian Desktop 1.12.7 — 逆向工程知识

> **目的：** 本文档记录了 Obsidian Desktop App（1.12.7 版，macOS）的逆向工程结果，
> 以便 WebObsidian 能够**精确复制** Obsidian 的行为、数据格式和界面。
> 下文所有正则、默认值、JSON schema、公式均**逐字提取自真实代码**
> （已提取的 asar），而非来自公开文档。
>
> **来源：** 使用 `npx @electron/asar extract` 提取的
> `/Applications/Obsidian.app/Contents/Resources/obsidian.asar` → `app.js`（3.6MB renderer）、
> `app.css`（588KB）、`main.js`（60KB Electron main）、
> `worker.js`（239KB Metadata Cache Worker）、`sim.js`（Graph physics worker）、`starter.js`（vault chooser），
> 以及真实仓库 `~/ObsidianVault-Trilium/.obsidian/`。
>
> **随附库（lib/）：** CodeMirror 6（打包在 app.js 中；lib/codemirror 是 CM5，仅用于 sandbox/legacy）、
> PixiJS（graph 渲染）、Mermaid、MathJax（tex-chtml-full）、Prism（语法高亮）、PDF.js、moment、
> i18next、turndown（HTML→MD）、readability、DOMPurify（打包在 app.js 中）。
>
> 更新于：2026-06-10。

## 目录

1. [Electron shell、仓库注册表、obsidian:// 协议](#1-electron-shell)
2. [核心对象模型与事件系统](#2-object-model)
3. [核心插件注册表与视图类型](#3-core-plugins)
4. [命令与默认快捷键](#4-commands--hotkeys)
5. [设置 schema（.obsidian/）——完整](#5-settings-schema)
6. [workspace.json 格式](#6-workspacejson)
7. [Markdown 方言——精确正则](#7-markdown-dialect)
8. [链接解析与 MetadataCache](#8-link-resolution--metadatacache)
9. [Editor：CodeMirror 6、Live Preview、suggesters、fuzzy search](#9-editor)
10. [阅读视图与后处理管线](#10-reading-view)
11. [全局搜索：文法与运算符](#11-global-search)
12. [Quick Switcher](#12-quick-switcher)
13. [关系图谱视图：物理与 graph.json](#13-graph-view)
14. [白板（.canvas 格式）](#14-canvas)
15. [Bases（.base 格式）](#15-bases)
16. [Daily notes / Templates / Unique note](#16-daily-notes--templates)
17. [文件处理：附件、重命名、回收站、恢复](#17-file-handling)
18. [每设备状态存储：localStorage 与 IndexedDB](#18-per-device-state)
19. [CSS/主题系统——设计 token](#19-css-theming)
20. [DOM class 结构](#20-dom-classes)
21. [Callouts——完整表格](#21-callouts)
22. [克隆功能时的清单](#22-checklist-clone)

---

## 1. Electron shell

### 仓库窗口

```js
new BrowserWindow({
  width: 800, height: 600, minWidth: 200, minHeight: 150,
  backgroundColor: "#00000000",
  trafficLightPosition: { x: 19, y: 12 },
  show: false,
  frame: <仅当 config.frame === "native" 时为 true>,
  titleBarStyle: <若为 native frame 则为 "default"，否则为 "hidden">,
  webPreferences: { contextIsolation: false, nodeIntegration: true,
    nodeIntegrationInWorker: true, spellcheck: true, webviewTag: true },
  ...savedWindowState  // x,y,width,height 按每个 vault 恢复
})
```

- App 通过自定义协议 `app://obsidian.md/index.html` 加载（从 asar 提供文件，支持 Range，
  `X-Frame-Options: DENY`）；第二个随机 origin `app://<36 个随机 hex>/` 提供任意本地文件
  （仓库资源）。
- 每个仓库的窗口状态保存于 `<userData>/<vaultId>.json`：`{x, y, width, height, isMaximized, devTools, zoom}`
  （move/resize 时 debounce 100ms）。恢复时最小 clamp 300×200，并检查在所有 display 上可见。
- 仓库选择器（starter）：frameless 800×650，不可 resize，bg `#1e1e1e`。Help window：600×680。
- 启动：打开注册表中所有 `open: true` 的仓库；若没有则显示 starter。

### 仓库注册表 — `<userData>/obsidian.json`

```jsonc
{
  "vaults": {
    "<vaultId>": { "path": "/abs/path", "ts": 1780115021752, "open": true }
  },
  // 其他键："frame", "insider", "cli", "updateDisabled", "disableGpu",
  // "adblock", "adblockFrequency", "icon", "openSchemes"
}
```
- `vaultId` = 16 个随机 hex 字符（`(Math.random()*16|0).toString(16)` × 16）。
- `ts` = 每次打开仓库时的 `Date.now()`（“最近”程度）。
- 仓库当前有窗口时 `open: true`（关闭时清除，退出时除外）——用于启动时恢复。
- 按 id **或**文件夹 basename 查找仓库（不区分大小写）。

### 协议 `obsidian://`

在主进程侧解析，payload 通过 `window.OBS_ACT` 注入 renderer（若是 function 则调用，
否则赋值——SPA 在 boot 时拾取）。Web clone 可原样复用此契约。

| URL | Action |
|---|---|
| `obsidian:///abs/path` | `{action:"open", path}` → 查找包含 path 的仓库 |
| `obsidian://vault/<名称或Id>/<file...>` | `{action:"open", vault, file}` |
| `obsidian://<action>?k=v&...#hash` | `{action, ...query, hash}`（无值 param → `"true"`） |

Renderer 侧 handler（Map `protocolHandlers`，可通过 `registerObsidianProtocolHandler` 扩展）：
- **`open`** —— 文件 + subpath 经 `getFirstLinkpathDest`，参数 `paneType`
- **`search`** —— `query` → global-search
- **`new`** —— 参数 `file`/`name`、`content` | `clipboard`、`append`/`prepend`/`overwrite`、`silent`、`paneType`；自动创建 folder
- **`show-plugin`**（`id`）、**`show-theme`**（`name`）、**`show-release-notes`**、**`debug-info`**、
  **`publish-sites`**、**`sync-setup`**、**`vault-setup`**、**`hook-get-address`**（x-callback-url，受 config `uriCallbacks` 门控）
- 通过 params `x-success`/`x-error` 支持通用 x-callback-url。

### 主要 IPC 通道

`is-dev, version, file-url, print-to-pdf, vault, vault-list, vault-remove, vault-move, vault-open,
vault-message, starter, help, sandbox, context-menu, request-url (proxy net.request), open-url,
trash (shell.trashItem), set-menu/render-menu, create-browser-session`，以及经 local socket 的 CLI server
（`obsidian` CLI 命令，受 setting `cli` 门控）。

---

## 2. 对象模型

### App（singleton，以 `(adapter, appId)` 初始化）

`appId` = vault id —— 作为 localStorage（`<appId>-<key>`）、IndexedDB（`<appId>-cache`、`<appId>-backup`）、
webview partition（`persist:vault-<appId>`）的命名空间。

组成部分：`keymap`（Keymap）、`scope`（root Scope）、`commands`、`hotkeyManager`、`dragManager`、`customCss`、
`embedRegistry`、`viewRegistry`，然后 `vault`、`workspace`、`fileManager`、`statusBar`、`metadataCache`、
`metadataTypeManager`（property types → `types.json`）、`setting`（modal settings）、`foldManager`
（fold state → localStorage `<appId>-note-fold-<path>`）、`internalPlugins`、`plugins`（community）。

**boot 顺序：** vault adapter → `vault.setupConfig` → Workspace/FileManager/StatusBar/MetadataCache/
MetadataTypeManager/Setting/FoldManager → 应用 theme/font/css → 注册 built-in commands → 加载全部
internal plugins → `internalPlugins.enable()` → community plugins → `workspace.loadLayout()` →
`trigger("layout-ready")`。

### Vault + DataAdapter

- `fileMap: {path → TAbstractFile}`（TFile / TFolder），root `""`/`"/"`；`configDir` 默认 `".obsidian"`
  （可修改，必须以 `.` 开头；替代名称保存在 localStorage `<appId>-config`）。
- adapter 的原始 Watcher → Vault 事件映射：`folder-created`/`file-created` → `create`，`modified` → `modify`，
  `file-removed`/`folder-removed` → `delete`，`renamed` → `rename(file, oldPath)`，`closed`（vault 文件夹消失），
  `raw(path)`（dotfiles——用于 hot-reload `app.json`、`appearance.json`、`hotkeys.json`、`core-plugins.json`、
  插件的 `data.json` → 可与 sync/multi-window 共存）。
- adapter API：`read/readBinary/write/writeBinary/append/process/mkdir/rmdir/remove/rename/copy/stat/exists/list/watch/getResourcePath`、`trashSystem`（OS trash）和 `trashLocal`（移入 `<vault>/.trash/`）。
- Config：先合并 `appearance.json` 再合并 `app.json`（app 优先）；`setConfig` debounce-save 1s 并 trigger
  `config-changed`；保存时按白名单（§5）将 key 分离回 2 个文件（appearance）。

### MetadataCache

- 在 `worker.js` 中解析（名为 "Metadata Cache Worker" 的独立 Worker）。协议：post
  `{metadataCache: <ArrayBuffer bytes file>}` → 返回 `CachedMetadata`（§8）。
- 持久缓存：IndexedDB **`<appId>-cache`**（version **19**），2 个 store：
  - `file`：path → `{hash, mtime, size}`
  - `metadata`：hash → CachedMetadata；`hash` = **raw bytes 的 SHA-256 hex**。
  - Boot 时用 `mtime`+`size` 重新校验；不一致 → 重新解析。每 600s 清理已删除 path。
- 维护 `resolvedLinks` / `unresolvedLinks`：`{sourcePath: {targetPath|linktext: count}}` —— graph/backlinks 的来源。
- Event：`changed`（metadata 文件变化）、`deleted`、`resolve`（1 个文件的 links）、`resolved`（整个仓库完成）、`finished`（首次索引）。
- API：`getFileCache, getCache, getFirstLinkpathDest, getLinkpathDest, fileToLinktext, iterateAllRefs, isUnresolved`。

### Workspace

- item 树：`WorkspaceItem → WorkspaceParent → WorkspaceSplit / WorkspaceTabs / WorkspaceLeaf`，
  root split、左/右侧边栏、floating（popout）、mobile drawers。
- Field：`rootSplit, leftSplit, rightSplit, floatingSplit, leftRibbon, activeLeaf, activeTabGroup,
  recentFileTracker (lastOpenFiles), undoHistory (Mod+Shift+T), protocolHandlers, hoverLinkSources`
  （已预先注册：`editor, preview, search, graph, outline, properties, file-explorer, bases, tab-header`）。
- `requestSaveLayout` debounce 1s。Leaf：`setViewState({type, state, active, pinned, group})`、history
  back/forward（可序列化）、**deferred views**（tab 未显示时的占位符 "DeferredView"，
  经 `loadIfDeferred` 加载）、pin、group（linked panes）。

### Keymap & Scope

- 全局 Keymap，**stack** scope（`pushScope/popScope`），在 window 上 capture `keydown`；
  modifier 规范化为排序字符串 `"Alt,Ctrl,Meta,Shift"`；`"Mod"` = macOS 上的 Meta / 其他平台的 Ctrl。
  Handler 返回 `false` → `preventDefault`。
- `Scope.register(modifiers, key, func)`；scope 链式向 parent。

### Commands & HotkeyManager

- `addCommand({id, name, icon, callback | checkCallback | editorCallback | editorCheckCallback, hotkeys, ...})`。
- HotkeyManager：`defaultKeys`（来自 addCommand）+ 来自 `<configDir>/hotkeys.json` 的 `customKeys`（hot-reload）。

### 找到的全部 `trigger("...")` 事件名

```
active-leaf-change, bookmarks:bookmarks-menu, canvas:edge-menu, canvas:node-connection-drop-menu,
canvas:node-menu, canvas:selection-menu, change, changed, closed, config-changed, create, css-change,
delete, deleted, editor-change, editor-drop, editor-menu, editor-paste, editor-selection-change,
extensions-updated, file-created, file-menu, file-open, file-removed, files-menu, finished,
folder-created, folder-removed, group-change, history-change, hover-link, input, layout-change,
layout-ready, leaf-menu, markdown-properties-menu, markdown-scroll, markdown-viewport-menu, modified,
modify, navigated, new-log, options-updated, pinned-change, post-processor-change, quick-preview,
quit, raw, receive-files-menu, receive-text-menu, rename, renamed, resize, resolve, resolved,
search:results-menu, status-change, swipe, tab-group-menu, url-menu, view-changed, view-registered,
view-unregistered, webviewer:update-history, window-close, window-frame-change, window-open
```
（Vault：`create/modify/delete/rename/raw/closed/config-changed`；MetadataCache：`changed/deleted/resolve/resolved/finished`；
Workspace：`active-leaf-change/file-open/layout-change/layout-ready/css-change/resize/quick-preview/hover-link/...`）。

---

## 3. 核心插件

31 个 internal plugins。开关状态在 `core-plugins.json`（`{id: bool}`）中；缺失 key → fallback `defaultOn`。
Legacy id `starred` → `bookmarks`。

| id | 默认 | 注册的 view types | 备注 |
|---|---|---|---|
| `audio-recorder` | off | — | 将 `Recording YYYYMMDDHHmmss.<ext>` 写入 attachments |
| `backlink` | **on** | `backlink` | + "backlinks in document" |
| `bases` | **on** | `bases` (+ ext `.base`)；内部 layout `table`、`cards`、`list` | DB views |
| `bookmarks` | **on** | `bookmarks` | `bookmarks.json` |
| `canvas` | **on** | `canvas` (+ ext `.canvas`) | |
| `command-palette` | **on** | — (modal) | `recentCommands` |
| `daily-notes` | **on** | — | |
| `editor-status` | **on**（从列表隐藏） | — | status bar Editing/Reading |
| `file-explorer` | **on** | `file-explorer` | |
| `file-recovery` | **on** | — | snapshot → IndexedDB |
| `footnotes` | off | `footnotes` | footnotes 面板（1.12 新增） |
| `global-search` | **on** | `search` | |
| `graph` | **on** | `graph`, `localgraph` | |
| `markdown-importer` | off | — | |
| `note-composer` | **on** | — | extract/merge/split |
| `outgoing-link` | **on** | `outgoing-link` | |
| `outline` | **on** | `outline` | |
| `page-preview` | **on** | — | hover popover，per-source `overrides` |
| `properties` | **on** | `all-properties`, `file-properties` | |
| `publish` | off | — | |
| `random-note` | off | — | |
| `slash-command` | off | — | `/` suggest |
| `slides` | off | — | |
| `switcher` | **on** | — (modal) | |
| `sync` | **on**（未配置前 idle） | `sync` | IndexedDB `<appId>-sync` |
| `tag-pane` | **on** | `tag` | |
| `templates` | **on** | — | |
| `webviewer` | off（仅桌面端） | `webviewer`, `webviewer-history` | |
| `word-count` | **on** | — | status bar |
| `workspaces` | off | — | `workspaces.json` |
| `zk-prefixer` | off | — | Unique note creator |

### 内置 ViewRegistry（始终注册）

| view type | extensions |
|---|---|
| `markdown` | `md` |
| `image` | `bmp, png, jpg, jpeg, gif, svg, webp, avif` |
| `audio` | `mp3, wav, m4a, 3gp, flac, ogg, oga, opus` |
| `video` | `mp4, webm, ogv, mov, mkv` |
| `pdf` | `pdf` |
| `release-notes`, `empty` | — |

未注册的扩展名 → 用 OS 默认应用打开（除非 `showUnsupportedFiles`）。

---

## 4. 命令与快捷键

约 196 个 namespaced command id。`Mod` = Cmd（macOS）/ Ctrl。**加粗** = 有默认快捷键。

**App：** `app:delete-file`、**`app:go-back`**（Mod+Alt+←）、**`app:go-forward`**（Mod+Alt+→）、
`app:open-another-vault`、**`app:open-help`**（F1）、`app:open-sandbox-vault`、**`app:open-settings`**（Mod+,）、
`app:open-vault`、`app:reload`、`app:show-debug-info`、`app:show-release-notes`、`app:show-tab-switcher`、
`app:switch-vault`、`app:toggle-left-sidebar`、`app:toggle-right-sidebar`、`app:toggle-ribbon`、
`theme:switch`、`theme:toggle-light-dark`、`window:zoom-in/out`、`window:reset-zoom`、`window:toggle-always-on-top`。

**Editor：** `editor:add-cursor-above/below`、`editor:attach-file`、`editor:clear-formatting`、
`editor:cycle-list-checklist`、**`editor:delete-paragraph`**（Mod+D）、`editor:focus(-left/right/up/down)`、
`editor:fold-all/fold-less/fold-more/unfold-all`、**`editor:follow-link`**（Alt+Enter）、
`editor:insert-callout/codeblock/embed/footnote/horizontal-rule/mathblock/table/tag/wikilink`、
**`editor:insert-link`**（Mod+K）、**`editor:open-link-in-new-leaf`**（Mod+Enter）、
**`editor:open-link-in-new-split`**（Mod+Alt+Enter）、**`editor:open-link-in-new-window`**（Mod+Alt+Shift+Enter）、
**`editor:open-search`**（Mod+F）、**`editor:open-search-replace`**（Mod+H）、`editor:redo/undo`、
`editor:rename-heading`、**`editor:save-file`**（Mod+S）、`editor:set-heading(-0..6)`、`editor:swap-line-up/down`、
`editor:table-*`（行/列操作）、`editor:toggle-blockquote`、**`editor:toggle-bold`**（Mod+B）、
`editor:toggle-bullet-list`、**`editor:toggle-checklist-status`**（Mod+L）、`editor:toggle-code`、
**`editor:toggle-comments`**（Mod+/）、`editor:toggle-fold`、`editor:toggle-highlight`、
`editor:toggle-inline-math`、**`editor:toggle-italics`**（Mod+I）、`editor:toggle-line-numbers`、
`editor:toggle-numbered-list`、`editor:toggle-readable-line-length`、`editor:toggle-source`、
`editor:toggle-spellcheck`、`editor:toggle-strikethrough`、`editor:indent-list/unindent-list`、
`markdown:add-alias`、**`markdown:add-metadata-property`**（Mod+;）、`markdown:clear-metadata-properties`、
**`markdown:toggle-preview`**（Mod+E）。

**Workspace：** **`workspace:close`**（Mod+W）、`workspace:close-others`、`workspace:close-tab-group`、
**`workspace:close-window`**（Mod+Shift+W）、`workspace:copy-path/copy-full-path/copy-url`、
**`workspace:edit-file-title`**（F2）、`workspace:export-pdf`、**`workspace:goto-tab-1…8`**（Mod+1…8）、
**`workspace:goto-last-tab`**（Mod+9）、`workspace:move-to-new-window`、**`workspace:new-tab`**（Mod+T）、
`workspace:new-window`、**`workspace:next-tab`**（Ctrl+Tab；macOS 额外 Meta+Shift+]）、
**`workspace:previous-tab`**（Ctrl+Shift+Tab；macOS Meta+Shift+[）、`workspace:show-trash`（当 trashOption=local 时）、
`workspace:split-horizontal/vertical`、`workspace:toggle-pin`、`workspace:toggle-stacked-tabs`、
**`workspace:undo-close-pane`**（Mod+Shift+T）。

**Plugin：** **`command-palette:open`**（Mod+P）；**`switcher:open`**（Mod+O）；**`global-search:open`**（Mod+Shift+F）；
**`graph:open`**（Mod+G）、`graph:open-local`、`graph:animate`；**`file-explorer:new-file`**（Mod+N）、
**`file-explorer:new-file-in-new-pane`**（Mod+Shift+N）、`file-explorer:new-folder/duplicate-file/move-file/reveal-active-file`；
`backlink:open(-backlinks)`、`backlink:toggle-backlinks-in-document`；`bookmarks:open`、
`bookmarks:bookmark-current-view/-search/-section/-heading`、`bookmarks:bookmark-all-tabs`；
`canvas:new-file/convert-to-file/export-as-image/jump-to-group`；`daily-notes`、`daily-notes:goto-prev/next`；
`note-composer:extract-heading/merge-file/split-file`；`outline:open(-for-current)`；`outgoing-links:open(-for-current)`；
`properties:open(-local)`；`random-note`；`tag-pane:open`；`templates:insert-template`；
`workspaces:load/save/open-modal`；`file-recovery:open`；`open-with-default-app:open/show`；
`audio-recorder:start/stop`；`slides:start`；`sync:*`；`webviewer:*`；`bases:*`。

格式切换字符对：bold `**`（alt `__`）、italic `*`（alt `_`）、code `` ` ``、highlight `==`、
strikethrough `~~`、comment `%%`、math `$`。

自定义 Hotkey：`.obsidian/hotkeys.json` — `{ "<command-id>": [{ "modifiers": ["Mod"], "key": "F" }] }`；
**空数组 `[]` = 移除默认 hotkey**。

---

## 5. 设置 schema

单一 defaults object；保存时，属于 appearance 白名单的 key 写入 **`appearance.json`**，
其余写入 **`app.json`**。**仅写入与默认值不同的 key**（新仓库 ⇒ `{}`）。

### appearance.json

| key | type | default | 含义 |
|---|---|---|---|
| `accentColor` | string | `""` | hex；空 = 默认紫色 |
| `theme` | string | `"system"` | `"system"` \| `"obsidian"` (dark) \| `"moonstone"` (light) |
| `cssTheme` | string | `""` | `.obsidian/themes/` 中的 theme 文件夹名 |
| `enabledCssSnippets` | string[] | `[]` | `snippets/` 中的文件名（不含 `.css`） |
| `showViewHeader` | bool | `true` | |
| `showRibbon` | bool | `true` | |
| `nativeMenus` | bool\|null | `null` | |
| `translucency` | bool | `false` | |
| `textFontFamily` / `interfaceFontFamily` / `monospaceFontFamily` | string | `""` | （legacy `editorFontFamily` → `textFontFamily`） |
| `baseFontSize` | number | `16` | px |
| `baseFontSizeAction` | bool | `false` | |
| `slidingSidebar` / `floatingNavigation` / `autoFullScreen` | bool | `true` | mobile |

### app.json

| key | type | default | 含义 |
|---|---|---|---|
| `alwaysUpdateLinks` | bool | `false` | rename 时自动更新 link，不询问 |
| `spellcheck` | bool | `true` | |
| `spellcheckLanguages` | string[]\|null | `null` | |
| `readableLineLength` | bool | `true` | 限制行宽 |
| `strictLineBreaks` | bool | `false` | |
| `propertiesInDocument` | string | `"visible"` | `"visible"\|"hidden"\|"source"` |
| `showInlineTitle` | bool | `true` | |
| `showUnsupportedFiles` | bool | `false` | |
| `autoPairBrackets` / `autoPairMarkdown` | bool | `true` | |
| `smartIndentList` | bool | `true` | |
| `foldHeading` / `foldIndent` | bool | `true` | |
| `showLineNumber` | bool | `false` | |
| `showIndentGuide` | bool | `true` | |
| `useTab` | bool | `true` | |
| `tabSize` | number | `4` | |
| `rightToLeft` | bool | `false` | |
| `autoConvertHtml` | bool | `true` | 粘贴 HTML → MD |
| `vimMode` | bool | `false` | |
| `livePreview` | bool | `true` | 默认编辑模式为 LP |
| `defaultViewMode` | string | `"source"` | `"source"` (edit) \| `"preview"` (reading) |
| `useMarkdownLinks` | bool | `false` | 用 `[]()` 代替 wikilink |
| `newLinkFormat` | string | `"shortest"` | `"shortest"\|"relative"\|"absolute"` |
| `attachmentFolderPath` | string | `"/"` | `"/"`=root，`"./"`=笔记旁边，`"./sub"`=笔记旁的 subfolder，`"name"`=固定 folder |
| `newFileLocation` | string | `"root"` | `"root"\|"current"\|"folder"` |
| `newFileFolderPath` | string | `"/"` | 当 `newFileLocation==="folder"` 时使用 |
| `userIgnoreFilters` | string[]\|null | `null` | Excluded files |
| `focusNewTab` | bool | `true` | |
| `promptDelete` | bool | `true` | |
| `trashOption` | string | `"system"` | `"system"\|"local"(.trash/)\|"none"` |
| `deleteUnlinkedAttachments` | string | `"ask"` | `"ask"\|"always"\|"never"` |
| `openBehavior` | string | `""` | `"daily"` = 启动时打开 daily note |
| `pdfExportSettings` | object | `{pageSize:"Letter",landscape:false,margin:"0",downscalePercent:100}` | |
| `uriCallbacks` | bool | `false` | 允许 `hook-get-address` |

### `.obsidian/` 中的全部文件

| File | Schema |
|---|---|
| `app.json`, `appearance.json` | 如上 |
| `core-plugins.json` | `{ "<plugin-id>": bool }` |
| `community-plugins.json` | 已启用插件 id 的**数组** |
| `hotkeys.json` | `{ "<command-id>": [{modifiers, key}] }`；`[]` = 移除 default |
| `graph.json` | §13 |
| `canvas.json` | `{ "snapToObjects": bool, "snapToGrid": bool }` |
| `switcher.json` | `{ showExistingOnly:false, showAttachments:true, showAllFileTypes:false }` |
| `daily-notes.json` | `{ format:"" (moment, 默认 "YYYY-MM-DD"), folder:"", template:"" }` |
| `templates.json` | `{ folder:"", dateFormat:"" ("YYYY-MM-DD"), timeFormat:"" ("HH:mm") }` |
| `zk-prefixer.json` | `{ format:"" ("YYYYMMDDHHmm"), folder:"", template:"" }` |
| `bookmarks.json` | `{ items: [...] }` — types：`file`（`{type,ctime,path,subpath?,title?}` — heading/block bookmark 是 file+subpath）、`folder`、`group`（`{items:[...], title}` 可嵌套）、`search`（`{query}`）、`graph`（`{title, options:<同 graph.json>}`）、`url` |
| `workspace.json` / `workspace-mobile.json` | §6 |
| `workspaces.json` | `{ workspaces: { "<名称>": <完整 layout> }, active: "<名称>" }` |
| `types.json` | `{ types: { "<PropertyName>": "<widget>" } }` — widget：`text, multitext, number, checkbox, date, datetime, tags, aliases`（强制：`aliases→aliases`、`cssclasses→multitext`、`tags→tags`） |
| `snippets/` | 文件 `<name>.css` |
| `themes/<名称>/` | `manifest.json`（`{name, version, minAppVersion, author, authorUrl}`）+ `theme.css` |
| `plugins/<id>/` | `manifest.json`（`{id,name,version,minAppVersion,description,author,authorUrl,isDesktopOnly}`）、`main.js`、`styles.css`、`data.json` |
| 其他 `<plugin-id>.json` | core plugin 的 settings 遵循 `<id>.json` 模式（`backlink.json`、`note-composer.json`、`page-preview.json`、…） |

---

## 6. workspace.json

由 `Workspace.saveLayout()` 写入（debounce 1s），JSON pretty-print：

```jsonc
{
  "main":  { /* 根 split */ },
  "left":  { /* 左侧边栏 */ },
  "right": { /* 右侧边栏 */ },
  "left-ribbon": { "hiddenItems": { "<pluginId>:<Title>": false } }, // 顺序 = key 的顺序
  "floating": { "type": "floating", "children": [ /* popout 窗口 */ ] }, // 仅在有 popout 时
  "active": "<leaf id>",
  "lastOpenFiles": ["path1", "..."]
}
```

Node（均带随机 hex `id`，可选 `dimension` = flex-grow %）：
- **split**：`{id, type:"split", direction:"vertical"|"horizontal", children:[...]}`。Root 强制 `vertical`；
  sidebar `horizontal` + 额外 `width`（px）和 `collapsed: true`。
- **tabs**：`{id, type:"tabs", children:[leaf...], currentTab?: n (为 0 时省略), stacked?: true}`。
- **leaf**：`{id, type:"leaf", state:{type:"<viewType>", state:{file, mode:"source"|"preview", source:bool, ...}, pinned?, icon, title}, group?, pinned?}`
  —— `icon`/`title` 保存以便 deferred view 绘制 tab header 而无需初始化 view。Leaf history
  （back/forward）也为 undo-close 序列化。
- **window**（floating 内）：`{id, type:"window", children, x, y, width, height, maximize, zoom}`。

反序列化规则：直接位于 split 下的裸 leaf → 自动包进 `tabs`；空容器被裁剪；未知 view type
→ 占位符 "plugin missing"；缺少 `main` → 新的 tabs+empty leaf，重新打开 `lastOpenFiles[0]`。

search view state 示例（live）：`{"type":"search","state":{"query":"...","matchingCase":false,"explainSearch":false,"collapseAll":false,"extraContext":false,"sortOrder":"alphabeticalReverse"}}`。

---

## 7. Markdown 方言

reading-view/metadata 解析器 = fork **remark**，配置 `{breaks: true, commonmark: true}` ——
**单个换行渲染为 `<br>`**。同一解析器代码复制在 `worker.js` 中。
Editor 使用 **HyperMD** stream 模式（CM5 风格）适配到 CM6，options：
`{front_matter, math, table, toc, hashtag, fencedCodeBlockHighlighting, highlightFormatting, taskLists,
strikethrough, highlight, headers, blockquotes, indentedCode, lists, hr, blockId: true; emoji: false}`。

### Wikilink 与 embed

- 内联正则（优先于 `link`）：locator `/!?\[\[/g`，match **`/^(!?)\[\[(.+?)]]/`**。
  内容 `.trim()`；**若包含嵌套 `[[` 则丢弃**。`!` → embed（`<span class="internal-embed" src alt>`），
  否则 → `<a class="internal-link" href data-href>`。
- 拆分 alias：alias = 第一个 `|` 之后（index > 0），trim；href = `|` 之前，strip 末尾 `\`，然后
  `href.replace(/ /g," ").trim().normalize("NFC")`。
- **默认 display text**（无 alias）：`href.split("#").filter(Boolean).join(" > ")` ——
  `[[Note#Head]]` 显示为 `Note > Head`。有 alias 的 link 额外加 `aria-label` = 默认 display。
- Subpath：在第一个 `#` 处拆分 → `{path, subpath}`。`#^` = block，`#[^` = footnote，其余为 heading；
  多级 heading `#H1#H2` 依次解析。
- **图片 size param**：alt 的最后一个 `|` 段匹配 `/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/` →
  attr `width`(/`height`)，从 alt 中移除。适用于 `![[img|300]]`、`![[img|300x200]]`、`![alt|300](url)`。
- 可 embed 的扩展名：图片/audio/video/pdf（表 §3）+ `md`、`canvas`、`base`。PDF 支持 `#page=N`
  （`&selection=...`、`&annotation=ID`）。
- 指向仓库内部的 Markdown link `[]()` → 转换为相同的 ilink/iembed node（decodeURI + NFC）。
- link text 中**禁止的字符**：`#^[]|`；文件名中禁止：（Win）`*"\/<>:|?`，（其他）`\/:`。

### Block ID `^id`

- Inline：`/^\^([a-zA-Z0-9\-]+)$/`（前面必须是 whitespace，且必须结束 run）。
- 段落末尾：`/^\^([a-zA-Z0-9\-]+)(?=$|\n$|\n\n)/` —— 独占一行的 id 附着到**前一个** block。
- **Charset 仅 `[a-zA-Z0-9-]`。** 缓存 key 为 lowercase。
- **自动生成**：6 个随机 hex，将 `#^<id>` 插入 link、` ^<id>` 插入行尾。

### 标签

- reading/metadata 正则：**`/^#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]+/`**
  （前面必须是 whitespace/文本开头）；**若纯数字则丢弃** `/^#\d+$/`。渲染 `<a class="tag" href="#tag">`。
- Editor 额外要求至少包含 1 个字母（`/[a-z]/i`）。
- 允许：字母、数字、`_`、`-`、`/`（嵌套 `a/b`）、emoji、non-ASCII。
- frontmatter 标签：key `/^tags$/i`（迁移 `tag`），string 按 `/[ ,\n]/` 拆分，丢弃含空格的 entry，自动加 `#`。

### Callout

- 正则（blockquote 首行，editor 与 reading 均是）：**`/^\[!([^\]]+)\]([+\-]?)(?:\s|$)/`**
  - Group 1 在第一个 `|` 处拆分：前 = type，后 = metadata（`data-callout-metadata`）。
  - 规范化 type：`.trim().toLowerCase().replace(/\s+/g,"-")`。
  - Group 2：`+` 默认可折叠展开，`-` 默认折叠，空 = 不 fold。
- DOM：`div.callout[data-callout][data-callout-fold][data-callout-metadata]` →
  `div.callout-title`（`div.callout-icon` + `div.callout-title-inner`）+ `div.callout-content`。
- 默认 Title：type 将 `-`→space，首字母大写。Title = 首行剩余部分。
- 自定义颜色：data 中 `#rgb/#rrggbb` 形式的 `color` → inline `--callout-color: "r,g,b"`。
- 完整 type 表：§21。

### Frontmatter / Properties

- Block tokenizer `onlyAtStart`：document 必须精确以 `---\n` 开头；结束 `---` 必须在 `\n` 之后；
  用 yaml lib 解析；仅当是 plain object 时保留。
- 保留 key（强制 widget）：`aliases → aliases`、`cssclasses → multitext`、`tags → tags`。
  迁移（不区分大小写）：`tag→tags`、`alias→aliases`、`cssclass→cssclasses`；string 按 `/[ ,\n]/` 拆分；
  含空格的 `cssclasses` entry 被丢弃。
- **类型推断**：`null→text`；string 匹配 `/^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/`→`datetime`，
  `/^\d{4}-[01]\d-[0-3]\d$/`→`date`，其余 `text`；number→`number`；boolean→`checkbox`；
  array→`multitext`；其他→`unknown`。
- datetime 显示格式接受：`YYYY-MM-DD[T]HH:mm:ss`、`YYYY-MM-DD[T]HH:mm`、
  `YYYY-MM-DD HH:mm:ss`、`YYYY-MM-DD HH:mm`。
- 用户指定的 type 保存在 `.obsidian/types.json`（watch + hot reload）。

### 其他内联

- **Highlight** `==...==`：以 `==` 开始且其后不跟 whitespace，且不是 `====`；在下一个 `==` 结束 → `<mark>`。
- **Strikethrough** `~~...~~`（GFM）。
- **Comment** `%%...%%`：inline `/^%%(.+?)%%/` —— 被**从 output 中丢弃**；block-level `%%` fence 按行。
- **Footnote**：ref `[^id]` → `<sup class="footnote-ref" data-footnote-id="fnref-N">`（按顺序编号，
  重复 ref 用 `-k`）；definition `[^id]: ...`（下一行 indent 4 space/tab）；**inline `^[note]`**
  （scan 转义 `\\` + 计数嵌套 `[`）。Editor footref 正则：`/^\[\^([^\]\s]*?)\](:?)/`。
- **Math**：字符 scan（非单一 regex）：`\$` 转义；inline `$...$` —— 开头后不能跟 space/tab，
  结尾前不能有 space/tab 且不能紧接数字；`$$...$$` block。渲染 **MathJax**（lazy）。
- **Code fence**：``` 或 `~~~`；info-string `/^\s*(~~~+|```+)[ \t]*([\w\/+#-]*)[^\n`]*$/`；
  渲染 `<pre><code class="language-X">` + **Prism**（lazy）。支持 indented code。
- **Mermaid**：fence lang 精确为 `"mermaid"` → lazy load，渲染到 `div.mermaid`；含 internal link 的 label
  会被后处理为 `a.internal-link`。
- **HTML**：允许但**每个 section 都经过 DOMPurify**，配置：
  `{ALLOW_UNKNOWN_PROTOCOLS:true, RETURN_DOM_FRAGMENT:true, FORBID_TAGS:["style"], ADD_TAGS:["iframe"],
  ADD_ATTR:["frameborder","allowfullscreen","allow","sandbox","data-tooltip-position"]}`。
  Hook：所有 `<a>` → `target="_blank" rel="noopener nofollow"`；所有 `<iframe>` 强制
  `sandbox="allow-forms allow-modals allow-presentation allow-same-origin allow-scripts"`。
- **External link**：`class="external-link" target="_blank" rel="noopener nofollow"`。

### 任务列表

- list item 以 `[c]` 开头，`c` 为**任意 1 个字符**：`checked = c !== " "`；DOM
  `li.task-list-item[data-task="c"]`（+ `.is-checked`）包含 `input.task-list-item-checkbox`。
- **没有硬编码的 custom state 列表** —— `/ - > < ? !...` 等 state 是 theme 约定
  （core CSS 仅 style `data-task="x"|"X"`）。点击 checkbox 切换 `" "` ↔ `"x"`；
  Mod+L 通过正则 `/\[.\]/` 循环。

---

## 8. 链接解析与 MetadataCache

### `getFirstLinkpathDest(linkpath, sourcePath)` —— 分步规则

1. Linkpath 为空 + 有 sourcePath ⇒ 源文件本身（self-link `[[#heading]]`）。
2. Lowercase linkpath；取 basename；若有 `.` → 查 `uniqueFileLookup`（multi-map key =
   **含扩展名的 filename lowercase**）。未命中 → 尝试 `linkpath + ".md"`。仍未命中 ⇒ unresolved。
3. Linkpath 无 folder + 恰好 1 个候选 ⇒ 完成（shortest path happy case）。
4. 前缀 `./` / `../`：按 `dirname(sourcePath)` 解析，仅接受精确 path match。
5. 前缀 `/` ⇒ vault-absolute：仅匹配精确 full path。
6. 其余：full-path match 优先；否则，收集所有 path lowercase **以** linkpath **结尾**的候选，
   分成 2 组（与源同 folder 优先），每组**按 path 长度升序 sort**，再拼接。

- **一切均不区分大小写**；平局 → "同 folder 优先，然后 shortest path"。
- unresolved key 通过 strip 末尾 `.md` 规范化。
- `fileToLinktext` 按 `newLinkFormat`：absolute = full path（去掉 `.md`）；relative = 从源 folder 出发的 `../` path；
  shortest = basename，但若 basename 反向解析不指向正确 target → fallback full path。
- 插入 link 的 heading 会被 sanitize：`heading.replace(/([:#|^\\\r\n]|%%|\[\[|]])/g," ").replace(/\s+/g," ").trim()`。

### CachedMetadata 结构（worker.js）

Position 处处为：`{line: 0-based, col: 0-based, offset: 0-based}`；`position = {start, end}`。

```js
{
  frontmatter?: object,
  frontmatterPosition?: Pos,
  frontmatterLinks?: [{key:"prop"|"prop.0", link, original, displayText}],
  links?:    [{position, link, original, displayText}],
  embeds?:   [{position, link, original, displayText}],
  tags?:     [{position, tag /* 含 # */}],
  headings?: [{position, heading /* 原始文本 */, level}],
  footnotes?: [{position, id}], footnoteRefs?: [{position, id}],
  referenceLinks?: [{position, id, link}],
  sections?: [{type /* paragraph|heading|list|code|blockquote|callout|yaml|... */, position, id? /* 块 id */}],
  listItems?: [{position, parent /* 父项的 1-based 行号；负数 = 根列表 */, task? /* [c] 字符 */, id?}],
  blocks?:   { [idLowercase]: {position, id} }
}
```
空数组被删除。

`resolveSubpath(cache, subpath)`：split `#`，丢弃空。`^id` ⇒ block（id 不区分大小写匹配，也查找
匹配的 listItem）；`[^id]` ⇒ footnote；其余依次 walk heading —— 通过
`h.replace(/[!"#$%&()*+,.:;<=>?@^`{|}~\/\[\]\\\r\n]/g," ").replace(/\s+/g," ").trim()` lowercase 比较，
后一个 heading 必须比前一个更深；返回 `{type:"heading", current, next, start, end}`。

---

## 9. Editor

### Stack

- **CodeMirror 6** 打包在 app.js 中（`@codemirror/state|view|language|commands|search|autocomplete|collab|lint`、
  `@lezer/*`）—— module map 暴露给插件。
- Editor 中的 Markdown **不是** Lezer-markdown，而是适配到 CM6 的 **HyperMD stream mode**。
- Root editor：class `markdown-source-view cm-s-obsidian mod-cm6` + LP 启用时的 `is-live-preview`。

### Live Preview —— 机制

- 一个 CM6 StateField/decoration set 遍历 visible 行的 token。暴露 syntax 的 predicate：
  **若任何 selection range 触及 token range → 显示 raw source**；否则 formatting 字符被
  `Decoration.replace` 隐藏，link 变为 `Decoration.mark({class:"cm-underline"})`，embed/图片/math/
  code-block/HR/callout/table 变为 block 或 inline **widget**。Widget 按 `sourcePath`+`href` recycle。
- 被视为“需要暴露 formatting 上下文”的 inline node：
  `["em","strong","inline-code","strikethrough","highlight","link","image","hmd-internal-link","hmd-embed","formatting-link","footref"]`。
- Toggle：`editor:toggle-source`（edit view 中 LP ↔ raw source）；`markdown:toggle-preview` Mod+E
  （edit ↔ reading）。per-leaf view state：`state.mode`（`source`/`preview`）+ `state.source`（bool，LP 或 raw）。
- **Vim**：完整移植打包的 codemirror-vim（`.cm-vimMode`、fat cursor、面板 `:` 命令）。

### Suggesters

| Trigger | 条件 | 行为 |
|---|---|---|
| `[[` link | 到 cursor 的该行 text 上 `lastIndexOf("[[") > lastIndexOf("]")` | query 为 `[[` 之后；有 `#` → heading mode，`#^` → block mode；结尾 `\|` → display-text mode；默认在所有 linkable 文件 + frontmatter alias 上 fuzzy（alias 带图标 `lucide-forward`）。`![[` 同理，自动补 `!` |
| `#` tag | `/(^|\s)#[^...charset tag...]*$/g` 且 cursor 后字符不是 `#` | 建议已有 tag，Tab 完成 |
| `[^` footnote | `/(?:^|[^\[])(\[\^)([^\]]*)$/`（若是 definition 则跳过） | |
| `/` slash | `/(^|\s)\/([^\s\/]*)$/`（插件 `slash-command`，默认 off） | 运行 command |
| Property | Properties UI 中 | fuzzy property 名（带 type 图标）；value 按 widget |

### Fuzzy search（`prepareQuery` / `fuzzySearch`）—— 精确算法

- `prepareQuery`：lowercase；`tokens` = 按 whitespace 拆分，每个 punctuation 字符
  （`/[ -⁯⸀-⹿\\'!"#$%&()*+,\-.\/:;<=>?@\[\]^_`{|}~]/`）和每个 CJK 字符
  （`/[ༀ-࿿぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/`）是独立 token；
  `fuzzy` = 每个 non-space 字符。
- `fuzzySearch`：（1）尝试 **token pass** —— 每个 token 从上一个 match 末尾开始按顺序 `indexOf`；match
  从词中间开始（非 word-boundary/camelCase）→ penalty 计数器 +1；（2）未命中 → **per-char
  fuzzy pass** —— 每个字符按顺序出现，仅当紧邻上一个 match 时才允许词中 match。
- **分数**（0 为完美，越负越差）：
  ```
  score = 0 − max(0, numRanges − 1)            // 分片
            − midWordPenalties / 10
            − (matchSpan − queryLen) / 100      // span 内的离散度
            − firstMatchOffset / 1000           // 匹配越早越好
            − targetLen / 10000                 // 目标越短越优
  ```
- `prepareSimpleSearch`：split space，所有词都必须出现（substring），同一分数公式，无 boundary penalty。
- Filename search：先尝试 basename；仅 match full path → **分数 −1**。

---

## 10. 阅读视图

- 渲染 **每个 top-level mdast node 为一个独立 section**（HTML 字符串；heading 带 `depth` 以便 fold）。
  Section 保存 `{html, pos, level}`。
- 每个 section：wrapper 上 `el.appendChild(DOMPurify.sanitize(html, config §7))` + class `el-<tagName>`。
- **虚拟化（virtualized）**：section 被测量；隐藏已折叠 heading 下的 section；仅 attach 靠近
  viewport 的 section；按 queue 渲染并 **recycle**（复用 `.internal-embed.is-loaded`，匹配 src/width/height/alt）。
- **Post-processor pipeline**：`registerPostProcessor(fn, sortOrder)`，按 `sortOrder||0` 升序 sort，
  运行 `fn(sectionEl, context)`（返回 Promise）。内置（order 0，按注册顺序）：resolver
  internal-link、tag link、embed、wiring checkbox、wiring callout icon/fold、包装 table RTL/scroll、
  处理图片、code copy 按钮、Prism、mermaid、block `query`、footnote backref。
- **Internal link**：anchor 带 `data-href`，class `internal-link`（+ 经
  `metadataCache.isUnresolved` 的 `is-unresolved`）。点击：`openLinkText(href, sourcePath, Keymap.isModEvent(e))` ——
  Mod = 新 tab，Mod+Alt = split，Mod+Alt+Shift = 新 window。`mouseover` → trigger
  `hover-link`（page preview）。
- **Heading**：带 `data-heading` = 原始源 text。subpath 导航用 `resolveSubpath` + scroll
  （不使用 URL fragment）。
- **Embed**：查找 `.internal-embed:not(.is-loaded)`，经 WeakMap 做 depth tracking 加载 ——
  **嵌套 depth 上限 ≤ 5**，超出 → 渲染 fallback link。Embed markdown 会再次进入该 renderer。

---

## 11. 全局搜索

### 架构

- **没有 inverted index** —— search 是对 `vault.getFiles()` 的**线性 scan**（可取消的 async queue），
  跳过 Excluded files；仅当 query 需要 content 时才 `cachedRead` `md`/`canvas` 文件。运行在 **main thread**
  （worker.js 仅作 metadata parser）。Tag/heading/listItem/frontmatter offset 来自 metadata cache。
- `.canvas` 文件：query 在所有 `type:"text"` node 的 text 上运行（结果 key 为 `canvas-<nodeId>`）+ filename；
  canvas 插件保留 per-node metadata cache，因此 `tag:`/`task:` 在 card 中生效。

### Tokenizer

Token：`quote`（`"..."` 转义 `\"`）、`regex`（`/.../` 转义 `\/`）、`not`（`-`）、`bracket` `[` `]`、
`parenthesis` `(` `)`、`colon` `:`、`greaterthan` `>`、`lessthan` `<`、按 space 拆分的裸 text。
大写正确的裸词 `OR`、`TRUE`、`FALSE`、`EMPTY` 成为独立 token。

### 文法

```
query      := andGroup (OR andGroup)*       // AND（空格）比 OR 结合更紧
andGroup   := primary+
primary    := operator ":" primary          // file:foo
            | "[" query (":" query)? "]"    // [name] 或 [name:value]
            | "-" primary                   // 否定
            | ">" primary | "<" primary     // 比较（在 [prop:>x] 中）
            | "(" query ")"
            | TRUE | FALSE | EMPTY
            | text | "phrase" | /regex/
```
- 未知 operator 在 `:` 前 → 错误 `Operator "x" not recognized`。
- "exclusive" operator 不能嵌套（如 `line:(file:x)` 报错），但 `section:` 可自嵌套。
  `match-case:`/`ignore-case:` 可自由嵌套。`[prop]` 不能嵌套在 `[...]` 中。

### 匹配语义

- **裸 text**：substring（regex-escaped），flags `gmi`（不区分大小写）/ `gm`（区分）。
  默认 key：`filename`（md/canvas/base）+ `content`（md）。
- **"Phrase"**：在 `content` 上用两端 word-boundary（若首/尾是 word 字符）；在
  `filename`/`filepath` 上普通 substring；在 propertyName 上 = 不区分大小写相等比较。
- **Regex**：原样 compile，丢弃长度为 0 的 match。
- Match 返回已按 key 合并排序的 offset 对 `[start,end]`。

### 完整 operator 表

| Operator | 行为 |
|---|---|
| `match-case:X` / `ignore-case:X` | 强制子表达式的 case |
| `path:X` | match full path（exclusive） |
| `file:X` | match filename（exclusive） |
| `content:X` | 仅 body（exclusive） |
| `line:X` | sub-query 必须在**1 行**内 match |
| `block:X` | 在 1 个 block 内（来自 cache 的 sections + listItems） |
| `section:X` | 在 1 个 section 内（heading 之间）；可自嵌套 |
| `task:X` | 在 task item 内；`task:""` = 所有 task |
| `task-todo:X` | task status `" "` |
| `task-done:X` | task status ≠ `" "`（**任何 non-space 字符都算 done**） |
| `tag:X` | 来自 cache + frontmatter 的 tag；自动加 `#`；match `^tag($|/)` 不区分大小写（`tag:#a` 匹配 `#a/b`） |
| `[name]` | 有匹配名称的 property |
| `[name:value]` | 名称 AND 值 match（array：任意元素）；value 支持 TRUE/FALSE/EMPTY/quote/regex/`>`/`<` |

### View state、sort、context

- Sort（与 file explorer 共用）：`alphabetical`、`alphabeticalReverse`、`byModifiedTime`、
  `byModifiedTimeReverse`、`byCreatedTime`、`byCreatedTimeReverse`。**没有按 relevance 排序。**
- **默认 context**：将 match 扩展到行边界，两侧最多 **100 字符**（截断 → `…`）；
  window 内重叠的 match 合并为 1 行结果。
- **Extra context**：list item 内的 match → 整个 subtree item；section 内 → 整个 section；其余
  两侧最多 1000 字符，以空行/heading 为界。
- 用 span `search-result-file-matched-text` 高亮；query 历史：localStorage `recent-searches`。

---

## 12. Quick Switcher

Settings `switcher.json`：`{showExistingOnly:false, showAttachments:true, showAllFileTypes:false}`。
上限 **20** 个建议；`Shift+Enter` 创建 note；`Tab` autocomplete path。

建议来源：
1. Query 为空 → recent files（不评分）。
2. **File**：match target = `去掉 .md 的 path`；先尝试 **basename**，失败 → full path + **分数 −1**。
3. frontmatter **Alias**（始终启用）→ `{type:"alias", alias, file}`。
4. **Unresolved links**（除非 `showExistingOnly`）→ 选中 = 创建 note。
5. **Bookmarks**（若启用）：match `groupPath + title`；非 file bookmark 也显示。
6. **Heading 不在 switcher 中。**
7. 匹配 Excluded files 的文件 → **分数 −10** + class `mod-downranked`。
8. 按分数降序 sort；**≥ 10000 文件**时从 fuzzy 切换为 simple word search。

---

## 13. 关系图谱视图

### Engine

- **Render**：PixiJS 渲染到 `<canvas>`；颜色通过 probe div 从 CSS 读取
  （`graph-view color-fill`、`color-fill-focused`、`color-fill-tag`、`color-fill-unresolved`、
  `color-fill-attachment`、`color-arrow`、`color-circle`、`color-line`、`color-text`、
  `color-fill-highlight`、`color-line-highlight`）读取 computed `color`+`opacity`。
- **Physics**：worker `sim.js` —— fork **d3-force**（forceX/Y + forceLink + forceManyBody + forceCollide，
  Barnes-Hut quadtree），带 **WASM fast path**，fallback JS。

### 协议与 sim.js 常量

Message 输入：`{nodes: {id: [x,y]|null}, links: [[src,dst],...], forceNode: {id,x,y}|null (拖拽时 pin),
forces: {centerStrength, linkStrength, linkDistance, repelStrength}, alpha, alphaTarget, run}`。

默认值：`alpha=1`、`alphaDecay = 1 − 0.001^(1/300)`（约 300 tick）、`alphaMin=0.001`（低于即停止）、
`centerStrength=0.1`、`linkStrength=1`、`linkDistance=250`、`repel=-1000`、**`velocityDecay=0.6`**、约 60fps。

Forces：`forceX(0)`+`forceY(0)` strength = centerStrength（**不是** d3 forceCenter）；
`forceLink.distance(linkDistance)`，strength = linkStrength × d3 default（`1/min(degree(src),degree(dst))`）；
`forceManyBody.strength(repel).distanceMin(30)` —— app 发送 `repel = −(slider³)`；
`forceCollide(radius=60, strength=0.5)`。新数据以 `alpha: 0.3` reheat。
Output：每个 tick transferable 的 Float32 positions。

### graph.json —— 完整 schema

```jsonc
{
  "collapse-filter": false,        // Filters 区块是否折叠（生成 "collapse-"+sectionId：
  "search": "",                    //   filter|color-groups|display|forces)
  "showTags": false,               // 默认 false
  "showAttachments": false,        // 默认 false
  "hideUnresolved": false,         // 默认 false
  "showOrphans": true,             // 默认 true
  "collapse-color-groups": false,
  "colorGroups": [ { "query": "...", "color": { "a": 1, "rgb": 16711680 } } ],
  "collapse-display": false,
  "showArrow": false,
  "textFadeMultiplier": 0,         // 滑块 -3..3，步长 0.1
  "nodeSizeMultiplier": 1,         // 滑块 0.1..5
  "lineSizeMultiplier": 1,         // 滑块 0.1..5
  "collapse-forces": false,
  "centerStrength": 0.5187...,     // 滑块 0..1；默认 = inverse-curve(0.1) ≈ 0.5187
  "repelStrength": 10,             // 滑块 0..20；worker 接收 -(v³)
  "linkStrength": 1,               // 滑块 0..1；worker 接收 curve(v)
  "linkDistance": 250,             // 滑块 30..500，原始值
  "scale": 0.0289,                 // 已保存的缩放级别（clamp 1/128..8）
  "close": true                    // 控制面板是否关闭
}
```
**Slider 曲线**：保存的值是 slider 位置；worker 对 centerStrength/linkStrength 收到
`curve(v, 0.01) = (0.01^(1−v) − 0.01)/(1 − 0.01)`（exponential，
curve(0)=0，curve(1)=1）；repel 收到 `−v³`。

### 构建 graph、node 大小、颜色

- Node = 已缓存的文件（+ tag node 若 `showTags`；attachment；unresolved）。Edge 来自
  `metadataCache.resolvedLinks`（+ unresolved 若显示）。Excluded files 被跳过。
- **Color groups**：**按数组顺序评估，第一个 match 胜出**。
- **Node 颜色顺序**：focused（hover/selected，若 CSS alpha>0）→ group color → tag → unresolved →
  attachment → 默认 fill。
- **Node 半径**：`nodeSizeMult × clamp(3·sqrt(weight+1), 8, 30)` —— `weight` = 正向+反向 link 数
  （global）或 BFS 权重（local）。
- **Text fade**：`textAlpha = clamp(log2(scale) + 1 − textFadeMultiplier, 0, 1)`；label scale = `sqrt(1/scale)`。
- **Zoom**：clamp `[1/128, 8]`，每帧指数 lerp 0.85。
- **Animate（timelapse）**：按 `min(ctime,mtime)` 重新添加 node。
- **Local graph** 默认值：`{showAttachments:false, hideUnresolved:false, showOrphans:true, showTags:false,
  localJumps:1 (slider 1..5), localInterlinks:false, localForelinks:true, localBacklinks:true}` ——
  从源文件 BFS，源 weight 30 随 hop 递减；保存在 view state，不写入 graph.json。

---

## 14. 白板

### `.canvas` 格式（JSON Canvas）

顶层：`{ "nodes": [...], "edges": [...] }` —— 未知 key 保留 round-trip（`unknownData`）。

**通用 Node**：`{ "id": "<16 hex>", "x": int, "y": int, "width": int, "height": int, "color"?: string }`
—— 坐标/尺寸**取整为 int**；`color` 为空时省略；值 `"1"`..`"6"`
（1 红，2 橙，3 黄，4 绿，5 cyan，6 紫 —— CSS `--canvas-color-N`）**或** `"#RRGGBB"`
（legacy `"r,g,b"` 加载时转换为 hex）。

| type | 额外 field |
|---|---|
| `"text"` | `"text": "<markdown>"` |
| `"file"` | `"file": "<vault path>", "subpath"?: "#Heading" \| "#^block"`（空时省略） |
| `"link"` | `"url": "https://..."`（渲染 webview） |
| `"group"` | `"label"?: string, "background"?: "<vault image path>", "backgroundStyle"?: "ratio"\|"repeat"`（默认 `"cover"` 时省略） |

**Edge**：
```json
{ "id": "<hex>", "fromNode": "<nodeId>", "fromSide": "top|right|bottom|left",
  "fromEnd": "none|arrow",   // 为 "none" 时省略（默认）
  "toNode": "<nodeId>", "toSide": "top|right|bottom|left",
  "toEnd": "none|arrow",     // 为 "arrow" 时省略（默认）
  "color"?: "1".."6"|"#hex", "label"?: "text" }
```
Side 缺失时由两 node 的相对位置自动计算。

### 行为

- Group 拖拽时带动内部 node；group label 可搜索。
- Text node → "Convert to file" 变为 `.md` 文件 node。
- **Viewport（zoom/pan）不在文件中** —— 保存在每仓库的 localStorage `canvas-<filepath>`。
- 插件设置 `.obsidian/canvas.json`：`{snapToObjects:true, snapToGrid:true}`。
- Text node 会被索引供全局搜索。

---

## 15. Bases

`.base` = **YAML**。空文件 → 1 个名为 "Table" 的 `table` view。未知 key 保留在 `unrecognizedData` 中。

```yaml
filters:            # 全局 filter：formula 字符串 或 {and:[...]}、{or:[...]}、{not:[...]}（递归，每个对象恰好 1 个 key）
  and:
    - 'status != "done"'
    - or:
        - file.hasTag("project")
        - note.priority > 2
formulas:           # 名称 -> formula 字符串
  ppu: "(price / age).toFixed(2)"
properties:         # 每个 property 的配置
  note.price:
    displayName: Price
newItemFolder: "x"
newItemTemplate: "t.md"
views:              # 数组；第一个 view 为默认
  - type: table     # 必填；types："table"、"cards"、"list"（插件可扩展）
    name: My view   # 必填，不能为空
    filters: ...    # 与全局相同的 and/or/not 形状，作用域为当前 view
    order: [file.name, note.price]        # 列顺序（property ids）
    sort: [{property: note.price, direction: DESC}]   # ASC|DESC
    groupBy: {property: note.status, direction: ASC}
    summaries: {note.price: "Average"}
    limit: 10
```

**Property id 命名空间**：裸 `name` → `note.name`（frontmatter）；前缀 `file.`（文件 metadata：
name、path、size、mtime、tags…）、`formula.`（在 `formulas` 中定义）、`note.`（frontmatter）。
filter 字符串是 formula 表达式（`file.hasTag(...)`、比较运算符、`.toFixed()`…）。
active view 是 ephemeral（workspace），不保存到文件。

---

## 16. Daily notes / Templates

**Template 变量引擎**（共用）：替换 `{{key}}`（**不区分大小写**），然后替换 `{{date}}` / `{{time}}` /
`{{date:FORMAT}}` / `{{time:FORMAT}}`，使用 1 个 `moment()` snapshot；默认 `date → "YYYY-MM-DD"`、
`time → "HH:mm"`，可通过 options `{dateFormat, timeFormat}` 覆盖。

- **Daily notes**：名称 = `moment().format(format || "YYYY-MM-DD")`；folder = option，fallback
  newFileLocation；template 用 `{title: <日期字符串>}` 展开。`openBehavior:"daily"` 在启动时打开。
- **Templates**：选择 `folder` 下的文件；提供 `{{title}}`（active 文件的 basename）、`{{date}}`、`{{time}}`。
- **Note composer**：merge/extract template 支持 `{{fromTitle}}`、`{{newTitle}}`、`{{content}}`
  （缺失时自动 append `\n\n{{content}}`）。
- **Unique note creator（zk-prefixer）**：名称 = `moment().format(format || "YYYYMMDDHHmm")`；防重复：
  若有文件以生成的字符串开头 → 按 `m,h,d,w,M,y` 中最小单位递增时间
  以改变 format 字符串，直至 unique；以 rename 模式打开并将 cursor 置于该处。

---

## 17. 文件处理

- **Attachments** —— `getAvailablePathForAttachments(name, ext, sourceFile)` 按 `attachmentFolderPath`：
  `"."`/`"./"` → note 的父 folder；`"./sub"` → `<noteParent>/sub`；其余 = 字面 path；
  folder 自动创建（先做不区分大小写查找）；filename sanitize + 截断 250 字符；重复 → 后缀
  `name 1.ext`、`name 2.ext`… 用于 paste/drop、audio recorder、下载 URL（extension 来自 content-type）。
- **Rename + update link**：`renameFile` 包在 `runAsyncLinkUpdate` 中 —— 等待 metadata cache 干净，
  **snapshot 所有已 resolve 的 ref**（`iterateAllRefs`），执行 rename，然后重写受影响源文件中的
  wikilink/mdlink（经 `fileToLinktext` 按 `newLinkFormat`/`useMarkdownLinks` 重新生成）；
  rename heading/block 走 updater `renameSubpath`。`alwaysUpdateLinks:false` → 询问用户。
- **Delete**：按 `promptDelete` confirm（dialog 同时处理 `deleteUnlinkedAttachments` —— 一并删除
  仅被该被删 note 引用的 attachment）。目标按 `trashOption`：`system` → OS trash
  （失败时 fallback local）、`local` → `<vault>/.trash/`（防重后缀）、`none` → 彻底删除。
- **File recovery**：IndexedDB **`<appId>-backup`** v1，store `backups`（autoIncrement，
  index `path`、`ts`），record `{path, ts, data}`。vault `modify`、`file-open`、`create` 时触发；
  resave timer 60s，每小时 cleanup（option：interval 分钟 + retention 天）。UI diff snapshot。
- **外部 Watch**：`fs.watch` 递归（+ configDir 的隐藏 watch）；`.obsidian/*.json` 变化 → hot-reload。

---

## 18. 每设备状态

`loadLocalStorage(k)` = `JSON.parse(localStorage["<appId>-" + k])` —— **per-vault per-device**。

per-vault key（前缀 `<appId>-`）：`config`（替代 configDir 名称）、`note-fold-<path>`（fold state，
删除文件时清理）、`tag-pane-fold`、`canvas-<path>`（canvas viewport）、`recent-searches`、
`recent-commands`、`page-preview-unfold-properties`、`last-plugin-update-check`、
`enable-plugin-<appId>`（"true" = 关闭 restricted mode）。

全局 key：`theme`、`local-themes`、`communityPluginSortOrder`、`communityThemeSortOrder`、
`most-recently-installed-version`、`spellcheck-languages`、`vim`、`mobile-selected-vault`、
`history-show-diff`、`MathJax-Menu-Settings`。

IndexedDB：
| DB | version | stores | 用途 |
|---|---|---|---|
| `<appId>-cache` | 19 | `file`, `metadata` | metadata index（§8） |
| `<appId>-backup` | 1 | `backups` | File Recovery |
| `<appId>-sync` | 1 | `data` | Sync（Sync 关闭 30s 后删除） |
| `<appId>-webview` | 1 | `icons`, `history` | Web Viewer |

---

## 19. CSS 主题

`app.css` 约 20,600 行。**层级架构：**
1. `:root` —— 仅 heading weights（以便 theme override）：`--h1-weight:700`，h2..h6 600
   （variable fonts：700/680/660/640/620/600）。
2. **`body`** —— 主 token 块（约 840 行）：所有 component variable + "Color mappings"，将语义 token
   映射到 `--color-base-*` ramp。
3. `.theme-light` / `.theme-dark`（在 `<body>` 上）—— 定义真实 palette + 少量 dark override。
4. `body` 继续 —— font stacks + `--font-text-size: 16px`。

> **specificity 经验：** token 放在 `body`（不是 `:root`），palette 放在
> `body.theme-light/.theme-dark` —— 社区 theme/snippet 依赖这一确切顺序。

### Accent system

```css
--accent-h: 258; --accent-s: 88%; --accent-l: 66%;  /* 默认紫色 ≈ #8a5cf5 */
--color-accent: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
/* 亮色 */ --color-accent-1: hsl(calc(h−1), calc(s*1.01), calc(l*1.075)); --color-accent-2: hsl(calc(h−3), calc(s*1.02), calc(l*1.15));
/* 暗色  */ --color-accent-1: hsl(calc(h−3), calc(s*1.02), calc(l*1.15));  --color-accent-2: hsl(calc(h−5), calc(s*1.05), calc(l*1.29));
--text-accent: var(--color-accent) /* 暗色：accent-1 */;
--interactive-accent: var(--color-accent-1) /* 暗色：accent */;
--interactive-accent-hover: var(--color-accent-2) /* 暗色：accent-1 */;
```

### Color ramp

| Var | Light | Dark |
|---|---|---|
| `--color-base-00` | `#ffffff` | `#1e1e1e` |
| `--color-base-05` | `#fcfcfc` | `#212121` |
| `--color-base-10` | `#fafafa` | `#242424` |
| `--color-base-20` | `#f6f6f6` | `#262626` |
| `--color-base-25` | `#e3e3e3` | `#2a2a2a` |
| `--color-base-30` | `#e0e0e0` | `#363636` |
| `--color-base-35` | `#d4d4d4` | `#3f3f3f` |
| `--color-base-40` | `#bdbdbd` | `#555555` |
| `--color-base-50` | `#ababab` | `#666666` |
| `--color-base-60` | `#707070` | `#999999` |
| `--color-base-70` | `#5c5c5c` | `#b3b3b3` |
| `--color-base-100` | `#222222` | `#dadada` |

`--mono-rgb-0`：`255,255,255` / `0,0,0`；`--mono-rgb-100`：`0,0,0` / `255,255,255`；
`--highlight-mix-blend-mode`：`darken` / `lighten`；`color-scheme` 相应。

### Extended colors

| Var | Light | Dark |
|---|---|---|
| `--color-red` | `#e93147` (233,49,71) | `#fb464c` (251,70,76) |
| `--color-orange` | `#ec7500` (236,117,0) | `#e9973f` (233,151,63) |
| `--color-yellow` | `#e0ac00` (224,172,0) | `#e0de71` (224,222,113) |
| `--color-green` | `#08b94e` (8,185,78) | `#44cf6e` (68,207,110) |
| `--color-cyan` | `#00bfbc` (0,191,188) | `#53dfdd` (83,223,221) |
| `--color-blue` | `#086ddd` (8,109,221) | `#027aff` (2,122,255) |
| `--color-purple` | `#7852ee` (120,82,238) | `#a882ff` (168,130,255) |
| `--color-pink` | `#d53984` (213,57,132) | `#fa99cd` (250,153,205) |

（每个颜色附带 `-rgb` 变量）

### 主要语义 token

| Token | 定义 | Light | Dark |
|---|---|---|---|
| `--background-primary` | base-00 | `#ffffff` | `#1e1e1e` |
| `--background-primary-alt` | base-10 | `#fafafa` | `#242424` |
| `--background-secondary` | base-20 | `#f6f6f6` | `#262626` |
| `--background-secondary-alt` | theme | base-05 `#fcfcfc` | base-30 `#363636` |
| `--background-modifier-hover` | `rgba(mono-100, .067)` | | |
| `--background-modifier-active-hover` | accent @10% | | |
| `--background-modifier-border` | base-30 | `#e0e0e0` | `#363636` |
| `--background-modifier-border-hover` | base-35 | `#d4d4d4` | `#3f3f3f` |
| `--background-modifier-border-focus` | base-40 | `#bdbdbd` | `#555555` |
| `--background-modifier-error` | red | | |
| `--background-modifier-success` | green | | |
| `--background-modifier-message` | `rgba(0,0,0,0.9)` | | |
| `--background-modifier-form-field` | base-00 | `#ffffff` | base-25 `#2a2a2a` |
| `--background-modifier-cover` | theme | `rgba(220,220,220,.4)` | `rgba(10,10,10,.4)` |
| `--text-normal` | base-100 | `#222222` | `#dadada` |
| `--text-muted` | base-70 | `#5c5c5c` | `#b3b3b3` |
| `--text-faint` | base-50 | `#ababab` | `#666666` |
| `--text-on-accent` | `white` | | |
| `--text-error/warning/success` | red/orange/green | | |
| `--text-selection` | accent @20% | | dark: accent @33% |
| `--text-highlight-bg` | `rgba(255,208,0,0.4)` | | |
| `--interactive-normal` | base-00 | `#ffffff` | base-30 `#363636` |
| `--interactive-hover` | base-10 | `#fafafa` | base-35 `#3f3f3f` |

### Typography

```css
--font-default: ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI",
  "Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji",
  "Segoe UI Emoji", "Segoe UI Symbol", sans-serif;
--font-monospace-default: ui-monospace, SFMono-Regular, "Cascadia Mono", "Roboto Mono",
  "DejaVu Sans Mono", "Liberation Mono", Menlo, Monaco, "Consolas", "Source Code Pro", monospace;
--font-interface: var(--font-interface-override), var(--font-interface-theme), var(--default-font,'??'), var(--font-default);
--font-text: var(--font-text-override), var(--font-text-theme), var(--font-default);
--font-monospace: var(--font-monospace-override), var(--font-monospace-theme), var(--font-monospace-default);
--font-text-size: 16px;
```
`'??'` = 故意无效的字体名作为 placeholder；app 在 runtime 从 settings 覆盖 `-override`/`-theme` slot。

- 相对字号：`--font-smallest: 0.8em; --font-smaller: 0.875em; --font-small: 0.933em`
- UI：`--font-ui-smaller: 12px; --font-ui-small: 13px; --font-ui-medium: 15px; --font-ui-large: 20px`
- Weight：`--font-thin:100` … `--font-black:900`；`--font-weight: var(--font-normal)`
- Line height：`--line-height-normal: 1.5; --line-height-tight: 1.3`

### Spacing / radius / z-index

- `--size-2-1: 2px; --size-2-2: 4px; --size-2-3: 6px`
- `--size-4-1: 4px; -2: 8px; -3: 12px; -4: 16px; -5: 20px; -6: 24px; -8: 32px; -9: 36px; -10: 40px; -12: 48px; -16: 64px; -18: 72px`
- `--radius-s: 4px; --radius-m: 8px; --radius-l: 12px; --radius-xl: 16px`
- `--border-width: 1px`
- Z：`--layer-cover:5; sidedock:10; status-bar:15; popover:30; slides:45; modal:50; notice:60; menu:65; tooltip:70; dragged-item:80`

### Shadow（light / dark）

```css
/* 亮色 */
--shadow-s: 0px 1px 2px rgba(0,0,0,.028), 0px 3.4px 6.7px rgba(0,0,0,.042), 0px 15px 30px rgba(0,0,0,.07);
--shadow-l: 0px 1.8px 7.3px rgba(0,0,0,.071), 0px 6.3px 24.7px rgba(0,0,0,.112), 0px 15px 30px rgba(0,0,0,.1);
/* 暗色 */
--shadow-s: 0px 1px 2px rgba(0,0,0,.121), 0px 3.4px 6.7px rgba(0,0,0,.179), 0px 15px 30px rgba(0,0,0,.3);
--shadow-l: 0px 1.8px 7.3px rgba(0,0,0,.071), 0px 6.3px 24.7px rgba(0,0,0,.112), 0px 30px 90px rgba(0,0,0,.2);
```

### chrome 度量

- `--header-height: 40px`（view header、tab bar、titlebar offset）
- Ribbon：`--ribbon-width: 44px`，bg `--background-secondary`
- Tabs：`--tab-width: 200px; --tab-max-width: 320px; --tab-curve: 6px; --tab-radius-active: 6px 6px 0 0;
  --tab-font-size: var(--font-ui-small)`；text：faint → muted（active/focused）→ normal（focused-active-current）；
  stacked：`--tab-stacked-pane-width: 700px`
- Status bar：bg secondary，border `1px 0 0 1px`，radius `8px 0 0 0`（右下角浮动 pill），
  font `--font-ui-smaller`，`position: fixed`
- Scrollbar：12px，thumb `rgba(mono-100, .1)`（active .2），仅当 `body.styled-scrollbars`
- Divider splitter：`--divider-color: var(--background-modifier-border)`；hover →
  `--interactive-accent`，width 1px → 3px
- Icon：`--icon-xs:14px; s:16px; m/l:18px; xl:32px`；stroke 2/2/1.75/1.75/1.25；默认
  `--icon-color: var(--text-muted)`，opacity 0.85
- Input：`--input-height: 30px; --input-radius: 5px`；Toggle：40×18px 白色 thumb
- Modal：`--modal-radius: 12px`，dialog 560px（max 80vw），settings 90vw×85vh max 1100×1000
- Prompt（switcher/palette）：width 700px，max 80vw/70vh，input 40px，`border-radius: var(--radius-l)`，
  `box-shadow: var(--shadow-l)`，top 80px
- Popover：450×400px；Menu：bg `--background-secondary`，radius 8px，padding 6px
- Animation：`--anim-duration-superfast: 70ms; fast: 140ms; moderate: 300ms; slow: 560ms`

### 值得注意的 editor/markdown 变量

- `--file-line-width: 700px`（readable line length）；`--file-margins: 32px`
- Heading size：h1 `1.618em`、h2 `1.462em`、h3 `1.318em`、h4 `1.188em`、h5 `1.076em`、h6 `1em`；
  letter-spacing −0.015/−0.011/−0.008/−0.005/−0.002/0 em；inline-title alias h1
- `--p-spacing: 1rem`（source mode：0）；`--indent-size: 4`（也是 `tab-size`）
- **Bold**：`b, strong { font-weight: calc(var(--font-weight) + var(--bold-modifier)) }`，其中
  `--bold-modifier: 200`
- Code：`--code-size: var(--font-smaller)`，bg `--background-primary-alt`；语法颜色：
  comment=faint、function=yellow、keyword=pink、string=green、operator/tag=red、property=cyan、
  value=purple、important=orange
- Blockquote：border-left 2px `--interactive-accent`，padding-left 24px
- Link：internal/external 均为 accent + underline；unresolved：opacity 0.7
- Tag pill：bg accent@10%，radius `2em`，padding `0.25em 0.65em`，size `--font-smaller`
- Embed：border-left `2px solid var(--interactive-accent)`，padding-left 24px，max-height 4000px
- Checkbox：size = `--font-text-size`，radius 4px，checked bg `--interactive-accent`；
  done：line-through + `--text-muted`
- Table：border 1px `--background-modifier-border`，header weight bold-modifier
- Nav（file explorer）：item size `--font-ui-small`，padding `4px 8px 4px 24px`，radius 4px，
  selected bg accent@15%，children margin-left 12px + indent guide 1px
- Graph：`--graph-text: var(--text-normal); --graph-line: base-35; --graph-node: var(--text-muted);
  --graph-node-unresolved: var(--text-faint); --graph-node-focused: var(--text-accent);
  --graph-node-tag: var(--color-green); --graph-node-attachment: var(--color-yellow)`
- Canvas：`--canvas-background: var(--background-primary); --canvas-dot-pattern: base-30;
  --canvas-color-1..6` = red/orange/yellow/green/cyan/purple rgb

### Body feature classes

| Class | 作用 |
|---|---|
| `.theme-light` / `.theme-dark` | 切换 palette |
| `.mod-macos/.mod-windows/.mod-linux` | 按 OS 的 chrome |
| `.is-frameless` / `.is-hidden-frameless` | 自定义 titlebar |
| `.is-focused` | 窗口 focus → titlebar/tab focused 颜色 |
| `.is-fullscreen`、`.is-maximized`、`.is-popout-window`、`.is-translucent` | |
| `.is-grabbing` | 拖拽中：强制 cursor，关闭 hover |
| `.is-mobile/.is-phone/.is-tablet/.is-ios` | mobile layout |
| `.show-ribbon` | **缺失** → `--ribbon-width: 0` + 隐藏 ribbon |
| `.show-inline-title` | 缺失 → 隐藏 inline title |
| `.show-view-header` | 缺失 → 完全隐藏 `.view-header` |
| `.styled-scrollbars` | 启用自定义 scrollbar |
| `.mod-rtl` | RTL |

注意："Readable line length" **不是** body class —— 它在
`.markdown-preview-view` / `.markdown-source-view.mod-cm6` 上切换 `.is-readable-line-width`
（cap `--file-line-width: 700px`）。

---

## 20. DOM classes

### Shell

```
body.theme-dark.mod-macos.is-frameless.is-focused.show-ribbon.show-inline-title…
├── .titlebar  （固定顶部，app-region: drag）
│   └── .titlebar-inner > .titlebar-button-container.mod-left/.mod-right > .titlebar-button
├── .app-container  （纵向 flex 100%）
│   ├── .horizontal-main-container  （横向 flex）
│   │   └── .workspace
│   │       ├── .workspace-ribbon.mod-left  （44px，纵向 flex；.side-dock-actions > .side-dock-ribbon-action.clickable-icon）
│   │       ├── .workspace-split.mod-horizontal.mod-left-split
│   │       ├── .workspace-split.mod-vertical.mod-root  （背景 --background-primary）
│   │       └── .workspace-split.mod-horizontal.mod-right-split
│   └── .status-bar  （固定右下） > .status-bar-item(.mod-clickable)
└── overlay 与 .app-container 同级：
    .modal-container > .modal-bg + (.modal | .prompt)
    .suggestion-container, .popover.hover-popover, .menu, .tooltip, .notice-container, .drag-ghost
```

### Split / tabs / leaf

- `.workspace-split` —— `.mod-vertical`（row，子 `flex:1 0 0; width:0`）、`.mod-horizontal`（column）、
  `.mod-root/.mod-left-split/.mod-right-split`（sidebar `flex:0 0 auto`，size 由 inline JS）。
  子元素有 `.workspace-leaf-resize-handle`（strip 3px，hover accent，cursor col/row-resize）。
- `.workspace-tabs`（.mod-top = 触及 window 顶部，.mod-active = group focus，.mod-stacked）
  - `.workspace-tab-header-container`（height 40px）> `-inner`（drag region）
    - `.workspace-tab-header[data-type]` —— `.is-active` 有 bg `--tab-background-active` +
      **用 `::before/::after` 实现的逆向圆角效果**（`--tab-curve` 圆 + clip-path +
      box-shadow fill —— 逐字复制以实现 pixel-perfect）
      - `.workspace-tab-header-inner` > `-icon` + `-title` + `-close-button`
    - controls：`.workspace-tab-header-new-tab`、`.workspace-tab-header-tab-list`
  - `.workspace-tab-container`
    - `.workspace-leaf`（`contain: strict`；`.mod-active`；`.is-highlighted::before` accent overlay 25%）
      - `.workspace-leaf-content[data-type][data-mode]`
        - `.view-header`（40px；若 body 缺少 `.show-view-header` 则隐藏）→ `.view-header-nav-buttons`、
          `.view-header-title-container`（breadcrumb）、`.view-actions > .view-action.clickable-icon`
        - `.view-content`（`height: calc(100% - var(--header-height))`）

Root split：leaf bg `--background-primary`；sidebar：bg `--background-secondary`，view-content padding `12px 12px 32px`。

### Markdown 视图

- **Edit**：`.markdown-source-view.mod-cm6`（+`.is-live-preview`、`.is-readable-line-width`、`.is-folding`）
  → CM6：`.cm-editor > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content > .cm-line`；
  theme class `.cm-s-obsidian`。
  - Line classes：`HyperMD-header(-1..6)`、`HyperMD-list-line`、`HyperMD-quote`、
    `HyperMD-codeblock(-begin/-end/-bg)`、`HyperMD-task-line[data-task]`、`HyperMD-table-row`、
    `HyperMD-footnote`、`HyperMD-hr`
  - Span classes：`cm-header-1..6`、`cm-strong`、`cm-em`、`cm-highlight`、`cm-strikethrough`、
    `cm-inline-code`、`cm-hmd-internal-link`、`cm-link`、`cm-url`、`cm-hashtag(-begin/-end)`、
    `cm-formatting(-link/-list/-task/-quote/-header/-code)`、`cm-hmd-frontmatter`、`cm-hmd-footnote`、
    `cm-comment`、`cm-math`、`cm-footref`、`cm-blockquote-border`、`cm-embed-block`、`cm-callout`、
    `cm-table-widget`、`cm-fold-indicator`、`cm-indent`、`cm-active`
- **Reading**：`.markdown-reading-view > .markdown-preview-view.markdown-rendered`
  （padding 32px，scroll，`scrollbar-gutter: stable`）> `.markdown-preview-sizer.markdown-preview-section`
  （readable 时 cap 700px）> `.markdown-preview-pusher` + div 每个 block。
- `.inline-title`（content 上方的文档标题）、`.internal-embed/.inline-embed/.image-embed/.markdown-embed`。

### Tree（explorer/outline/bookmarks/search 共用）

```
.tree-item (.nav-folder/.nav-file)
├── .tree-item-self (.nav-folder-title/.nav-file-title)
│     [.is-clickable .mod-collapsible .is-active .is-selected .has-focus .is-being-dragged
│      .is-being-dragged-over .is-being-renamed .is-cut .has-active-menu]
│   ├── .tree-item-icon.collapse-icon  （绝对定位，margin-inline-start −20px）
│   ├── .tree-item-inner (-text/-subtext)
│   ├── .nav-file-tag  （扩展名徽章：9px uppercase，letter-spacing .05em）
│   └── .tree-item-flair-outer > .tree-item-flair  （计数）
└── .tree-item-children  （margin-left 12px + 缩进参考线 border-left）
```
Header pane：`.nav-header > .nav-buttons-container > .clickable-icon.nav-action-button(.is-active)`；
container `.nav-files-container`。

### Modal / prompt / suggestion / menu / tooltip

- `.modal-container(.mod-dim)` → `.modal-bg` + `.modal`（radius 12px，border 1px，padding 16px）
  → `.modal-close-button`、`.modal-header > .modal-title`、`.modal-content`、`.modal-button-container`。
- `.prompt` → `.prompt-input-container > input.prompt-input`、`.prompt-results`（含 `.suggestion-item`）、
  `.prompt-instructions > .prompt-instruction > .prompt-instruction-command`。
- `.suggestion-container`/`.popover`：bg primary，border 1px，shadow-s，radius 8px；内部
  `.suggestion > .suggestion-item`（padding 6px 12px；`.is-selected` bg hover；`.mod-complex` →
  `.suggestion-content > .suggestion-title (.suggestion-highlight=bold) + .suggestion-note`、
  `.suggestion-icon`、`.suggestion-aux > .suggestion-hotkey/.suggestion-flair`）；`.suggestion-empty`。
- `.menu`（fixed，bg secondary，radius 8px）> `.menu-scroll` > `.menu-item`（`.selected`、`.is-disabled`、
  `.is-warning`、`.is-label`；`.menu-item-icon` + `.menu-item-title`；`.mod-submenu`）；`.menu-separator`。
- `.tooltip`（fixed，bg `rgba(0,0,0,.9)`，**color #FAFAFA 硬编码**，radius 4px，max-width 300px，
  animation pop-down 200ms）。

---

## 21. Callouts

颜色 slot 是 **RGB triplet**（不是颜色），以便同时用于 `rgba(var(--callout-color), 0.1)`（背景）
和 `rgb(var(--callout-color))`（title/icon）。Box：bg `rgba(color, 0.1)`，border
`var(--callout-border-width)=0px solid rgba(color, 0.25)`，radius 4px，padding `12px 12px 12px 24px`，
margin `1em 0`，`mix-blend-mode: var(--highlight-mix-blend-mode)`。

| `data-callout` | Slot | Light RGB | Dark RGB | Icon |
|---|---|---|---|---|
| (default / `note` / 未识别) | `--callout-default` (blue) | 8,109,221 | 2,122,255 | `lucide-pencil` |
| `abstract`, `summary`, `tldr` | `--callout-summary` (cyan) | 0,191,188 | 83,223,221 | `lucide-clipboard-list` |
| `info` | `--callout-info` (blue) | 8,109,221 | 2,122,255 | `lucide-info` |
| `todo` | `--callout-todo` (blue) | 8,109,221 | 2,122,255 | `lucide-check-circle-2` |
| `important` | `--callout-important` (cyan) | 0,191,188 | 83,223,221 | `lucide-flame` |
| `tip`, `hint` | `--callout-tip` (cyan) | 0,191,188 | 83,223,221 | `lucide-flame` |
| `success`, `check`, `done` | `--callout-success` (green) | 8,185,78 | 68,207,110 | `lucide-check` |
| `question`, `help`, `faq` | `--callout-question` (orange) | 236,117,0 | 233,151,63 | `help-circle` |
| `warning`, `caution`, `attention` | `--callout-warning` (orange) | 236,117,0 | 233,151,63 | `lucide-alert-triangle` |
| `failure`, `fail`, `missing` | `--callout-fail` (red) | 233,49,71 | 251,70,76 | `lucide-x` |
| `danger`, `error` | `--callout-error` (red) | 233,49,71 | 251,70,76 | `lucide-zap` |
| `bug` | `--callout-bug` (red) | 233,49,71 | 251,70,76 | `lucide-bug` |
| `example` | `--callout-example` (purple) | 120,82,238 | 168,130,255 | `lucide-list` |
| `quote`, `cite` | `--callout-quote` | 158,158,158（两种主题均同） | — | `quote-glyph` |

---

## 22. 克隆清单

克隆一个功能时，对照以下"容易出错"的点：

1. **Markdown**：使用 §7 中的正确正则（尤其是 tag charset、callout、block id `[a-zA-Z0-9-]`）；
   记住 `breaks: true`（单个换行 = `<br>`）；默认 display text `Note > Head`；图片 size param。
2. **Link resolution**：§8 的 6 步，全部不区分大小写，tie-break "同 folder 然后 shortest path"。
3. **Search**：§11 的文法 + operator 表；context 100 字符以行边界截断；6 种 sort 模式
   （没有 relevance）；exclusive operator 不嵌套。
4. **Fuzzy**：逐字移植 §9 的分数公式以让 switcher ranking 完全一致；penalty −1 path-only、
   −10 excluded。
5. **Graph**：d3-force 用 forceX/Y（不用 forceCenter），`velocityDecay 0.6`，repel `−slider³`
   `distanceMin 30`，collide(60, 0.5)，reheat alpha 0.3，radius `clamp(3√(w+1), 8, 30)`，
   text fade `clamp(log2(scale)+1−fade, 0, 1)`，slider 曲线 `(0.01^(1−v) − 0.01)/0.99`。
6. **Canvas**：int 取整 x/y/w/h；省略默认 field 的规则（`fromEnd:"none"`、`toEnd:"arrow"`、
   `backgroundStyle:"cover"`）；保留未知 key round-trip —— 需要 byte-identical。
7. **Settings**：仅写与默认值不同的 key；按白名单正确拆分 app/appearance；当 `.obsidian/*.json`
   从外部变化时 hot-reload。
8. **CSS**：token 在 `body` 上，palette 在 `.theme-light/.theme-dark` 上；bold = font-weight + 200；
   callout color = RGB triplet；active tab 用逆向圆角技巧；tooltip 文字颜色硬编码。
9. **Embed depth ≤ 5**；所有 HTML 渲染都经过 DOMPurify 并使用 §7 的 config。
10. **Task**：任何 non-space 字符 = done；不硬编码 state 列表。
