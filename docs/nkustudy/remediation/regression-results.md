# 4A 实际回归结果

代码候选：`1bd3f6c088466c8b46b447c9516cec623bc194f6`。环境：macOS arm64、Node v22.23.4、npm10.9.9、Git2.50.1；不是Linux AMD64或生产证据。

最终完整套件：**83 tests / 83 pass / 0 fail / 0 skipped，exit 0**。数量为Node runner统计，含分组测试；不等于矩阵行数。

## 采用的最终命令回执

| 命令 | 退出码 | 回执 / 日志 |
|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | 0 | [final-clean-install-2026-10-22T10-08-46-174Z.json](final-clean-install-2026-10-22T10-08-46-174Z.json) / [log](final-clean-install-2026-10-22T10-08-46-174Z.log) |
| `npm run test:security` | 0 | [acceptance-suite-2026-10-22T10-20-35-025Z.json](acceptance-suite-2026-10-22T10-20-35-025Z.json) / [log](acceptance-suite-2026-10-22T10-20-35-025Z.log) |
| `npm run typecheck` | 0 | [release-typecheck-2026-10-22T10-09-50-080Z.json](release-typecheck-2026-10-22T10-09-50-080Z.json) / [log](release-typecheck-2026-10-22T10-09-50-080Z.log) |
| `npm run build` | 0 | [release-build-2026-10-22T10-11-49-929Z.json](release-build-2026-10-22T10-11-49-929Z.json) / [log](release-build-2026-10-22T10-11-49-929Z.log) |
| `npm --workspace desktop run typecheck` | 0 | [release-desktop-typecheck-2026-10-22T10-15-13-191Z.json](release-desktop-typecheck-2026-10-22T10-15-13-191Z.json) / [log](release-desktop-typecheck-2026-10-22T10-15-13-191Z.log) |
| `npm ls --omit=dev --all` | 0 | [release-dependency-tree-2026-10-22T10-09-50-081Z.json](release-dependency-tree-2026-10-22T10-09-50-081Z.json) / [log](release-dependency-tree-2026-10-22T10-09-50-081Z.log) |
| `npm audit --omit=dev --workspace server --json` | 1 | [server-audit-release-command.json](server-audit-release-command.json) / [JSON](server-audit-release.json) |
| `npm audit --omit=dev --workspace web --json` | 0 | [web-audit-release-command.json](web-audit-release-command.json) / [JSON](web-audit-release.json) |

生产依赖扫描server退出1是剩余2个high条目，不是零风险结论；web退出0。详见dependency-review.md。构建未触发Electron发布、GitHub Actions或Docker。

## 逐项矩阵

