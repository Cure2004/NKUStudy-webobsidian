# NKUStudy WebObsidian 安全与可靠性审计

日期：2026-10-22（Asia/Shanghai）。程序基线：`e2201591c02ecb96e4d42d6adbd0644f1a15b40a`；本地分支：`nkustudy-dev`。

本文件收尾“审计 WebObsidian 开发准备”中的既有审计，复用原窗口的隔离运行记录，本轮只做源码与证据核收、文档整理。未修改业务实现、依赖或运行配置；没有生产、真实 Wiki、真实 GitHub App、push、PR 或部署测试。版本结论只适用于此锁定提交；没有推断其他 release 的受影响范围或修复状态。

## 1. 结论与证据边界

发现 8 项有源码支撑的问题：**P0 1 项、P1 6 项、P2 1 项**。S01–S05 有原窗口隔离执行记录；S06–S08 主要为源码确认，具体限制见各项。P0/P1 修复和对应回归完成前，不开放匿名编辑、不接入真实秘密或 Wiki、不进入联网与共享服务器测试。第 4 步可在获得实施授权后从本地修复开始，不能把本报告视为已经修复。

P0/P1/P2/P3 是本项目修复优先级；工具中的 critical/high/medium/low 为风险级别，不是 CVSS 评分。公告严重度也不等于本项目已验证影响。未证明所有 150 个源文件均经过完整安全审阅，覆盖保留为 partial；下面列出明确结论、反例及后续验证项，不宣称穷尽漏洞。

| ID | 级别 | 结论 | 证据层级 |
|---|---|---|---|
| S01 | P0 | 访客 Markdown 可触发服务端 JavaScript 解析 | 隔离执行记录 + 源码 |
| S02 | P1 | 访客可越过可编辑子目录边界 | 隔离执行记录 + 源码 |
| S03 | P1 | 上传生成的最终落点未经访客授权 | 隔离执行记录 + 源码 |
| S04 | P1 | 空提交选择扩大为内容根并携带已有暂存内容 | 隔离执行记录 + 源码 |
| S05 | P1 | 改密码接口允许访客进入且没有登录同等级限流 | 隔离执行记录 + 源码 |
| S06 | P1 | 512 MiB 内存上传缺少总量与并发约束 | 源码确认；动态覆盖有限或待验证 |
| S07 | P2 | 分享口令解锁接口缺少专用限流 | 源码确认；动态覆盖有限或待验证 |
| S08 | P1 | 新实例仍接受公开已知的默认管理员密码 | 源码确认；动态覆盖有限或待验证 |

证据入口：[运行记录说明](evidence/README.md)、[HTTP/Git 结果](evidence/probe-results.json)、[解析 marker 结果](evidence/marker-results.json)。原始脚本不是生产测试命令，不能在程序工作区或真实 Vault 执行。HTTP 200 主要证明路由执行与返回路径，未单独保存每个文件的前后哈希；本地 Git 结果确实检查了 commit tree；marker 结果检查了同进程标记。后续回归必须补上拒绝请求无副作用的断言。

## 2. 信任边界

- owner 由服务端签名会话确认；公开编辑关闭时匿名和 guest 被拒绝。开启时无凭据请求可以成为 guest（`middleware/auth.ts:27-52`）。
- `vault.path` 是内容仓库根，`vault.root` 定义文件服务内容根；guest 的 editableRoot 是更窄的写入范围。Git 使用仓库根。这三个边界不能互相替代。
- 保存的 Markdown 是不可信数据，不应获得 Node 进程执行能力；前端净化和 CSP 不能保护服务端解析器。
- Git push、PR 创建、合并、站点发布是不同动作；服务器持有的 App/PAT 权限不能因 guest 投稿而扩大其文件与分支权限。
- settings、备份、Wiki 的 .git/config、索引与日志涉及独立私有资源。文件响应遮盖秘密并不等于落盘或日志全面脱敏。

## 3. 已确认问题

### S01 — P0：访客 Markdown 可触发服务端 JavaScript 解析

**条件、调用链与影响：** 公开编辑开启时，匿名访客可在允许目录保存 Markdown；reindex → qmd/link index → parseNote → gray-matter 4.0.3 默认 JavaScript engine 执行输入。历史隔离运行 HTTP 200 且进程内无害 marker 改变。

**位置：** `server/src/services/markdown.ts:19-28`。

