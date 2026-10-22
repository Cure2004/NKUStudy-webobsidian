# QUT fork 到 NKUStudy 的配置与适配清单

日期：2026-10-22。源码基线：`e2201591c02ecb96e4d42d6adbd0644f1a15b40a`；当前分支：`nkustudy-dev`。本文是待确认需求和实施入口清单，不是已生效配置，也不授权接入真实 Wiki、填写秘密、推送、部署或修改实现。

## 1. 先区分三个独立对象

| 对象 | 当前事实 | 不能混用 |
|---|---|---|
| 程序仓库 | 本仓库含 React、Express、Electron、程序 CI/release | 其 origin、main/web-edit CI 不代表未来 Wiki 内容仓库或发布规则 |
| Wiki 内容仓库 | 服务端由 `settings.vault.path` 指定；尚未指定真实目标 | 不能默认等于本程序 checkout 或当前 QUT 默认远端 |
| 私有应用状态 | `DATA_DIR` 中 settings、索引、shares、UI 状态 | 不应混进 Wiki Git 仓库；同时不能忽略 Wiki `.git/config` 内的派生鉴权 URL |

代码依据：`server/src/services/vault.ts:51-66`、`server/src/services/git.ts:34-39,107-122,566-570`、`server/src/config.ts:60-69`。完整架构与有效资源见 [architecture-audit.md](architecture-audit.md)。

## 2. 当前默认值不是 NKUStudy 的产品决定

| 项目 | 当前源码值 / 规则 | 权威消费位置 | NKUStudy 待决定 |
|---|---|---|---|
| 页面品牌 | QUT WiKi 编辑器 | `web/index.html:13`、`web/src/lib/i18n.ts:53` | 展示名称、图标、关于/支持信息 |
| Git remote | 空字符串 | `server/src/services/settings.ts:54`、`git.ts:109` | 独立 Wiki 的准确 remote；不填程序仓库 remote |
| PR owner/repo | `QUT-Lib/QUT-WiKi` | `settings.ts:76-77`、`git.ts:588-589` | 未来 Wiki 的 owner/repo，必须显式一致 |
| 编辑分支 | `github.editBranch=web-edit` | `settings.ts:79`、`git.ts:126-128` | 是否保留 web-edit；guest 当前硬编码同名 |
| PR base 分支 | `github.baseBranch=contribute` | `settings.ts:80`、`git.ts:592` | 审核/合并目标，不应直接猜为 main |
| 旧 Git branch | `git.branch=main` | `settings.ts:55`、`git.ts:128,592` | 只在部分 GitHub 字段为空时回退；不是单一总开关 |
| 内容根 | `vault.root=''` | `settings.ts:41`、`vault.ts:62-66` | Wiki 的真实内容子目录，不能照搬 docs/start |
| Guest 编辑目录 | `publicEditor.editableRoot=docs/start` | `settings.ts:112`、`guestpath.ts:25-31` | 与内容根一起确定，路径口径是相对 Wiki 仓库根 |
| 公开编辑 | false | `settings.ts:106-114`、`middleware/auth.ts:27-52` | 是否真的需要匿名写/投稿；当前存在上线阻断问题 |
| 附件目录 | attachments | `settings.ts:38`、`routes/files.ts:164-166` | 相对内容根的目录，及图床失败策略 |
| 自动同步 | git.enabled=false、autoSync=false、autoCommitOnSave=false | `settings.ts:53,59-60` | 保存是否允许自动外发；与手工投稿不同 |
| 自动 PR / 跟进 | autoPullRequest=true、autoFollowBase=true | `settings.ts:82,86` | 开启 Git 后是否接受这些后台行为 |
| 作者身份 | WebObsidian / webobsidian@localhost | `settings.ts:57-58`、`git.ts:149-152` | 是否只代表机器人，是否另需贡献者审计 |
| 提交消息规范 | 中文前缀 + 描述 | `services/commitTemplate.ts`、`git.ts:549-557` | 与未来 Wiki CI 保持一致，不能假定对方已配置 |

