# GitHub App 配置指南（QUT WiKi 在线编辑器）

本文档面向 **QUT WiKi 维护者**，说明如何创建一个 GitHub App，让本编辑器（WebObsidian 的 QUT WiKi 定制版）能够以独立 bot 身份把在线编辑推送到 `QUT-Lib/QUT-WiKi` 仓库的 `web-edit` 分支，并自动创建 Pull Request（PR）。

> 目标仓库：`https://github.com/QUT-Lib/QUT-WiKi`
> 编辑分支：`web-edit`　　PR 目标分支：`web-edit`
> 编辑器使用的配置项：`App ID`、`Private key (.pem)`、`Installation ID`、`owner/repo`、`editBranch`、`baseBranch`。

---

## 0. 前置提醒：先创建 `web-edit` 分支

**这一步必须在配置 GitHub App 之前完成。** 如果 `QUT-Lib/QUT-WiKi` 仓库中不存在 `web-edit` 分支，推送和创建 PR 都会失败（推送会报 `remote ref does not exist`，创建 PR 会报 `422 Validation Failed`）。

在本地克隆 `QUT-Lib/QUT-WiKi` 后执行：

```bash
git checkout -b web-edit
git push -u origin web-edit
```

或者直接在 GitHub 网页端：进入仓库 → 分支下拉框 → 输入 `web-edit` → **Create branch: web-edit**。

> 说明：编辑器把在线编辑统一提交到 `web-edit` 分支，并向 `web-edit` 发起 PR（`baseBranch = web-edit`）。这样所有在线改动都汇总在同一个分支上，维护者再决定如何合并到 `main`。若你希望 PR 直接指向 `main`，把设置里的「PR 目标分支」改成 `main` 即可，但本文档默认使用 `web-edit`。

---

## 1. 为什么用 GitHub App 而不是 PAT

传统做法是创建一个 Personal Access Token（PAT）填进编辑器。相比之下 GitHub App 有明显优势：

| 维度 | GitHub App | Personal Access Token (PAT) |
|------|-----------|------------------------------|
| 权限粒度 | 按仓库、按权限项精细授权（可只给 Contents / Pull requests 写权限） | 通常是账号级或粗粒度仓库权限，容易给多 |
| 令牌生命周期 | App 用私钥签 JWT → 换取 **1 小时过期**的 installation token，自动轮换 | 长期有效，需手动设置过期与轮换 |
| 身份 | 有独立的 bot 身份（`app-name[bot]`），提交与 PR 来源清晰 | 以个人账号身份操作，难以区分人与自动化 |
| 泄露风险 | 私钥只保存在服务器端，且即使泄露也可随时吊销 App / 卸载安装 | 令牌一旦泄露，在有效期内可直接操作账号下所有授权仓库 |
| 审计与撤销 | 可在 GitHub 后台单独查看、暂停、卸载某个安装 | 只能整体吊销 token |

本编辑器对 GitHub App 的鉴权流程（见 `server/src/services/githubApp.ts`）：

1. 用 **App ID + 私钥** 签发一个 RS256 的短期 JWT（有效期约 9 分钟）。
2. 用该 JWT 调用 `POST /app/installations/{installation_id}/access_tokens` 换取 **installation token**（1 小时过期）。
3. 用 installation token 拼出带鉴权的 https 远程地址（`https://x-access-token:<token>@github.com/...`）执行 push，并调用 REST API 创建 PR。
4. installation token 会缓存到过期前 1 分钟，避免每次请求都重新换取。

---

## 2. 创建 GitHub App（完整步骤）

### 2.1 进入创建页面

1. 打开 GitHub，点击右上角头像 → **Settings**。
2. 左侧菜单最底部 → **Developer settings**。
3. 选择 **GitHub Apps** → 点击 **New GitHub App**。

> 组织账号：如果 App 要归属组织，先进入组织页面 → **Settings → Developer settings → GitHub Apps → New GitHub App**。

### 2.2 填写基本信息

- **GitHub App name**：例如 `QUTWiKi-Editor`（名称全局唯一，若被占用可加后缀）。
- **Homepage URL**：填 Wiki 站点或仓库地址，例如 `https://github.com/QUT-Lib/QUT-WiKi`。
- **Description**（可选）：`Online editor bot for QUT WiKi`。

### 2.3 Webhook

