# 为 WebObsidian 做贡献

感谢你有兴趣改进 WebObsidian！本项目是自托管、单用户的，
并且以设计为驱动——在发起 PR 之前，请阅读下面的几条规则。

## 基本规则（来自 [CLAUDE.md](CLAUDE.md)）

1. **[PRD.md](PRD.md) 是设计的事实来源。** 在构建某个功能之前，请查阅
   对应的 FR/NFR/API/数据模型章节。如果你的变更会改变范围或架构，
   请**先更新 PRD.md**（说明原因，提升版本号/更新日志），然后再写代码。
2. **保持 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 同步。** 翻转复选框
   （`[ ]` → `[~]` → `[x]`），更新"最后更新"那一行，并添加一条进度日志条目。
   只有当代码实际运行/经过验证时，才标记为 `[x]`。
3. **文档是事实来源。** 当范围发生变化时，在同一次变更中更新 PRD.md *和*
   IMPLEMENTATION_PLAN.md。

## 技术约定

- 服务端和 web 端都使用 **TypeScript**。尽可能避免 `any`。
- **运行时配置仅使用 JSON**（`data/settings.json`）——不要添加数据库引擎。
- **安全：** 绝不记录 secret/token/API key；存储前先哈希；防范路径
   遍历。
- 与周围代码的风格、命名和注释密度保持一致。

## 开发环境设置

需要 **Node ≥ 20** 和 `git`（如果使用 LFS，则还需 `git-lfs`）。

```bash
npm install
npm run dev          # server :8787 + web 开发服务器 :5173（经代理）
```

在发起 PR 之前：

```bash
npm run typecheck    # 必须通过 —— CI 会运行此命令
npm run build        # 必须成功 —— CI 会运行此命令
```

## 拉取请求（PR）

1. Fork 项目，并从 `main` 创建一个主题分支。
2. 进行你的更改；保持提交聚焦、diff 最小。
3. 确保 `npm run typecheck` 和 `npm run build` 通过。
4. 如果你的更改涉及设计或范围，请更新 PRD.md / IMPLEMENTATION_PLAN.md。
5. 使用模板发起 PR；描述*改了什么*和*为什么*。

## 报告缺陷与请求功能

使用 GitHub issue 模板。对于安全问题，**不要**发起公开 issue——
请参阅 [SECURITY.md](SECURITY.md)。

通过贡献，你同意你的贡献依据
[MIT License](LICENSE) 进行许可。