触发链：`routes/files.ts:90-101` 保存 → `reindex:52-55` → `services/search.ts:110,147` / 链接索引 → `services/markdown.ts:23`。原隔离依赖 gray-matter **4.0.3** 的 `lib/engines.js` 提供 JavaScript `eval` 引擎，`index.js:85-109` 接受 frontmatter 中的语言选择；默认 YAML 不等于拒绝其他引擎。保存路径在合法 allowed 目录，故该项不依赖 S02 越权。捕获解析异常也不能撤销已经发生的执行。已有 marker 只证明进程内执行；进程权限、秘密与外连决定可能的更大影响，本轮没有验证这些扩展影响。仅更新 js-yaml 不能关闭这个执行引擎。

**反证与限制：** 已复现进程内执行，未执行系统命令、读取秘密或测试生产；默认公开编辑关闭。

**建议修复：** 统一使用仅数据解析器或严格拒绝所有可执行 engine；不能只关闭前端预览。覆盖所有 parseNote 调用入口。

**验收：** PAR-01、PAR-02，见 [acceptance-matrix.md](acceptance-matrix.md)。

### S02 — P1：访客可越过可编辑子目录边界

**条件、调用链与影响：** assertGuestWritable 只比较原始路径前缀；vault 随后 resolve/realpath 仅约束更宽的内容根。dotdot、内部符号链接、rename/copy/delete 的隔离请求成功越过 guest 子目录。

**位置：** `server/src/services/guestpath.ts:40-52`。

关键反例：直接 private 写返回 403；跨内容根路径与外指符号链接返回 400。说明内容根保护在已测样例有效，但不是 guest 子目录保护。反斜杠与 JSON 字面 `%2e` 样例不能冒充 Linux 分隔符越界；query 解码与 JSON 原文必须分别分析。读 private 得到 200 是当前全内容根读取设计，应由产品确认阅读范围，不单独认定绕过写权限。

**反证与限制：** 内容根外的路径和符号链接样例被400拦截；未证明任意宿主路径访问。原始记录主要为HTTP状态，完整磁盘哈希断言待修复回归补充。

**建议修复：** 对最终规范化且解析符号链接的物理路径实施guest授权；rename/copy双端及递归项一致校验。

**验收：** PATH-01至PATH-11，见 [acceptance-matrix.md](acceptance-matrix.md)。

### S03 — P1：上传生成的最终落点未经访客授权

**条件、调用链与影响：** guestWriteGuard只收集非空请求路径。普通上传无dir时通过空检查，写内容根；upload-image关闭图床后生成attachments目标，未再次校验guest权限。两项历史响应200并返回越界最终路径。

**位置：** `server/src/routes/files.ts:159-167`。

原记录 `upload-empty-dir` 返回内容根文件；`image-derived-target` 返回 `attachments/image-derived-target.png`；`upload-dotdot` 返回 private 下路径。`routes/files.ts:119-135,143-172` 表明前两项不是单靠规范化输入可修复：生成的新路径也必须授权。图片本地回退只在 `UploadError && status===400` 时发生，其他外部失败会抛出，不能统称所有图床失败均回退。

**反证与限制：** filename有basename处理，内容根守卫仍在；并非任意绝对路径写。仅UploadError且status400走本地回退。

**建议修复：** 派生并规范化最终目录/文件后统一授权，显式定义附件允许根；接收大包前先校验角色和上传策略。

**验收：** UPL-01至UPL-05，见 [acceptance-matrix.md](acceptance-matrix.md)。

### S04 — P1：空提交选择扩大为内容根并携带已有暂存内容

**条件、调用链与影响：** guest sync筛选后可能得到[]，stagePaths将[]解释为add整个内容根且不清已有index，commitAll随后提交全部暂存。隔离直接服务调用提交了private和内容根外预暂存文件；非空dotdot同样提交private。

**位置：** `server/src/services/git.ts:445-461`。

`routes/git.ts:81-98` 中 guest 无 paths 时筛选 changes；结果为空仍传给 service。`services/git.ts:445-461,535-559` 将空数组当作全内容根暂存，并在空分支保留已有 index。原 `git-empty-paths-commit` 记录提交了 `content/private/git-empty.md` 和预暂存的 `outside-content.md`；dotdot服务调用提交private。`git-glob-commit` 只证实匹配了 allowed 下多个文件，没有证实该 glob 越出 allowed。HTTP sync 到真实远端未执行，因此不能把这些结果描述成已绕过真实 PR 审核。