- **取消勾选 Active**（编辑器不需要 webhook，也不需要填写 Webhook URL）。
- 若页面强制要求，可留空或随意填写，但务必把 **Active 取消勾选**。

### 2.4 Repository permissions（关键，精确勾选）

展开 **Repository permissions**，只修改以下几项，其余全部保持 **No access**：

| 权限项 | 设置为 | 用途 |
|--------|--------|------|
| **Contents** | **Read and write** | 读取仓库、推送 `web-edit` 分支 |
| **Pull requests** | **Read and write** | 创建 / 查询 Pull Request |
| **Metadata** | **Read-only** | 创建 App 时 GitHub 自动勾选，无法取消，属正常 |

其余权限（Actions、Administration、Issues、Workflows 等）一律保持 **No access**，遵循最小权限原则。

> Organization permissions 全部保持 **No access**。

### 2.5 安装范围

- **Where can this GitHub App be installed?**
  - 若 App 归属个人账号：选 **Only on this account**。
  - 若 App 归属组织：选 **Only on this account**（组织内）或按需选择。
- 点击 **Create GitHub App**。

### 2.6 记录 App ID 并生成私钥

1. 创建成功后进入 App 详情页，在 **About** 区域找到 **App ID**（一串数字，例如 `1234567`），**记下来**。
2. 页面下方 **Private keys** → 点击 **Generate a private key**。
3. 浏览器会下载一个 `.pem` 文件（例如 `qutwiki-editor.2026-01-01.private-key.pem`）。
4. 用文本编辑器打开该文件，会看到类似内容：

   ```
   -----BEGIN RSA PRIVATE KEY-----
   MIIEowIBAAKCAQEA...
   ...（多行 base64）...
   -----END RSA PRIVATE KEY-----
   ```

   配置编辑器时**需要整段内容**（含首尾的 `-----BEGIN/END-----` 行），稍后填入「私钥」字段。

> ⚠️ 私钥只在生成时下载一次，请妥善保存。若丢失，需回到该页面重新生成（旧私钥可删除）。

### 2.7 安装 App 到仓库

1. 在 App 详情页左侧点击 **Install App**。
2. 选择安装目标：
   - 若你有 `QUT-Lib` 组织的管理权限：选择组织 **QUT-Lib**，安装范围选 **Only select repositories** → 勾选 **QUT-WiKi**。
   - 若无组织权限：安装到自己的账号，并在 **Only select repositories** 中勾选你有权限的 `QUT-WiKi`（需先有该仓库的协作权限）。
3. 点击 **Install**。

### 2.8 获取 Installation ID

安装完成后获取 **Installation ID**（与 App ID 不同）：

- **方法一（URL）**：安装后浏览器地址栏形如
  `https://github.com/settings/installations/98765432`
  末尾的 `98765432` 就是 Installation ID。
- **方法二（组织）**：`https://github.com/organizations/QUT-Lib/settings/installations/<数字>`。
- **方法三（API）**：用 App 私钥签 JWT 后调用 `GET https://api.github.com/app/installations`，返回列表中对应仓库的 `id` 字段即为 Installation ID。

**记下这个 Installation ID。**

---

## 3. 在编辑器中配置

进入编辑器 → **设置（Settings）→ GitHub 同步 / GitHub App**，填写以下字段：

| 设置项 | 填写内容 | 示例 |
|--------|----------|------|
| 启用 GitHub App | 勾选 | ✅ |
| App ID | 第 2.6 步记下的 App ID | `1234567` |
| 私钥（Private key / .pem） | 第 2.6 步 `.pem` 文件的**完整内容**（含 BEGIN/END 行） | `-----BEGIN RSA PRIVATE KEY-----\n...` |
| Installation ID | 第 2.8 步记下的 Installation ID | `98765432` |
| 仓库 owner | 仓库所属账号/组织 | `QUT-Lib` |
| 仓库 repo | 仓库名 | `QUT-WiKi` |
| 编辑分支（editBranch） | 在线编辑推送到的分支 | `web-edit` |
| PR 目标分支（baseBranch） | PR 的合并目标分支 | `web-edit` |
| 自动创建 PR | 勾选（推荐） | ✅ |

保存后，编辑器会把这些配置写入服务器端文件 **`data/settings.json`** 的 `github` 字段。

> 🔒 **私钥只保存在服务器端** `data/settings.json`（文件权限 `0600`）。请勿把该文件或私钥提交到 Git 仓库。`data/` 目录应已被 `.gitignore` 忽略，请确认。

