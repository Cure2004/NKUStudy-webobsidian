> NKUStudy 开发入口：[`nkustudy-dev` 交接说明](docs/nkustudy/DEVELOPMENT.md) · [部署说明](deploy/README.md)。公网预览不会自动从本仓库更新。

<div align="center">

<img src="assets/logo.png" alt="WebObsidian logo" width="140" />

# WebObsidian

**一个自托管、兼容 Obsidian 的 Web 应用，为你的 Markdown「第二大脑」而生。**

指向一个装 Markdown 文件的文件夹，即可在任意浏览器中编辑笔记 —— 配备 CodeMirror 编辑器、实时预览、wiki 链接、交互式关系图谱、全文搜索、GitHub 同步（含 Git LFS）、面向 AI 智能体的 API，以及社区插件支持。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)

[快速开始](#-快速开始docker) · [功能特性](#-功能特性) · [配置](#-配置) · [Agent API](#-agent-api) · [本地开发](#-本地开发) · [架构](#-架构)

> 📐 设计文档：[PRD.md](PRD.md) · 📋 进度：[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

</div>

---

## 这是什么？

WebObsidian 是一个 Web 应用，让你在服务器上的**真实 Markdown 文件夹**之上获得类似 [Obsidian](https://obsidian.md) 的体验。你的仓库与既有的 Obsidian 仓库 100% 兼容（包括 `.obsidian/` 文件夹）—— 你可以用 Obsidian 桌面应用和网页端同时编辑同一批文件。

它面向**单用户**且自托管：一个主密码保护整个应用，所有配置都存放在纯文本的 `data/settings.json` 中（不依赖数据库引擎），整个栈只需一条 `docker compose up` 即可运行。

> **为什么？** 为了在任意设备、任意浏览器上访问并编辑你的知识库，同时完全拥有自己的文件 —— 并让 AI 智能体通过安全、限定范围的 REST API 读写你的仓库。

---

## ✨ 功能特性

- 📝 **编辑器与渲染** —— CodeMirror 6，支持实时预览 / 源码 / 阅读三种视图；wiki 链接
  `[[note]]`、嵌入 `![[file]]`、标签 `#tag`、标注块、任务列表、KaTeX 数学公式与
  Mermaid 图表。
- 🕸️ **关系图谱视图** —— 基于 wiki 链接构建的力导向图，支持定位到节点搜索与高亮。
- 🔗 **反向链接与大纲** —— 右侧边栏标签栏：反向链接（已链接**和**未链接提及）、
  出链（已解析/未解析）、标签与大纲。
- 🔍 **QMD 搜索** —— 快速全文 + 字段搜索（`tag:`、`path:`、`title:`），模糊 +
  前缀匹配，增量索引，并持久化到磁盘以实现快速启动。
- 🔄 **GitHub 同步** —— 原生 `git` 拉取 / 提交 / 推送，支持 **Git LFS** 处理大型
  附件，可选自动同步，以及逐文件**版本历史**（浏览与恢复）。
- 🔐 **登录门禁** —— 单个主密码（scrypt 哈希）保护一切；JWT 存放于
  httpOnly cookie。
- 🌐 **公开分享** —— 将任意笔记变成只读、服务端渲染（利于 SEO）的公开页面
  `/share/<token>`，可选密码保护。
- 🤖 **Agent API** —— 限定范围的 API 密钥（`read` / `write` / `search`）让 AI 智能体
  通过 `/api/v1` 上的 REST 接口操作仓库。见 [docs/AGENT_API.md](docs/AGENT_API.md)。
- 🧩 **社区插件** —— 从 GitHub 安装 Obsidian 插件；基于 Obsidian-API 兼容垫片加载
  （子集支持）。
- 📱 **响应式 / 移动端** —— 抽屉式侧边栏、边缘滑动、键盘上的格式工具栏，以及
  适配触控的目标控件，风格类似 Obsidian Mobile。
- 🗃️ **纯 JSON 配置** —— 一切都在 `data/settings.json` 中。无数据库。
- 🐳 **Docker** —— 一条命令运行整个栈。

---

## 🚀 快速开始（Docker）

```bash
git clone https://github.com/xnohat/webobsidian.git
cd webobsidian
cp .env.example .env          # 编辑 VAULT_HOST_PATH，设置 WEBOBSIDIAN_PASSWORD
docker compose up -d --build
# 打开 http://localhost:8787
```

开箱即用，它会提供内置的 `./sample-vault`，因此整个栈会立即启动。所有部署设置都位于
**`.env`**（已被 git 忽略）—— 你永远不需要修改受版本控制的 `docker-compose.yml`，
因此 `git pull` / 重新部署都能保持你的配置与仓库映射不受影响。

## 🖥️ 桌面应用（无需搭建服务器）

更喜欢原生应用？从 [**Releases**](https://github.com/xnohat/webobsidian/releases)
页面获取安装包 —— 支持 **macOS / Windows / Linux**（arm64 · x64 · ia32）：

| 平台 | 下载 |
|----------|----------|
| macOS    | `.dmg`（或 `.zip`）—— arm64 / x64 |
| Windows  | NSIS 安装包 `.exe` 或便携版 `.exe` —— x64 / arm64 / ia32 |
| Linux    | `.AppImage` 或 `.deb` —— x64 / arm64 |

桌面应用内置整套服务器，首次启动时选择你的仓库文件夹，并**自动为你登录** —— 无需输入密码，无需 Docker。当前应用**未签名**，因此 macOS Gatekeeper / Windows SmartScreen 会在首次打开时警告（macOS 上右键 →
打开）。你也可以用 `npm run desktop:dist` 自行构建；详见
[`desktop/README.md`](desktop/README.md)。

> 🔑 **默认密码为 `123456`。** 立即登录，然后在
> **设置 → 账户**中修改。若想在首次运行时预置其他密码，请在 `.env` 中设置
> `WEBOBSIDIAN_PASSWORD`。忘记了？可设置 `WEBOBSIDIAN_PASSWORD`（明文）或
> `auth.passwordHash`（scrypt）作为恢复覆盖项。

### 指向你自己的仓库

```bash
# .env 文件
VAULT_HOST_PATH=/abs/path/to/your/ObsidianVault   # 必须存在；绑定挂载到 /vault
WEBOBSIDIAN_PASSWORD=use-a-strong-password
HTTP_BIND=0.0.0.0                                  # 设为 127.0.0.1 则仅本机可访问
HTTP_PORT=8787
```

然后执行 `docker compose up -d --build`。你的仓库可以是普通文件夹，也可以是 `git clone`
（附件支持 Git LFS）。

### 位于反向代理之后（TLS）

设置 `HTTP_BIND=127.0.0.1`，使应用仅能从主机访问，然后用 nginx / Caddy / Traefik 在
`http://127.0.0.1:8787` 前端终止 TLS。

### 大型仓库与文件监听

全新的 VPS 通常带有较低的 `fs.inotify.max_user_watches`（常为 8192），大型仓库会超出。
WebObsidian 会自动检测并回退到**轮询**（随处可用，但 CPU 占用更高）。若想降低 CPU，
请提高内核上限并保留原生监听：

```bash
sudo sysctl -w fs.inotify.max_user_watches=524288
echo 'fs.inotify.max_user_watches=524288' | sudo tee -a /etc/sysctl.conf
```

搜索索引（QMD）与链接图谱保存在内存中，因此内存占用随笔记数量增长。Docker 镜像设置了
`NODE_OPTIONS=--max-old-space-size=4096`（4 GB）；对于超大仓库（例如 6k+ 篇笔记 / 数 GB），
请提高到 `8192`。

---

## 💻 本地开发

需要 **Node ≥ 20** 和 `git`（若使用 LFS 还需 `git-lfs`）。

```bash
npm install
npm run dev          # server 运行在 :8787，web 开发服务器运行在 :5173（经代理）
# 打开 http://localhost:5173
```

生产构建（由服务器提供构建后的 SPA）：

```bash
npm run build
VAULT_PATH=./sample-vault npm start
# 打开 http://localhost:8787
```

常用脚本：

| 命令 | 作用 |
|---------|--------------|
| `npm run dev` | 以监听模式同时运行服务器 + 网页端 |
| `npm run build` | 构建网页 SPA，然后编译服务器 |
| `npm start` | 运行生产服务器（提供构建后的网页端） |
| `npm run typecheck` | 对两个 workspace 做类型检查 |

---

## ⚙️ 配置

### Docker 环境变量（`.env`，由 `docker-compose.yml` 读取）

| 变量 | 默认值 | 说明 |
|-----|---------|-------------|
| `VAULT_HOST_PATH` | `./sample-vault` | 绑定挂载到 `/vault` 的主机路径 |
| `HTTP_BIND` | `0.0.0.0` | 对外发布的宿主接口（`127.0.0.1` = 仅本机） |
| `HTTP_PORT` | `8787` | 映射到容器 `8787` 的宿主端口 |
| `WEBOBSIDIAN_PASSWORD` | – | 预置/覆盖主密码 |
| `WEBOBSIDIAN_WATCH` | `auto` | `auto`（原生 + 轮询回退）或 `polling` |

### 应用级环境变量（由服务器读取；Docker 在容器内设置这些变量）

| 变量 | 默认值 | 说明 |
|-----|---------|-------------|
| `PORT` | `8787` | HTTP 端口 |
| `VAULT_PATH` | `./sample-vault` | 笔记仓库路径 |
| `DATA_DIR` | `./data` | `settings.json` + 搜索索引的存放位置 |
| `ALLOWED_ROOTS` | – | 仓库选择器可浏览的根目录（逗号分隔） |
| `WEBOBSIDIAN_PASSWORD` | – | 预置/覆盖主密码 |
| `WEBOBSIDIAN_WATCH` | `auto` | 文件监听模式：`auto` 或 `polling` |
| `NODE_OPTIONS` | `--max-old-space-size=4096` | Node 堆大小 —— 大型仓库请提高 |

其余一切 —— git 远程地址/令牌、API 密钥、插件、主题 —— 都在
**设置** UI 中配置，并存储在 `data/settings.json` 中。

---

## 🤖 Agent API

面向 AI 智能体的限定范围 REST API，位于 `/api/v1`。在**设置 → API 密钥**中创建 API 密钥，
然后以 header 传入。完整参考：**[docs/AGENT_API.md](docs/AGENT_API.md)**。

### 🧩 即插即用的智能体技能（无需克隆）

想让你的编码智能体（Claude Code、Codex、OpenCode、Cursor……）直接操作你的仓库？
**复制下面这段，粘贴给你的智能体。** 它会从 GitHub 下载该技能，向你询问一次 URL + API 密钥，
保存到 `~/.webobsidian/credentials.json`，之后便能按需读取/写入/搜索你的笔记。

> 请先在应用中于**设置 → API 密钥**创建 API 密钥（权限范围 `read`/`write`/`search`）。

```text
SYSTEM / TASK — Install the "webobsidian" agent skill from GitHub, then set up credentials.
Do every step in order; do not skip the credential step.

STEP 1 — Download the skill into your runtime's skills directory
  (Claude Code: ~/.claude/skills · Codex: ~/.codex/skills · OpenCode: ~/.opencode/skills):
      SKILLS_DIR=~/.claude/skills        # 根据你的运行时修改
      mkdir -p "$SKILLS_DIR/webobsidian"
      curl -fsSL https://raw.githubusercontent.com/xnohat/webobsidian/main/docs/agent-skill/webobsidian/SKILL.md \
        -o "$SKILLS_DIR/webobsidian/SKILL.md"

STEP 2 — Set up credentials (ASK ME; never echo the key back). Ask me for my WebObsidian
  base URL (e.g. https://notes.example.com) and my API key (looks like wok_...), then:
      mkdir -p ~/.webobsidian && chmod 700 ~/.webobsidian
      printf '{ "baseUrl": "%s", "apiKey": "%s" }\n' "<BASE_URL>" "<API_KEY>" > ~/.webobsidian/credentials.json
      chmod 600 ~/.webobsidian/credentials.json

STEP 3 — Verify (do NOT print the key) and confirm ready:
      BASE=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.webobsidian/credentials.json")))["baseUrl"].rstrip("/"))')
      KEY=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.webobsidian/credentials.json")))["apiKey"])')
      curl -s "$BASE/api/v1/health"
      curl -s -H "X-API-Key: $KEY" "$BASE/api/v1/tags" | head
  From now on, when I ask you to work with my WebObsidian / Obsidian vault, use the webobsidian skill.
```

更多细节与替代方案：[docs/agent-skill/INSTALL.md](docs/agent-skill/INSTALL.md) ·
规范技能：[docs/agent-skill/webobsidian/SKILL.md](docs/agent-skill/webobsidian/SKILL.md)。

```bash
KEY=wok_your_key_here
BASE=http://localhost:8787/api/v1

# 列出笔记
curl -H "X-API-Key: $KEY" "$BASE/notes?limit=10"

# 创建 / 更新笔记
curl -X PUT -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"content":"# From the agent\n\nHello vault."}' \
  "$BASE/notes/Agent/Generated.md"

# 搜索（支持字段查询：tag:、path:、title:）
curl -H "X-API-Key: $KEY" "$BASE/search?q=tag:idea%20graph&limit=5"
```

| 接口 | 权限范围 | 说明 |
|----------|-------|-------------|
| `GET /api/v1/notes` | read | 列出笔记（分页） |
| `GET /api/v1/notes/{path}` | read | 读取笔记 + 元数据 |
| `PUT /api/v1/notes/{path}` | write | 创建 / 覆盖 |
| `PATCH /api/v1/notes/{path}` | write | 追加内容 |
| `DELETE /api/v1/notes/{path}` | write | 移入回收站 |
| `GET /api/v1/search?q=` | search | QMD 搜索 |
| `GET /api/v1/backlinks?path=` | read | 某篇笔记的反向链接 |
| `GET /api/v1/tags` | read | 所有标签及其计数 |

---

## 🏗️ 架构

包含两个 npm workspace 的 monorepo：

```
webobsidian/
├── server/   # Express + TypeScript API
│   └── src/{routes,services,middleware,plugins}
├── web/      # React + Vite SPA（构建输出到 server/public）
│   └── src/{components,lib,styles}
├── data/     # 运行时：settings.json + 搜索索引（已被 git 忽略）
├── docs/     # AGENT_API.md、Obsidian 内部机制笔记
├── Dockerfile · docker-compose.yml · .env.example
```

```
┌──────────────────────── Browser (React SPA) ────────────────────────┐
│   CodeMirror 6 · Live Preview · File Tree · Graph · Search           │
└───────────────▲──────────────────────────────────┬──────────────────┘
                │ REST + WebSocket                  │ static assets
┌───────────────┴──────────────────────────────────▼──────────────────┐
│                  Server (Node + Express + TypeScript)                │
│   Auth gate │ Vault FS │ QMD Search │ Git Sync │ API Gate │ Plugins  │
└──────┬──────────────┬───────────┬────────────┬───────────────┬───────┘
   settings.json   Vault dir   Search index  GitHub repo    plugins dir
   (JSON config)   (.md+attach) (in-mem/disk) (git + LFS)   (.obsidian/plugins)
```

**技术栈：** Node 20+ · Express · TypeScript · React · Vite · CodeMirror 6 ·
unified/remark/rehype · MiniSearch (QMD) · simple-git + git-lfs · scrypt + JWT · Docker。

完整设计见 [PRD.md §2](PRD.md)。

---

## 🔒 安全说明

- 主密码采用 scrypt 哈希；JWT 密钥自动生成。
- API 密钥在存储时哈希，并限定权限范围（`read` / `write` / `search`），逐密钥限流
  与审计日志。
- 所有文件路径都做防穿越（path traversal）防护；仓库选择器被限制在
  `ALLOWED_ROOTS` 内。
- 机密信息（git 令牌 / API 密钥）存放在服务器上的 `data/settings.json` —— 请将 `/data`
  挂载为私有卷，并使其脱离版本控制。**请务必修改默认密码。**

---

## 🗺️ 兼容性与范围

- ✅ 可直接作用于既有 Obsidian 仓库，包括 `.obsidian/` 配置。
- ⚠️ **单用户（v1）** —— 尚不支持实时多用户协作编辑。
- ⚠️ Git 同步替代了 Obsidian Sync/Publish。
- ⚠️ 社区插件支持是 Obsidian API 的**子集**；依赖 Electron/Node 内部机制的插件
  可能无法工作。

---

## 🤝 贡献

欢迎贡献！来自 [CLAUDE.md](CLAUDE.md) 的几条内务规则：

1. **遵循 [PRD.md](PRD.md)。** 它是设计的唯一事实来源。变更范围意味着
   先更新 PRD（附带 changelog 版本递增），再改代码。
2. **保持 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 同步** —— 在工作过程中
   勾选复选框并添加进度日志行。
3. 全面使用 TypeScript；避免 `any`。运行时配置仅用 JSON（不使用数据库引擎）。
4. 绝不记录机密/令牌；存储前先哈希；防范路径穿越。

提交 PR 前请运行 `npm run typecheck`。

---

## 📄 许可证

[MIT](LICENSE) © xnohat

---

<div align="center">
<sub>为想要真正拥有自己笔记的人而构建。与 Obsidian.md 无隶属关系。</sub>
</div>