已有 `settings.json` 优先于初次默认值（`settings.ts:196-224`）。**仅修改源码 defaults 不会更新已存在的实例配置**；未来实施要把新装默认值与已有实例迁移分开记录。

## 3. 配置入口与实际生效链

### 3.1 Node / Docker / Electron

| 配置项 | 实际作用 | 生效规则与证据 |
|---|---|---|
| `HOST`、`PORT` | Node 服务监听 | 默认 0.0.0.0:8787；`server/src/config.ts:58-59` |
| `HTTP_BIND`、`HTTP_PORT` | Compose 宿主端口映射 | 默认 0.0.0.0:8787 → 容器8787；不是 Node env 替代品；`docker-compose.yml:7-10` |
| `VAULT_HOST_PATH` | Compose Wiki bind mount 源 | 默认 `./sample-vault` → `/vault`；`docker-compose.yml:25-28` |
| `VAULT_PATH` | 首次设置的 vault 根 | Node 默认相对 cwd 的 `./sample-vault`；Compose 设 `/vault`；已有 settings.vault.path 优先；`config.ts:61`、`settings.ts:152,196-224` |
| `DATA_DIR` | 私有状态目录 | Node 默认 `./data`；Compose `/data` named volume；Electron `<userData>/server-data` |
| `ALLOWED_ROOTS` | 初始目录浏览/选择范围 | 持久化 settings 及 owner 请求可参与优先级，不是不可更改的 OS 安全边界；`routes/settings.ts:112-136` |
| `WEBOBSIDIAN_PASSWORD` | 恢复/override 密码 | 持续额外接受，不覆盖正常用户密码，不是“一次性初始化”；`services/auth.ts:62-88` |
| `TRUST_PROXY` | Express 对代理头的信任 | 默认 true；应按真实代理拓扑配置；`config.ts:46-54`、`index.ts:70` |
| `COOKIE_SECURE` | session cookie Secure | auto 默认跟随 req.secure；true/false 强制覆盖；`routes/auth.ts:22-33` |
| `WEBOBSIDIAN_WATCH` | native/polling watcher | auto 默认；polling 可强制；`index.ts:219-225` |

当前启动脚本没有 `dotenv` 或 `--env-file`，config 直接读 `process.env`（`server/package.json:7-11`、`server/src/config.ts:57-65`）。`.env.example` 首先服务 Compose；裸 Node 不能只复制 `.env` 就认为配置已加载。运行目录不同还会改变相对路径含义，后续部署文档应使用经确认的绝对路径。

Electron 自行提供 loopback 地址、随机端口、选定 vault、HOME allowedRoots 和 per-install override secret，强制非 Secure 本地 HTTP cookie（`desktop/src/main.ts:87-105`）。它不是远程 Linux 服务的部署模板。

### 3.2 Owner 设置 API 与秘密

`PUT /api/settings` 要求 owner，可更新 vault、git、github、upload、search、ui 及 API 限流；**没有 publicEditor 更新分支**（`server/src/routes/settings.ts:15,35-64`）。因此启用公开模式目前不是一个已验证的设置 UI 流程；本轮不通过手改真实 settings 补出这个流程。

Git PAT、App 私钥和图床 key 在响应中遮盖，只有非空且非遮盖值时才覆盖（`routes/settings.ts:40-57`、`services/settings.ts:254-261`）。不应让操作者在报告、截图、聊天或程序仓库提交中填写原值。

`github.appEnabled` 的注释称开关，但 `getGithubAppConfig` 只看 `appId/privateKey/installationId` 是否齐备（`services/githubApp.ts:23-37`）。不能把 `appEnabled=false` 描述成已关闭网络授权；是否新增真实开关属于待确认实现。

### 3.3 GitHub 目标与分支需要成组确认

