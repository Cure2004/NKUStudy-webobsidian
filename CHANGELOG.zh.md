# 更新日志

WebObsidian 的所有重要变更都记录于此。本项目在产品设计文档 [PRD.md](PRD.md) 中追踪其产品
设计与版本历史；下列条目汇总了面向用户的变更。格式大致参照
[Keep a Changelog](https://keepachangelog.com)。

## [Unreleased]

### Added
- 开源仓库脚手架：`README.md`（含 logo）、`LICENSE`（MIT）、
  `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、GitHub issue/PR 模板以及一个
  CI 工作流（typecheck、build、Docker 镜像）。
- 文件树的**复制 / 剪切 / 粘贴**，适用于文件和文件夹（会话级剪贴板；
  递归复制使用 `POST /api/files/copy`）。*（PRD 0.9）*
- **编辑分支自动跟进**（`github.autoFollowBase`）：在没有打开的 PR 时，定期将基础分支
  （`contribute`）合并到编辑分支（`web-edit`），使在线编辑始终基于最新的主分支。提交前
  检查会在 PR 仍未合并时阻止新的提交，而在 GitHub Actions 中断期间，它会派发
  `sync-web-edit.yml`（当 App 缺少 Actions 权限时回退到本地合并）。仅限所有者手动触发
  `POST /api/git/follow-base`。

### Changed
- ⋯ **更多选项**菜单重建，以与 Obsidian Desktop 保持一致：文档内反向链接、
  打开链接视图、在新窗口中打开、添加文件属性、笔记内查找、导出为 PDF、
  在导航中定位文件，以及每个文件的版本历史。*（PRD 0.8）*

### Fixed
- 容器健康检查现在探测 `http://127.0.0.1:8787/healthz`，而不再使用 `localhost`。
  在容器内部 `localhost` 解析为 IPv6 `::1`，而服务器只绑定 IPv4，
  因此检查失败，容器虽工作正常却被报告为 **unhealthy**。

## 按 PRD 修订版本划分的亮点

- **0.9** — 文件树复制/剪切/粘贴；递归复制端点。
- **0.8** — ⋯ 菜单与 Obsidian Desktop 对齐；每个文件的 Git 版本历史（FR-4）。
- **0.7** — 每条笔记的**分享对话框**（创建/复制/切换/密码/删除）+ 地球徽标。
- **0.6** — 自托管部署加固：所有部署参数通过 `.env` 配置，inotify 达到上限时的 watcher 轮询
  回退，更长的健康检查 `start_period`（FR-9）。
- **0.5** — 图谱节点搜索，带有平滑飞入与高亮（FR-2）。
- **0.4** — 移动端 / 响应式 UI：抽屉式侧边栏、边缘滑动、键盘上方的格式
  工具栏、触摸目标、安全区域内边距（FR-11）。
- **0.3** — 每个窗格的 ⋯ 菜单（分屏、书签、重命名/移动等）以及重新设计的右侧
  边栏标签栏（反向链接，含未提及链接 · 出站链接 · 标签 · 大纲）。
- **0.2** — 深度链接 URL（`/note/...`）、带集中管理的公开只读分享链接、
  面向 SEO 的服务端渲染（FR-10）。

## 核心（v1 基线）

- 兼容 Obsidian 的仓库（Vault）（可在现有的 `.obsidian/` 仓库上工作）。
- CodeMirror 6 编辑器，支持实时/源码/阅读视图；wikilinks、嵌入、标签、标注、
  任务、KaTeX、Mermaid；反向链接、大纲、图谱视图。
- QMD 全文 + 字段化搜索（MiniSearch），增量索引，磁盘持久化。
- 配合 Git LFS 的 GitHub 同步（拉取/提交/推送）。
- 单一主密码登录（scrypt + JWT cookie）。
- 位于 `/api/v1` 的作用域 Agent API，带哈希 API 密钥和速率限制。
- 针对 Obsidian-API 兼容层（子集）的社区插件加载器。
- 纯 JSON 配置（`data/settings.json`）；一条命令的 Docker 栈。

---

> 注意：WebObsidian 尚处于 1.0 之前，还未发布带标签的版本。一旦开始发布，
> 每个版本都会在此拥有自己带日期的章节。
