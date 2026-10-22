# 第4A安全修复摘要

日期：2026-10-22（Asia/Shanghai）。结论：**CONDITIONAL**。

## 候选与范围

- 分支：nkustudy-dev。
- 冻结来源：e2201591c02ecb96e4d42d6adbd0644f1a15b40a。
- 修复代码提交：**1bd3f6c088466c8b46b447c9516cec623bc194f6**。
- package-lock SHA256：`671963de571dfc611e7f370482640455928bde108ed0e7c9383fd633f090d7ed`。
- A/B/C三个批次已整合为一个可审查代码候选；之后的文档提交只保存审计、回执与本页，不改变运行代码。
- [candidate.patch](candidate.patch) 是冻结来源到修复代码提交的完整diff；[candidate.json](candidate.json)记录逐文件哈希。

## 实际完成

S01–S08、R01/R02已完成本地修复与相应回归。额外收紧Origin/WS、日志、配置并发和后台Git边界。保留正常编辑/保存/搜索/登录/本地Git及受控投稿正例；没有把主要功能统一禁用。

最终 **83/83测试通过，0失败，exit0**。严格安装、生产依赖树、TypeScript、Web/Server构建和Desktop类型检查均exit0。原始阶段3证据逐项hash一致。详细结果见 [regression-results.md](regression-results.md)。

## 五份交付

1. 本文件：修复摘要与候选。
2. [security-fixes.md](security-fixes.md)：问题、源码、兼容变化与review闭环。
3. [regression-results.md](regression-results.md)：真实命令、退出码、逐项PASS/FAIL/BLOCKED/NOT-RUN。
4. [dependency-review.md](dependency-review.md)：依赖升级、剩余公告与可达性。
5. [next-stage-readiness.md](next-stage-readiness.md)：4B准入边界。

## 尚未完成与下一步

没有未解决的本地核心P0/P1技术阻断。剩余2个server high包条目来自Chokidar/braces同一根因；应用禁glob且字面目录watcher测试通过，依赖公告本身没有被消除。真实LFS、浏览器完整渲染/代理、Linux AMD64、内存共存和备份恢复尚未验收，不能标PASS。

身份/阅读范围/草稿隔离、正式Wiki及edit/base/发布分支、PR审核人与最终上传额度需要产品确认；初期4B可继续用固定自造数据、本地bare/mock，不填写真实目标。单实例独占Vault/Data；已知默认密码不再可用，初始化/恢复需操作者私下提供相应凭据。

本轮没有执行4B，没有SSH/生产/Caddy/Docker操作，没有真实Wiki、GitHub push/PR/App或图床写入。第4B另行授权后只做独立构建和测试环境；不能直接运行旧Compose默认配置或开放公网。

## Git与验收

本轮只做本地提交，不推送。上游feat/qut-fork继续固定在来源SHA。最初已有未跟踪 `docs/nkustudy.zip` 原样保留，不纳入提交；原审计目录与本轮文档在文档提交中保存。

用户本轮可集中核收：候选与修复范围、83项回执、明确遗留和4B边界。无须执行未部署的界面验收。若需要调整产品策略，请给出具体议题；本候选不自动继续部署。