| 使用者 | 当前取值链 | 不一致风险 |
|---|---|---|
| Git transport | `git.remote` + App 优先、PAT 回退 | 配置 remote 与 App installation 未经真实验证 |
| PR / Actions 仓库 | 非空 github.owner/repo 优先，否则解析 remote | QUT defaults 可使 PR 指向旧仓库，即使 remote 已换 |
| Owner push | github.editBranch → git.branch → web-edit | 与本地当前分支名称不要求相同，推的是 HEAD refspec |
| Guest push | 固定 web-edit | 改 github.editBranch 不会改变 guest 目标 |
| PR head | github.editBranch → web-edit | 可能与 guest push 不同 |
| PR base | github.baseBranch → git.branch → contribute | 需要与 Wiki 分支政策一致 |
| Actions workflow | 固定 sync-web-edit.yml，ref 为 base | 未来 Wiki 必须另行提供/确认，不在本程序仓库里实现 |

依据：`git.ts:107-128,562-604,671-715`、`routes/git.ts:81`。建议在产品确认后用一份非秘密配置矩阵同时核对 remote、owner/repo、installation 目标、edit/head/base 与 workflow；不能只替换品牌字符串然后视为迁移完成。

App 权限应以最后保留的能力决定。当前代码用 App 读取/写入 Git 内容、查询/创建 PR；只有保留 workflow dispatch 才需对应 Actions 能力（`githubApp.ts:131-168,207-227`）。实际最低权限、安装到哪个仓库、branch protection 是否阻止直推均需目标仓库管理者确认；本次没有验证或授予权限。

## 4. 需要改源码的适配入口与可保留能力

| 适配点 | 文件位置 | 处理建议（尚未实施） |
|---|---|---|
| 页面品牌 | `web/index.html:13`、`web/src/lib/i18n.ts:53` | 确认 NKUStudy 编辑器名称后替换；保留上游许可证归属 |
| PR 默认文案 | `server/src/services/git.ts:593-596` | 当前写 QUT WiKi 在线编辑器；与已确定品牌一致 |
| GitHub User-Agent | `server/src/services/githubApp.ts:85,144,189,220` | 品牌性适配；不是安全授权字段 |
| 默认目标 | `server/src/services/settings.ts:76-80` | 待真实 Wiki 决定；生产目标不应由未经确认的 QUT 默认值隐式承担 |
| Guest 分支约束 | `server/src/routes/git.ts:81` | 如更换 editBranch，要同步设计与验证 guest/PR 绑定，而非全局替换字符串 |
| 内容树显示 | `settings.ts:42-48`、`vault.ts:151-189`、`web/src/components/Settings.tsx:107` | folderLabels、folderOrder、useDocTitles 已可配置；只基于真实目录填值 |
| Wiki 自定义组件 | `web/src/lib/wikiComponents.ts`、`web/src/lib/markdown.ts:11` | Vue 风格标签的静态 HTML 适配；先调查 NKUStudy 内容是否使用，再决定保留/缩减 |
| CSS qut 类名 | `web/src/lib/wikiComponents.ts:148-210` 与样式引用 | 内部类名不是外部仓库目标；重命名需一起检查渲染兼容性，不宜机械全仓替换 |
| 提交模板 | `server/src/services/commitTemplate.ts`、`git.ts:549-557` | 与 Wiki 内容 CI 约定一致；程序 CI 不能代替这一确认 |
| 自动跟进契约 | `server/src/services/git.ts:703` | 固定 workflow 名；决定由编辑器还是 Wiki Actions 负责跟进及失败处理 |
| 安全报告入口 | `SECURITY.md:8-10` | 当前为上游维护者入口；NKUStudy 维护者与联系方式尚未指定，不能代填 |

已存在的预览、源码/live/reading、搜索、链接、图谱、Canvas、附件、版本历史等功能不因品牌变更自动删除。相反，插件、公开分享、API key、图床和自动同步会增加独立权限面，是否保留应按实际产品需求决定。

## 5. 必须先确认的产品问题