对应的配置结构（供排查参考）：

```json
{
  "github": {
    "appEnabled": true,
    "appId": "1234567",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
    "installationId": "98765432",
    "owner": "QUT-Lib",
    "repo": "QUT-WiKi",
    "editBranch": "web-edit",
    "baseBranch": "web-edit",
    "autoPullRequest": true
  }
}
```

---

## 4. 私钥的存放安全建议

1. **不要提交到 Git**：`.pem` 文件、`data/settings.json` 都属于机密。确认 `.gitignore` 已忽略 `data/`，且不要在仓库任何位置存放私钥副本。
2. **文件权限**：在服务器上限制访问权限。
   - Linux / macOS：`chmod 600 data/settings.json`，并确保运行服务的用户独占读写。
   - Windows：仅授予服务运行账号读取权限（右键文件 → 属性 → 安全 → 移除其他用户）。
3. **环境变量覆盖**：生产环境可用环境变量注入敏感值，避免明文落盘（例如通过 Docker secrets / 环境变量把私钥传给服务）。本项目的 `data/settings.json` 由 `DATA_DIR` 决定位置（默认 `./data`），部署时请把 `data/` 放在持久化且受控的目录。
4. **最小权限**：App 只授予 Contents / Pull requests 写权限，安装范围只选 `QUT-WiKi` 一个仓库。
5. **可随时吊销**：若怀疑泄露，立即到 App 设置页 **Delete private key** 并重新生成，或直接 **Suspend / Uninstall** 该 App；随后在编辑器里更新私钥。
6. **备份**：私钥文件应离线备份到密码管理器，不要放在公开云盘。

---

## 5. 验证方法

配置完成后按以下顺序验证：

1. **测试鉴权**：在 GitHub App 设置区点击 **测试连接**（或保存后执行一次「同步 / Sync now」）。鉴权成功时不会报错。
2. **查看服务端日志**：成功换取令牌时，服务器不会输出 `GitHub App 令牌换取失败`；若失败会返回 `401/403` 及 GitHub 的原始错误信息。
3. **执行一次在线编辑并推送**：
   - 在编辑器里修改一个页面并保存。
   - 触发同步 / 推送，确认改动出现在 `QUT-Lib/QUT-WiKi` 的 `web-edit` 分支。
4. **确认 PR**：打开 `https://github.com/QUT-Lib/QUT-WiKi/pulls`，应能看到由 `QUTWiKi-Editor[bot]` 创建的、目标分支为 `web-edit` 的 PR。若已存在同一 `head → base` 的开放 PR，编辑器会复用它而不是重复创建。
5. **API 快速自检**（可选）：在服务器上用私钥签 JWT 后调用
   `GET https://api.github.com/app/installations/{installation_id}`，
   返回 `200` 即表示 App ID、私钥、Installation ID 三者匹配且安装有效。

---

## 6. 常见问题（FAQ）

### 6.1 401 Unauthorized

- **App ID 或私钥不匹配**：确认 `App ID` 是数字且与生成私钥的 App 一致；私钥必须是该 App 的 `.pem` 全文。
- **私钥格式错误**：见 6.3。
- **JWT 过期/时钟偏差**：服务器系统时间需准确（NTP 同步）。JWT 有效期仅约 9 分钟，时钟偏差过大会导致签名校验失败。
- **App 未安装或已卸载**：确认 App 仍安装且未被 suspend。

### 6.2 403 Forbidden / 权限不足

- **Repository permissions 未勾选**：回到 App 设置，确认 `Contents: Read and write`、`Pull requests: Read and write` 已保存。修改权限后，**安装方需要重新批准**（App 页面会提示 "Review request"）。
- **安装范围不含目标仓库**：确认安装时勾选了 `QUT-WiKi`。
- **组织策略限制**：组织可能禁止第三方 App，需要组织 Owner 批准。
- 报错信息里若出现 `Resource not accessible by integration`，基本都是权限或安装范围问题。

### 6.3 Installation ID 填错

- 症状：换取令牌时报 `404 Not Found`（installation 不存在）。
- 排查：Installation ID 是**安装实例**的 ID，不是 App ID。重新按第 2.8 步从安装 URL 获取。
- 注意：**重新安装** App 会生成新的 Installation ID，需同步更新配置。

### 6.4 私钥换行丢失