**反证与限制：** 直接commitAll本地复现；guest HTTP sync→真实push/PR未执行。不能据此断言真实GitHub审核或分支保护已绕过。

**建议修复：** 区分未指定和明确空选择；按最终授权的literal路径构建受控index/commit tree；空授权集no-op，并验证实际提交树。

**验收：** GIT-01至GIT-09，见 [acceptance-matrix.md](acceptance-matrix.md)。

### S05 — P1：改密码接口允许访客进入且没有登录同等级限流

**条件、调用链与影响：** change-password只requireAuth；公开模式匿名成为guest，可调用checkPassword。原隔离记录12次错误仍401，已知默认夹具密码可返回200修改owner密码。

**位置：** `server/src/routes/auth.ts:68-84`。

`requireAuth` 允许 guest，而这里没有 `requireOwner`；`checkPassword` 仍要求有效旧密码。历史夹具环境使用自造恢复值，同时默认密码分支仍可通过，说明设置恢复密码不自动关掉默认密码。建议将默认初始化、owner授权、错误尝试限流和会话撤销作为相互配合但分别可测的控制。

**反证与限制：** 仍必须知道或猜中有效当前密码；不是无条件改任意强密码。login第11次错误返回429的对照不能保护另一接口。

**建议修复：** 改为owner专属并限制错误验证频率；覆盖默认/恢复密码、会话撤销策略及禁公开模式。

**验收：** AUTH-01至AUTH-05，见 [acceptance-matrix.md](acceptance-matrix.md)。

### S06 — P1：512 MiB 内存上传缺少总量与并发约束

**条件、调用链与影响：** 公开模式访客可进入multer.memoryStorage，单文件限制512MiB；上传体先接收再执行guestWriteGuard。多个请求并发可能耗尽目标1.6GiB共享主机容量。

**位置：** `server/src/routes/files.ts:19-22`。

单个512MiB文件加 Buffer、索引、Node和Git并不保证一定超过1.6GiB，但多个并发没有总额预算，且目标主机还有其他服务。V8 old-space上限不限制全部 Buffer/RSS，640MiB容器建议值也不是容量实测。限额、并发、超时、资源限制须在隔离目标环境验证，不能对共享生产主机打大包复现。

**反证与限制：** 源码确认内存策略和执行顺序；没有做大包压力测试，没有OOM实测。影响阈值依赖实际部署。

**建议修复：** 降低单文件上限，流式受限临时存储，限制总并发/字节/时长，并落实容器RSS与CPU限制。

**验收：** UPL-06、DEP-01、DEP-02，见 [acceptance-matrix.md](acceptance-matrix.md)。

### S07 — P2：分享口令解锁接口缺少专用限流

**条件、调用链与影响：** 持有分享id者可对publicSharesRouter /:id/unlock重复提交口令，每次执行verifyPassword；此路由没有专用限流。可增加弱口令猜测及scrypt负载风险。

**位置：** `server/src/routes/shares.ts:150-160`。

`server/src/index.ts:128` 挂载公共分享路由，`routes/shares.ts:150-176` 验证分享口令并颁发绑定 share id 的解锁Cookie。绑定id和有效期是现有保护；缺少限流不意味着已解出强口令。另解锁Cookie没有显式Secure，TLS传输属性属于需浏览器/代理验证的独立配置事项。

**反证与限制：** 仅源码确认，未执行猜测/压力测试。需有效分享ID且分享启用口令；强口令减少猜中概率。

**建议修复：** 增加按分享与来源组合的限流和资源预算，避免单全局锁造成互相拒绝服务；TLS下统一secure cookie。

**验收：** SHARE-01，见 [acceptance-matrix.md](acceptance-matrix.md)。

### S08 — P1：新实例仍接受公开已知的默认管理员密码

**条件、调用链与影响：** userPasswordHash为空时checkPassword仍接受DEFAULT_PASSWORD；环境恢复密码是额外接受值，不能替代默认凭据。UI mustChangePassword不能阻止服务端直接签发owner token。

**位置：** `server/src/services/auth.ts:68-80`。

`services/auth.ts:41-48,68-80` 与 `routes/auth.ts:91-104` 共同说明：默认凭据通过后可以取得owner会话，UI强制改密不构成后端拒绝。生产是否仍处于该状态未知；已设置用户密码的实例不应套用此结论。`loadSettings` 对损坏配置退回默认的行为会放大此风险，但触发与实际恢复结果需要单独验证。