| 议题 | 当前实现事实 | 需要的决定 |
|---|---|---|
| 匿名编辑 | 公开模式下任何无令牌请求均可成为 guest | 是开放匿名写，还是只读预览/登录后投稿？ |
| 草稿隔离 | 所有访客写入同一服务端工作区 | 是否接受互相看见/覆盖未投稿内容，还是需要用户/会话隔离？ |
| 阅读范围 | 文件树和读接口以整个内容根提供内容 | guest 是否只可读取 editableRoot，还是内容根全部公开？ |
| 投稿归属 | Git 作者来自服务器配置 | 是否要求贡献者身份、同意声明、追溯记录？ |
| 审核与发布 | push 与 PR 是分开的步骤；PR 失败不回滚 push | 必须先审核才能发布吗？由谁合并、哪条分支触发站点发布？ |
| 自动外发 | 保存可触发可选 autoCommitOnSave/sync | 是否允许未点击“投稿”就外发？初版是否关闭所有自动写远端？ |
| 图片 | 图床代理或本地 attachment fallback | 是否允许访客上传，额度、格式、保留/删除策略是什么？ |
| 扩展面 | 插件、分享、API key 均是独立能力 | 初版确实需要哪些？owner 是否允许安装任意社区插件？ |
| 运行方式 | Node、Compose、Electron 均存在 | NKUStudy 首选哪种，后续其他方式是否仍算支持范围？ |

这些决定尚未确认，本文不替用户选择，也不把现有默认值当作已接受的需求。

## 6. 实施前提与集中验证准备

目前已知 P0 是 guest 内容经保存/索引链触发服务器上下文执行，主控使用隔离环境无害 marker 已复现。其他权限、上传和 Git 边界结论见 [security-audit.md](security-audit.md)。**不能在保留该问题时开放匿名写或把服务暴露给不可信调用者。** 这里是基于已证实问题的上线阻断，不是因为尚未填产品问卷。

本地 Mac arm64/Node 22.23.4 的隔离副本 安装命令 `npm ci --ignore-scripts` 返回0，组合命令最终退出0确认build成功；typecheck日志无错误，但未单独记录退出码（见evidence/README.md）；这只能证明当前本地构建结果，不能替代 Linux AMD64、Docker 服务、GitHub App、真实 Wiki、上传、设备体验或业务验收。

未来实施应按依赖推进，并保留每层证据：

1. 获得下一阶段实施授权后，先冻结修复候选；解析安全、统一最终路径校验等不依赖产品选择的修复可先推进。产品规则及非秘密目标矩阵须在对应适配功能开始前确认，不要求全部问卷答完才能修安全问题。
2. 依据安全报告修复并在隔离内容副本做针对性复验；不得用接入真实凭据来验证已知执行风险。
3. 在候选中完成品牌、目录/分支契约与实例配置迁移；不把源码默认修改当作已有实例已迁移。
4. 按最终目标平台验证构建、启动、持久化、索引、备份和恢复；记录候选哈希及实际路径，不复用本地 Mac 证据冒充服务器证据。
5. 仅在用户明确授权真实集成后，核对 Wiki 仓库、权限、分支保护、PR 目标、Actions 与发布责任；外部写入逐项记录结果，不把“不知是否成功”当作可以重试。
6. 按 owner、guest/API key、分享角色集中验证允许与拒绝路径，再由用户进行真实使用验收。完整操作清单须绑定最终候选；本轮没有让用户操作尚未部署的功能。

当前状态：**审计/配置文档已准备；产品要求待确认；实现未开始；安全修复与部署未完成；真实业务未验收。** 部署侧准备和明确前提见 [deployment-plan.md](deployment-plan.md)。

## 收尾核收补充：Git 开关与隔离边界

`git.enabled=false` 约束后台自动同步、保存触发同步和自动跟进，但不是所有 Git 操作的总开关。手工 `/api/git/sync` → `syncImpl` 没有同等开关校验（`server/src/routes/git.ts:73-100`、`server/src/services/git.ts:836-888`）。将 `git.remote` 设为空也不会清除已有 `.git/config` 的 origin（`git.ts:562-570`）。首轮隔离依靠全新 Data/Vault、无真实凭据或远端以及禁外连网络；不能仅设布尔开关就认定没有外部写入。
