# 证据说明与复核边界

日期2026-10-22；基线e2201591c02ecb96e4d42d6adbd0644f1a15b40a。原执行聊天：“审计 WebObsidian 开发准备”（01a162af-f0cd-7520-b9d5-92db43097794）。收尾复用原隔离记录，没有重跑应用。

| 文件 | 证明什么 | 不证明什么 |
|---|---|---|
| probe.mts / probe-results.json | 自造Vault/Data挂载真实router的HTTP结果；直接调用Git服务并读取commit tree | 非完整生产启动；无TLS、真实GitHub/PR；HTTP样例未逐个记录前后文件哈希 |
| marker.mts / marker-results.json | 保存合法路径Markdown后同进程无害标记变化 | 无系统命令、秘密读取或外部网络；非生产攻击记录 |
| typecheck.log | server/web类型检查原日志，无错误输出 | 未单独记录退出码，不能替代修复候选重验 |
| build.log | Vite与tsc日志，原组合shell最后退出0 | 非Docker/AMD64/服务启动证明；仍有前端体积告警 |
| server-audit.json / web-audit.json | 同日npm audit生产依赖快照 | 不等于项目已利用漏洞，不涵盖所有dev/desktop风险 |
| advisory-details.json | 原窗口GitHub Advisory API的39条公告原件 | 不保证以后未更新，不是升级兼容验收 |
| SHA256SUMS | 收尾时上述原始证据字节校验 | 不独立证明执行时间或环境可信度 |

原环境Apple Silicon Mac、Node22.23.4。原冻结源码副本的 `npm ci --ignore-scripts --no-audit --no-fund` 返回0。随后server/web的 `npm audit --omit=dev --workspace … --json`、typecheck和build在一个顺序shell命令执行；组合exit0直接反映最后build成功。typecheck仅保留日志，不补造独立退出码。禁安装脚本的结果不替代正式镜像安装验证。

## 脚本布局与后续复核

本目录仅归档。两脚本相对导入 `../server/src/...`，不能直接从当前evidence位置运行。应从冻结提交归档到**新临时源码副本**，把脚本放到副本根下 `artifacts/probe.mts` 或 `artifacts/marker.mts`，从副本根执行对应本地tsx。每次使用新副本和全新fixtures/rce-fixture，不复用真实Vault/Data或原证据目录。

先审阅脚本与锁定依赖，安装在副本进行；运行期禁外连仅允许loopback，清除真实凭据环境并使用临时HOME/Git配置。脚本有删除、改密码、本地Git提交，只准自造数据。假密码不得换成真实值。原记录直接复用，本轮不要求用户重跑。

后续回归另存：每个命令单独退出码，记录候选、lock/脚本哈希、环境、时间、HTTP结果及文件/索引/commit差异。等待索引使用明确完成条件，不只依赖原marker脚本300ms延时。拒绝结果须同时断言无副作用，不能覆盖原证据为PASS。

保留反例：封闭匿名/guest拒绝、内容根外路径及外指symlink拒绝、直接private写拒绝、guest trash管理拒绝、login限流生效。Linux反斜杠、JSON百分号字面与query解码不能混同。

证据不授权公开披露、推送、真实凭据操作或生产复现。