| 用例 | 状态 | 实际范围 / 测试文件 |
|---|---|---|
| PAR-01 | PASS | 真实路由/服务解析与正常数据；无害marker；`server/test/markdown.test.ts` |
| PAR-02 | PASS | 真实路由/服务解析与正常数据；无害marker；`server/test/markdown.test.ts` |
| PATH-01 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-02 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-03 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-04 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-05 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-06 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-07 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-08 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-09 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-10 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| PATH-11 | PASS | 物理路径、正反例及文件/索引/Git副作用；含合法递归操作；`server/test/paths.test.ts` |
| UPL-01 | PASS | 小尺寸受控夹具；不是1.6GiB容量或512MiB压力证明；`server/test/uploads.test.ts` |
| UPL-02 | PASS | 小尺寸受控夹具；不是1.6GiB容量或512MiB压力证明；`server/test/uploads.test.ts` |
| UPL-03 | PASS | 小尺寸受控夹具；不是1.6GiB容量或512MiB压力证明；`server/test/uploads.test.ts` |
| UPL-04 | PASS | 小尺寸受控夹具；不是1.6GiB容量或512MiB压力证明；`server/test/uploads.test.ts` |
| UPL-05 | PASS | 小尺寸受控夹具；不是1.6GiB容量或512MiB压力证明；`server/test/uploads.test.ts` |
| UPL-06 | PASS | 小尺寸受控夹具；不是1.6GiB容量或512MiB压力证明；`server/test/uploads.test.ts` |
| AUTH-01 | PASS | 真实HTTP/独立子进程；会话/初始化/旧配置；`server/test/auth.test.ts; server/test/settings.test.ts` |
| AUTH-02 | PASS | 真实HTTP/独立子进程；会话/初始化/旧配置；`server/test/auth.test.ts; server/test/settings.test.ts` |
| AUTH-03 | PASS | 真实HTTP/独立子进程；会话/初始化/旧配置；`server/test/auth.test.ts; server/test/settings.test.ts` |
| AUTH-04 | PASS | 真实HTTP/独立子进程；会话/初始化/旧配置；`server/test/auth.test.ts; server/test/settings.test.ts` |
| AUTH-05 | PASS | 真实HTTP/独立子进程；会话/初始化/旧配置；`server/test/auth.test.ts; server/test/settings.test.ts` |
| AUTH-06 | PASS | 持久化结构、IO故障、坏配置实际启动；测试启动期限调整后独立复核；`server/test/settings.test.ts` |
| GIT-01 | PASS | 本地Git/bare及mock API；含实际index/tree/refs与未知回执；`server/test/git.test.ts` |
| GIT-02 | PASS | 本地Git/bare及mock API；含实际index/tree/refs与未知回执；`server/test/git.test.ts` |
| GIT-03 | PASS | 本地Git/bare及mock API；含实际index/tree/refs与未知回执；`server/test/git.test.ts` |
| GIT-04 | PASS | 本地Git/bare及mock API；含实际index/tree/refs与未知回执；`server/test/git.test.ts` |
| GIT-05 | PASS | 本地Git/bare及mock API；含实际index/tree/refs与未知回执；`server/test/git.test.ts` |
| GIT-06 | PASS | 本地Git/bare及mock API；含实际index/tree/refs与未知回执；`server/test/git.test.ts` |
| GIT-07 | PASS | 本地Git/bare及mock API；含实际index/tree/refs与未知回执；`server/test/git.test.ts` |
| GIT-08 | PASS | 本地Git/bare及mock API；含实际index/tree/refs与未知回执；`server/test/git.test.ts` |
| GIT-09-binary | PASS | 普通二进制/rename/delete的提交树；`server/test/git.test.ts` |
| GIT-09-LFS | NOT-RUN | 真实LFS安装/pointer/对象还原未覆盖；4B首轮不用LFS；`none` |
| SHARE-01 | PASS | 分享口令/限流/撤销/协议cookie属性；`server/test/shares.test.ts` |
| WEB-01-protocol | PASS | HTTP与模拟可信代理属性；不代表真实TLS浏览器；`server/test/auth.test.ts; server/test/transport.test.ts` |
| WEB-02-protocol | PASS | 外Origin JSON/form/multipart拒绝且无写副作用；正常请求允许；`server/test/transport.test.ts; server/test/startup.test.ts` |
| WS-01 | PASS | 真实WebSocket upgrade及撤销后事件阻止；`server/test/transport.test.ts` |
| LOG-01 | PASS | 假sentinel URL与图床错误；并非所有日志路径穷尽；`server/test/transport.test.ts; server/test/uploads.test.ts` |
| WEB-01-browser-TLS | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| WEB-03-browser-XSS | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| SHARE-02-complete | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| API-01-02-full-lifecycle | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| UI-01 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| UI-02 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| UI-03 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| UI-04 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| UI-05 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| BUILD-03 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| BUILD-04 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| DEP-01 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| DEP-02 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| DEP-03 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| DATA-01 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| DATA-02 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| DATA-03 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| COEX-01 | NOT-RUN | 目标环境/浏览器/完整恢复或真实共存验收不在本轮执行；见next-stage-readiness；`none` |
| READ-01-product | BLOCKED | 需产品决定全内容根公开还是仅读指定目录；代码保留现有全内容根读策略，不阻断固定夹具4B；`none` |

矩阵中NOT-RUN/BLOCKED不计入83个已执行测试；它们保留目标平台、产品和体验边界。原测试脚本仅在新临时目录操作，Git协议限制file，GitHub接口由内存fetch mock拦截，图床用loopback mock。

## 保留的失败与修正

- 一次API body替换误改分享请求，Web typecheck失败；已修复并在最终typecheck/build中通过。
- 路径测试曾未等待先前合法API写入的异步索引；修为等待真实完成条件。候选现在将文件mutation与索引更新绑定同一配置快照。
- 上传初版断连/完成状态判断及重复错误响应已修复，后续受控上传测试通过；错误模拟日志出现预期400/403/429/500不是套件失败。
- Git升级simple-git4的环境白名单、路径规范化和未知回执初版问题，均保留中间日志并由最终真实bare回归覆盖。
- `release-security-2026-10-22T10-09-50-080Z.json` 为82/83通过、exit1：坏配置启动子进程被5秒测试期限终止（status=null），未取得应用exit1。该轮本机10逻辑CPU、load约41，构建同时较慢；不能当作应用启动成功或产品修复失败。
- 将测试启动期限改为30秒，并新增“子进程必须自行结束、不能超时”的明确断言，错误配置仍必须exit1且原文件不变；独立11/11及最终完整83/83均通过。不是放宽生产限额或忽略失败。
- 原始阶段3 evidence文件的SHA256逐项核对不变。分模块/失败日志均保留，不将旧记录改写成PASS。

## 重跑

从此代码候选安装锁定依赖后执行 `npm run test:security`。如需保留独立退出码，执行 `node scripts/record-check.mjs <新名称> npm run test:security`；它会生成带时间戳的新日志和JSON，不覆盖旧结果。只使用该套件自建的临时数据，不填写真实Vault/Data/凭据。
