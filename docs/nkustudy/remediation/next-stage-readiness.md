# 第4B阶段准入判断

## 结论

**CONDITIONAL：主体修复完成，准入范围仅为下一阶段独立 AMD64 构建与隔离测试准备；不是共享服务器、公开上线或正式Wiki接入许可。** 最终证据及候选见 remediation-summary.md、regression-results.md：完整83项、类型检查和构建已通过。

本轮没有执行4B：没有Docker构建/启动、SSH、Caddy变更、真实GitHub push/PR/App或图床写入。

## 本地安全门槛

S01/S02/S03/S04/S05/S06/S08、R01/R02已形成实现、真实路由/文件/index/commit tree/branch正反例。S07亦修复。独立审查发现的目标漂移、未决回执假成功、祖先串带与正常Sync回归均已增加测试。最终PASS数量及退出码必须查regression-results.md，不能使用早期分模块记录替代最终候选。

## 明确的非阻断遗留

1. npm audit server仍有2个high包条目（Chokidar→braces一条根因），web为0。watcher现在禁glob并监听一个固定物理目录，含花括号目录的真实启动/事件回归通过；并未宣称依赖公告已清零。后续评估Chokidar6升级，重新开放glob前必须先解决该链。
2. 原生Linux AMD64、容器UID/挂载/健康/内存、备份恢复、TLS浏览器与完整图表预览尚未测试。这些正是4B独立环境需要完成的验证，不能把Mac证据当目标平台通过。
3. GIT-09仅普通二进制/rename/delete已测；真实LFS工具、pointer和对象恢复未测。首轮测试禁LFS与大附件；启用前专项验证。
4. 当前settings/.bak仍可能持有运行秘密；4B仅新Data和自造一次性凭据，不导入旧Data/真实App/PAT。真实集成前确定秘密存储/轮换/恢复策略。
5. 当前支持单实例独占Vault/Data；不要让另一个服务或用户并发改同一文件树。内容symlink拒绝；动态切换Vault在4B先固定配置并重启，复核索引和watcher。

## 4B的必要前置与顺序（本轮未执行）

1. 用户另行授权4B，冻结本轮代码提交和lock哈希。使用全新测试Vault/Data及自造凭据；保留本轮历史证据。
2. 按 ../deployment-plan.md 落地独立构建配置：build阶段原生ARM，runtime为AMD64；固定镜像来源，严格安装；不把ARM node_modules复制到AMD64。
3. 只用独立project、专属目录、loopback空闲端口，不能直接运行仓库原Compose默认配置。候选端口28787必须先检查空闲，不占8787/18787/8080。
4. 非root、最小挂载、禁外连、资源与日志限额；配置setup/恢复入口由操作者私下提供，不在聊天或日志打印。实际代理另设TRUST_PROXY白名单，不能误把默认false改成盲信所有来源。
5. 在独立目标环境先构建/启动、健康+认证+小文件+资源边界，再验证持久化与完整恢复。共享服务器现有服务容量与共存验收属于更后授权，不在此自动放行。
6. 真实Wiki、App、remote/edit/base、PR审核、发布分支、身份/草稿/附件业务策略均未确定，不得自行填写。首轮Git仍本地bare/mock。

## 上传测试默认值

普通附件8MiB（可配至64MiB），图片4MiB（可配至16MiB），并发2（至4），multipart接收30秒（至120秒），图床请求10秒；JSON请求2MiB，frontmatter64KiB。可调项详见 services/uploadPolicy.ts；这是保守测试默认值，不是1.6GiB主机容量实测或最终业务额度。
