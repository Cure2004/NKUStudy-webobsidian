# CLAUDE.md — WebObsidian 项目上 Claude Code 的工作指南

## 背景
WebObsidian 是一个自托管的 web 应用，全面克隆 Obsidian。正式设计位于
[PRD.md](PRD.md)。开发进度在 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 中追踪。

## 强制原则（每次工作会话前阅读）

1. **始终紧扣 PRD.md。** 在编写某个功能之前，对照 PRD 中相应的 FR/NFR/API/数据
   模型部分进行核对。不要擅自更改架构或范围。如果认为需要偏离 PRD，
   **先更新 PRD.md**（写明原因，提升 version/changelog）然后再编码。

2. **始终更新 IMPLEMENTATION_PLAN.md。** 每当开始或完成一个条目时：
   - 更改复选框：`[ ]` → `[~]`（进行中）→ `[x]`（完成）。
   - 更新"最后更新"那一行，并向"进度日志"添加一行（日期 + 摘要）。
   - 只有当代码能运行/经过验证时才将条目标记为 `[x]`，而不是刚写完时。

3. **与 session 的 todo list 保持同步。** 内部 todo 必须反映计划中的各个条目。

4. **文档是事实来源。** 当范围根据用户请求发生变化时：在同一次变更中更新 PRD.md
   （设计）和 IMPLEMENTATION_PLAN.md（添加/修改条目）。

## 技术约定
- 语言：服务端和 web 端都使用 TypeScript。尽可能避免 `any`。
- 运行时配置：仅使用 JSON 文件（`data/settings.json`）——不要添加 DB engine。
- 安全：不记录 secret/token/API key；存储前先哈希；防范 path traversal。
- 仅在用户要求时才 commit/push git。

## 常用命令
```bash
npm install            # 安装整个 workspace 的依赖
npm run dev            # 运行 server + web（开发模式）
npm run build          # 先构建 web 再构建 server
npm run start          # 运行生产环境（server 提供已构建的 web）
npm run typecheck      # 对两个 workspace 做类型检查
docker compose up      # 运行完整技术栈
```

## 结构（参见 PRD §2.2）
- `server/` — Express API（routes、services、middleware、plugins shim）。
- `web/` — React SPA（components、lib、styles）。
- `data/` — 运行时配置与索引（gitignored）。
- `docs/` — 补充文档。
