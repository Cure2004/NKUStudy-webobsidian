# r3 本地验证记录

日期：2026-10-23（Asia/Shanghai）。**本地修复 PASS；服务器上线 CONDITIONAL，未部署。**

环境：Mac ARM64，Docker Desktop 的 Linux AMD64 仿真容器，原冻结 r2 镜像；本地原生 Caddy **2.11.7**，下载归档与官方 SHA512 清单匹配。TLS 使用独立自签测试证书，Python 客户端显式信任该证书并验证 localhost；Chrome 测试仅对这个隔离浏览器上下文忽略自签证书错误。没有安装系统根证书、申请公网证书或访问真实预览站点。

## 验证结果

| 项目 | 实际结果 |
|---|---|
| 原 r2 HTTPS 登录 | 403，正文为 Cross-origin write rejected，成功复现根因 |
| r3 同源 HTTPS 登录 | 200，既有快照中的应用密码可用，无需重新 setup |
| HTTPS Cookie | Set-Cookie 含 Secure、HttpOnly、SameSite=Lax、Path=/；真实 Chrome 存储并使用它 |
| 退出 | 跨源退出403且原会话保留；同源退出200，Chrome删除Cookie，旧会话API/WSS均401 |
| 非法 Origin | 不同域、http协议、不同端口、null、尾斜杠、伪装子域的登录写入均403；带owner会话的跨源写入403 |
| 伪造转发头 | 客户端 http,https/XFH/XFF/Forwarded 被 Caddy 规范化；合法 HTTPS 登录仍返回 Secure Cookie，伪造XFP不能放行HTTP Origin |
| 外层 Basic | 缺失/错误401；仅Basic不能获得owner；只读旁路观测确认进入relay前 Authorization/Proxy-Authorization/Forwarded均不存在，Origin原样保留 |
| 应用/API权限 | 无会话读写401；owner可读写；无效/缺失/撤销API key401；X-API-Key只读权限读200、写403 |
| WebSocket | 合法WSS 101并收hello；无应用会话、无Basic、撤销会话401；跨主机/跨协议/null来源403；带双层认证的无Origin非浏览器连接可用 |
| 真实浏览器 | Chrome 6项检查通过，含HttpOnly不可由JS读取、WSS携带Basic缓存与会话、退出后Cookie删除和API401 |
| 快照迁移 | r2停止快照恢复至独立r3命名卷；setup.env不传播；旧密码、原Markdown、新写入和重启后读取通过 |
| 资源隔离 | app512MiB/0.50CPU/96PID，relay128MiB/0.10CPU/32PID，swap0；实际cgroup v2四项由start/status/resume验证；UID1000、只读、cap-drop、网络/挂载限制通过 |
| 防覆盖/冲突 | 错快照hash拒绝且不建目标；已有restore目标拒绝；占用28787时新start失败且无新容器 |
| 回滚 | 先停r3再恢复旧夹具；旧卷全部Markdown SHA与停止快照相同，新r3文件不在旧卷；回滚仍呈现旧HTTPS403，未冒充修复成功 |
| 保留性 | 原r2完整文件集合及全部SHA不变；既有仓库状态不变；原停止快照字节不变；新测试容器全部已停，测试卷/state保留 |

主测试使用 **Caddy→原TCP relay→原AMD64 app**。单独的头部观测路径在 Caddy 与 relay 之间加透明字节转发观察器；只记录头部存在性及非秘密策略字段，不记录 Authorization、Cookie、密码或请求体。正常HTTP/WSS及浏览器验证走直接链路。

## 数量与失败记录

- 真实保存归档及变异反例：**23/23 PASS**。包含实际OCI、classic投影、三类ID、架构、source label、entrypoint、blob、解压层digest、tag等。classic投影不是另一种Docker引擎的真实load证据。
- 原命名卷/快照/cgroup合同适配新模块：**35/35 PASS**。这是受控合同，不是服务器运行证据。
- 新r3文件集合、SHA、元数据、代理环境和资源漂移合同：**115/115 PASS**。
- 完整HTTPS演练 run02：**90条回执，89条原始通过，1条测试预期差异保留**；后续回滚补证 **9/9 PASS**；真实Chrome **6/6 PASS**。不将这些不同口径合并称为同一种测试。

两次异常没有被删除或改成原始PASS：

1. 首次运行中，旧容器停止后 Mac 的28787短时间仍不可绑定，r3 start正确失败关闭。旧现场保留。独立run02等待端口可绑定后启动，通过；回滚前再次等待释放实际用时约30.1秒。未削弱端口检查。
2. run02回滚验证尝试读取不存在的 `r3-new.md`，测试假设应404，旧镜像实际500。源码 `files.ts` 直接读文件，`error.ts` 对无status的ENOENT默认500。保留原FAIL；独立补证直接只读检查旧卷文件不存在，并将旧卷全部Markdown哈希与原快照比较一致，关闭“数据是否混入”的疑问。该既有错误状态码未在本轮修改。

执行过的run02测试源码另存于审计证据。可重用测试脚本只把上述错误HTTP断言替换为直接文件不存在检查，未声称重新完整执行修改后的脚本。恢复补证脚本则已真实执行。

## 最终发行验证

最终文档加入后，运行代码与173项合同和动态测试时一致；重新生成部署元数据/全包清单，从最终归档解出的独立副本再运行完整包门禁及原镜像归档验证。结果见归档旁的 `.verification.json`。完整归档SHA256见旁边的 `.sha256` 文件，避免自引用哈希。

发行包内未包含测试密码、Cookie、API key、TLS私钥、私有快照、state或原始Caddy日志。审计文件的哈希与清单独立保存。

## 仍待现场核验

真实Caddy配置、服务器r4身份/路径/卷、服务器回环与Docker网络信任、实际公网证书、Ubuntu上的r3运行及用户业务验收，均未在本轮发生。原Ubuntu r2验收由用户提供，不等同于r3已上线。若现有Caddy不能满足头清洗/凭据剥离/WS Origin gate，先阻断上线并准备另行授权的配置修订；不得弱化认证完成任务。