**反证与限制：** 源码确认；guest默认改密码夹具间接验证默认检查。未对真实新部署执行登录；已设置强userPasswordHash时默认分支不适用。

**建议修复：** 以受控初始化替代共享默认密码，初始化前拒绝敏感API；恢复机制显式启用并可撤销。

**验收：** AUTH-02，见 [acceptance-matrix.md](acceptance-matrix.md)。

## 4. 可靠性风险和待验证事项

以下与上面的8项分开统计；不能把源码缺少某项控制直接写成已成功利用。

| ID / 优先级 | 源码与观察 | 状态、处理及限制 |
|---|---|---|
| R01 / P1 | guest push 固定 web-edit；owner/PR 采用配置 editBranch；PR owner/repo默认QUT；`routes/git.ts:81`、`git.ts:562-604,836-888` | 配置分裂源码确认，真实错误分支写入未测。需统一 remote/owner/repo/edit/base 并在写入前校验；PR失败不能等同完整投稿成功。branch protection是否有效待目标仓库验证。 |
| R02 / P1 | `settings.ts:196-224` 读取、JSON或schema失败统一defaults+persist | 源码确认，损坏配置恢复未实测；应失败关闭、保留原件，不能将坏配置当新安装；与S08联合进入上线门禁。 |
| R03 / P2 | JWT HttpOnly/Lax/secure-auto；TRUST_PROXY默认true；`config.ts:46-54`、`routes/auth.ts:22-33` | 浏览器、TLS、代理头与CSRF动态验证待执行。没有CSRF token不等于已证明跨站写入；不应将trust proxy=true说成只信一跳。 |
| R04 / P2 | WS upgrade校验owner token；`index.ts:181-200` | guest不能直接使用owner WS；Origin、撤销、异常Cookie、事件泄露范围待验证。 |
| R05 / P2 | API key独立scope/hash/rate；`routes/agent.ts`、`middleware/apikey.ts` | 源码有边界；读/写/search负向动态用例未完成；write key写入内容也必须走修复后的解析器。 |
| R06 / P2 | settings/.bak保存秘密，`settings.ts:182-224`；Git写认证origin，`git.ts:107-122,566-570`；图床key用于query，`upload.ts:30-68` | 不等于已发生泄漏；需统一秘密分离、构建上下文排除、日志/错误输出脱敏，并用假sentinel验证。已有0600写入与API遮盖只是局部保护。 |
| R07 / P2 | Git单进程队列与按年龄清理锁；`services/git.ts` | 跨进程竞争、超15秒活跃锁和并发保存/同步待验证；锁年龄不能单独证明进程已死。 |
| R08 / P2 | Markdown预览/SSR净化、iframe隔离；`web/src/lib/markdown.ts`、`services/renderhtml.ts`、`web/src/components/Preview.tsx` | 浏览器XSS组合用例未执行；不能从净化调用推断所有插件/图表均安全，也不能将依赖公告当实际XSS。 |
| R09 / P2 | Docker浮动基础镜像、npm install、root运行；CI分支不覆盖nkustudy-dev且安装fallback | 工程事实已确认；修复方案见部署文档。Mac build通过不等于可复现镜像或AMD64启动通过。 |
| R10 / P3 | QUT品牌、User-Agent、安全报告联系人、CSS前缀 | 适配待确认；通常可后置，不应与remote/权限边界一并机械替换。 |

读取范围、共享草稿、投稿归属、PR与发布责任属于产品安全契约，见 [配置清单](qut-to-nkustudy-config.md)。同一工作区的未提交内容可能被其他访客看到或覆盖，当前没有确认的会话隔离产品承诺。

## 5. 依赖公告与兼容修复候选

原窗口在2026-10-22执行 `npm audit --omit=dev --workspace server/web --json` 并用GitHub Advisory API保存39条去重公告，原件见 [advisory-details.json](evidence/advisory-details.json)。server快照为12个受影响依赖包（critical 3/high 4/moderate 5），web为4个；**包数和39条公告都不是本项目已复现漏洞数量**。以下版本是该时间快照的修复候选，不承诺以后仍无新公告；本轮没有改锁文件或验证升级兼容性。