- 症状：`error:0909006C:PEM routines:get_name:no start line` 或 `DECODER routines::unsupported`。
- 原因：私钥被压成一行，或 `\n` 被转义成字面量。
- 处理：确保填入的是 `.pem` 原文，包含首尾的 `-----BEGIN RSA PRIVATE KEY-----` / `-----END RSA PRIVATE KEY-----` 两行，中间每行一个换行。若通过 JSON 手工编辑，换行需写成 `\n`。

### 6.5 PR 目标分支不存在 / 推送失败

- 症状：`remote ref does not exist`、`422 Validation Failed`、`No commits between ...`。
- 原因：`web-edit` 分支尚未创建（见第 0 节），或 `editBranch` / `baseBranch` 拼写错误。
- 处理：先在 `QUT-Lib/QUT-WiKi` 创建 `web-edit` 分支；确认设置里 `editBranch = web-edit`、`baseBranch = web-edit`。

### 6.6 修改配置后仍报旧错误

- 编辑器会缓存 installation token（约 1 小时）。修改 App 配置后应清空缓存（重新保存设置会触发 `clearInstallationTokenCache`），或重启服务。

### 6.7 推送成功但没有 PR

- 确认「自动创建 PR」已勾选。
- 若 `head` 与 `base` 分支内容完全相同，GitHub 不会创建 PR（`No commits between web-edit and web-edit`）——这是正常的，说明没有新改动。

---

## 7. 公开编辑模式（访客免密投稿）

开启后，**未登录访客可免密进入编辑器**，但权限被严格限制：只能编辑指定目录，且只能通过「提交并推送（创建 PR）」走投稿流程。

### 7.1 配置

在 `data/settings.json` 增加 `publicEditor` 段（默认关闭）：

```json
{
  "publicEditor": {
    "enabled": true,
    "editableRoot": "docs/start"
  }
}
```

- `enabled`：是否开启公开编辑。**默认 `false`**。
- `editableRoot`：访客可编辑的目录（**相对仓库根**，如 `docs/start`）。默认 `docs/start`。若 `vault.root = docs/start`，则访客可编辑整个内容根。

开启后，服务启动日志会打印安全提醒。

### 7.2 访客能做什么 / 不能做什么

| 能力 | 访客 | 说明 |
|------|------|------|
| 浏览/阅读内容根 | ✅ | 只读 |
| 编辑 `editableRoot` 下的文件 | ✅ | 越界路径一律 403 |
| 上传图片/附件到 `editableRoot` | ✅ | 文件名会做净化，防止 `../` 越界 |
| 提交并推送（创建 PR） | ✅ | 服务端**强制**推送到 `web-edit`，提交信息走模板校验 |
| 访问设置 / Git 凭据 / API 密钥 / 插件 / 分享管理 | ❌ | 一律 401/403 |
| 查看 Git 状态、拉取、推送、初始化、克隆 | ❌ | owner 专属 |
| 读取回收站 / 清空回收站 | ❌ | owner 专属 |
| 获取 GitHub App 私钥、图床 key | ❌ | 密钥只在服务端，绝不下发 |

### 7.3 安全要点

1. **默认关闭**：`enabled` 默认为 `false`，需显式开启。
2. **访客拿不到密钥**：`/api/settings` 已改为 `requireOwner`，访客根本调不到；GitHub App 私钥、图床 key 只存在于服务端 `settings.json`。
3. **只能进 PR，不能直推主分支**：访客的 `/api/git/sync` 由服务端强制目标分支为 `web-edit`，不信任任何客户端输入。
4. **目录隔离**：访客写操作经 `guestWriteGuard` 校验，仅允许 `editableRoot` 及其子路径。
5. **提交规范**：提交信息必须符合「中文前缀: 描述」模板（与 Wiki 仓库 CI 校验一致）。
6. **owner 登录**：访客界面提供「管理员登录」入口，owner 输入密码后即恢复全部权限（整页刷新）。

---

## 附：配置项速查

| 名称 | 来源 | 示例 |
|------|------|------|
| App ID | App 详情页 About | `1234567` |
| Private key | App 详情页 Generate a private key 下载的 `.pem` | 多行 PEM |
| Installation ID | 安装 URL `/installations/<id>` | `98765432` |
| owner | 仓库所属 | `QUT-Lib` |
| repo | 仓库名 | `QUT-WiKi` |
| editBranch | 推送分支（需已存在） | `web-edit` |
| baseBranch | PR 目标分支（需已存在） | `web-edit` |