| 依赖（锁定） | 公告与修复候选 | 本项目可达性与限制 |
|---|---|---|
| multer 2.1.1 | 5条公告，至少2.3.0覆盖快照；[其中一项](https://github.com/advisories/GHSA-535w-7cp7-47q4)；现有^2.1.1允许同主版本次版本更新 | multipart guest入口可达；无async fileFilter，不应套用所有race前提；升级不替代S03/S06修复。 |
| js-yaml 3.14.2，经gray-matter | 4条公告，至少3.15.2；[其中一项](https://github.com/advisories/GHSA-2883-xcg3-v3hh)；^3.13.1允许 | 用户Markdown进入解析器，DoS未执行；**升级不能修复S01 JavaScript engine**。 |
| simple-git 3.36.0 / argv-parser 1.1.1 | simple-git建议4.0.2 / argv-parser2.0.1；[编辑器环境公告](https://github.com/advisories/GHSA-v5rq-49vh-5v5c) | 跨主版本必须评估，未证实guest能控制VISUAL或任意Git配置参数；不将critical公告当项目RCE复现。 |
| mermaid 11.15.0 | 5条公告，至少11.16.1；[其中一项](https://github.com/advisories/GHSA-c4c3-pg64-4m4v)；^11.15.0允许 | 图表输入可达，配置来自固定代码；diagram输入可控不等于配置API原型污染前提满足。 |
| dompurify 3.4.9，经Mermaid | 4条公告，至少3.4.16；[其中一项](https://github.com/advisories/GHSA-6688-9rhm-gjv2)；同主版本补丁 | 各公告需hook/IN_PLACE/自定义元素等条件；需核对Mermaid内部使用和实际浏览器，未证实全站XSS。 |
| katex 0.17.0；Mermaid内0.16.47 | [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)，最早修复0.18.2，audit建议0.19.0 | 均超现有0.x caret范围，需专门升级；还要求已有原型污染/可控选项原型等前提，未验证联合链。 |
| qs 6.15.2 / express 4.22.2 / body-parser 1.20.5 | qs6.16.0；body-parser1.20.6；[limit公告](https://github.com/advisories/GHSA-v422-hmwv-36x6) | qs父范围~6.15.1，单刷锁可能不足；需父包兼容更新或验证override。代码limit为合法32mb，不满足该无效limit公告条件；qs特定comma/parse-stringify链未证实。 |
| proxy-addr 2.0.7 | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)，2.0.8 | 特定IPv4-mapped IPv6子网信任场景；当前trust proxy=true是另一配置问题；登录限流用socket地址，未证明公告能绕过它。 |
| @xmldom/xmldom 0.8.13，经Pixi | 10条公告，至少0.8.15；[其中一项](https://github.com/advisories/GHSA-8344-3jmq-59r6) | 同范围补丁候选；是否实际进入生产XML parser/serializer需验证；不混计desktop/plist的0.9.10。 |
| braces 3.0.3 / sprintf-js 1.0.3 | [braces公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[sprintf公告](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)，快照没有已知修复版本 | audit建议chokidar6是跨主版本更换依赖链，不是braces补丁；guest控制深层glob或格式串的链路未证实。 |

完整受影响范围、多个GHSA和first_patched_version以保存的公告JSON为准。优先修复解析/权限/资源控制并定向更新可兼容依赖；simple-git、KaTeX及更换chokidar单列兼容任务。更新后重新冻结锁文件、安装、typecheck/build及针对性回归，不运行 `npm audit fix --force`。

## 6. 已有保护与未成立结论

封闭模式匿名/guest401、owner200；直接private写403；内容根外路径和外指symlink400；guest访问trash管理403；login第11次失败429均有原始控制记录。Git show hash拼接尝试返回500，未证明内容根外读取成功。这些反例必须保留，不能将报告扩大成“所有鉴权/沙箱均失效”。

公开读取是否限于editableRoot尚未确定。Git本地commit成功不等于远端push成功，不等于PR已创建，更不等于已合并或上线。没有生产依赖利用、真实凭据泄漏、真实服务被攻击、资源OOM或AMD64运行的证据。

## 7. 下一阶段顺序

1. 先修S01统一解析边界，所有入口回归；只在无秘密隔离副本执行。
2. 修S02/S03最终路径授权、S05/S08初始化与owner边界、S06上传资源限制；落实R02配置失败关闭。
3. 修S04受控提交集合；依据确认的目标矩阵统一R01分支、PR和发布语义。
4. 更新依赖与CI，完成本地负向回归；随后才是AMD64镜像、容量、持久化与恢复。
5. 真实集成须另有明确授权并使用测试目标；技术门禁通过后再给用户集中UI验收。

第3步交付是审计与准备完成；第4步实施尚未开始。参阅 [执行总结与下一步任务书](execution-summary.md)。
