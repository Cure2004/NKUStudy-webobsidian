# NKUStudy WebObsidian 验收与回归矩阵

日期：2026-10-22（Asia/Shanghai）。审计基线：`e2201591c02ecb96e4d42d6adbd0644f1a15b40a`。本地分支：`nkustudy-dev`；本轮候选仅新增审计文档，没有实现安全修复或产品需求。

**“已复现”表示基线问题被复现，不表示修复通过。** 本地隔离测试、静态阅读、Mac构建、AMD64容器、部署及业务验收各自单列。本轮没有生产、真实Wiki、真实App、远端push或PR回执。

## 1. 版本、执行责任与证据

总控负责冻结候选、复现证据核收、后续修复结果整合和集中验收；开发者在隔离夹具执行自动化与协议测试，用户仅在候选通过技术门禁后集中体验UI或处理不可替代的账号/部署授权。不得让用户在多个聊天间搬运结果。

| 标记 | 含义 | 证据与限制 |
|---|---|---|
| 已复现-L | 主控在本地隔离夹具观察到基线缺陷 | `evidence/probe-results.json`、`evidence/probe.mts`；不等于真实服务器已受攻击 |
| 已复现-P | 主控以无害进程内marker验证Markdown解析执行 | `evidence/marker-results.json`、`evidence/marker.mts`；没有执行系统命令或读取秘密 |
| 已通过-L | 本次指定控制样例/构建步骤通过 | 同上结果及 `evidence/typecheck.log`、`evidence/build.log`；限Mac Node22.23.4和本次夹具；typecheck仅日志无错误、未独立记录退出码，不单独标PASS |
| 静态确认 | 源码已确认行为/缺少守卫，尚无对应动态验证 | 见 `security-audit.md`、`architecture-audit.md` 的位置与调用链 |
| 待验证 | 尚未执行，不能填PASS | 包括修复后回归、浏览器、API Key/分享/WS、资源、AMD64、Git远端/PR、回滚 |

依赖扫描证据为 `evidence/server-audit.json`、`evidence/web-audit.json`，属于所记录时间的公告快照。审计修复建议不能代替更新后锁文件、兼容构建与运行验收。

每次执行记录：候选commit、工作区dirty范围、lock SHA256、测试脚本/夹具哈希、OS/Node/npm、开始结束时间、用例ID、请求方法与脱敏参数、状态码、文件/commit差异、退出码。镜像另记base digest、image ID/manifest digest、tar SHA256与架构。Cookie/Key/私钥/密码只保留“配置/校验成功或失败”的结果，不进入日志和反馈。

## 2. 隔离前提与执行顺序

1. 从冻结程序提交归档到新临时目录；安装/构建与服务启动都在副本进行，不往审计工作区写生成物。主控本次已完成 `npm ci --ignore-scripts`、typecheck、build，后续只对相关变更增量复验。
2. 建立独立 `fixture/vault/content/allowed`、`fixture/vault/content/private`、`fixture/vault/outside-content` 与 `fixture/data`；均为自造哨兵数据。`vault.path` 指向fixture/vault，`vault.root=content`，`publicEditor.editableRoot=content/allowed`。程序仓库与这个内容仓库完全分开。
3. `publicEditor.enabled=true`只用于公开编辑用例；封闭模式另外新进程执行。`git.enabled=false`、`git.autoSync=false`、`git.autoCommitOnSave=false`、`github.autoFollowBase=false`、`github.appEnabled=false`、`upload.enabled=false`，remote为空；不导入旧Data或凭据。
4. 服务只监听 `127.0.0.1` 的临时空闲端口，BASE记录为实际URL，禁止用8787、18787、8080或生产域名。普通用例无外连；Git用例只使用额外本地bare仓库和mock HTTP，无真实GitHub。
5. 为每个可写用例复制一份干净fixture；读取前后文件哈希、位置、git index/tree，并检查outside-content和同级private哨兵是否变化。任何HTTP拒绝都必须同时满足“无副作用”；HTTP200也必须核实实际目标。
6. 先复用本次复现证据建立红灯，再测试修复候选。顺序：解析安全 → 路径/上传 → 认证 → Git提交/分支 → API/分享/浏览器 → 构建/资源 → 持久化/回滚 → 用户UI。任何P0/P1失败先保留现场，不进入联网或部署环节。

测试账号仅“owner夹具”和“guest/匿名夹具”；owner认证材料只在受限临时Cookie文件或进程内保存。不要在终端打印真实环境变量、settings全文或完整inspect结果。公开guest无Cookie即可测试；显式guest token只由隔离夹具签发，不伪造真实账号。

请求通用口径：JSON写请求使用 `Content-Type: application/json`；query输入保留原编码并记录最终服务端值；测试URL路径时关闭客户端自动规范化（例如curl `--path-as-is`）。JSON中的 `%2e` 不会自动获得query那样的解码，必须分渠道记录，不能用一个结果代替另一个。

## 3. 解析、路径和上传

下表修复后目标是建议安全契约；涉及“允许读哪些内容”“附件可写位置”等产品策略的项目须先确定策略，再形成最终PASS判据。

| ID / 优先级 | 可执行操作与输入 | 基线结果/状态 | 修复后预期与副作用断言 |
|---|---|---|---|
| PAR-01 / P0 | 用`marker.mts`的无害Markdown fixture，经guest `PUT /api/files/content`保存到allowed内；观察同进程marker并等待索引任务完成 | 已复现-P：`---javascript` frontmatter进入gray-matter执行；HTTP200且marker变化 | 非声明式frontmatter被拒绝或纯文本处理；marker始终不变；禁止以禁用UI预览冒充后端修复 |
| PAR-02 / P0 | 同fixture分别触发冷启动索引、增量索引、API读取、链接图、SSR分享等调用`parseNote`的入口；每个入口用新进程 | 待验证；调用链静态已读 | 所有解析入口统一只支持受限数据解析，不执行代码；普通YAML/title/tags不回归 |
| PATH-01 / P1 | guest写`allowed/ok.md`，读回；另直接写`private/sentinel.md` | 已通过-L：前者200，后者403 | 允许路径200且内容匹配；禁止路径403且原哈希不变 |
| PATH-02 / P1 | guest写`allowed/../private/sentinel.md` | 已复现-L：200，修改private | 归一化最终目标之后拒绝；private、索引和Git状态均无变化 |
| PATH-03 / P1 | guest写穿出content的路径，例如从allowed开始跨到`outside-content`；owner也执行越content输入 | 已通过-L：主控`../../outside`样例返回400 | 内容根外目标始终拒绝，不能以owner身份绕过容器内文件边界 |
| PATH-04 / P1 | 将`allowed/link-private`指向`../private`，写`allowed/link-private/sentinel.md` | 已复现-L：内部symlink到private可写200 | 按realpath后的guest允许根判断或拒绝symlink；private不变 |
| PATH-05 / P1 | 将allowed内link指向content外；对已有文件和尚不存在子路径各读写一次 | 已通过-L：主控外指symlink样例400；新增子路径待验证 | 已有与未来目标均不能穿越content；不存在目标使用安全祖先验证，不能fail-open |
| PATH-06 / P1 | `PATCH /api/files/rename`，分别用允许from+越界to、越界from+允许to；越界输入采用`allowed/../private/...` | 已复现-L：rename绕过200；组合覆盖待增量验证 | 两端最终路径均校验，失败不移动文件、不修改分享指向或索引 |
| PATH-07 / P1 | `POST /api/files/copy`，同PATH-06双向组合，增加含内部/外部symlink的目录复制 | 已复现-L：copy绕过200；目录/递归symlink待验证 | 拒绝非法源/目标及递归越界；不得先复制部分文件再返回失败 |
| PATH-08 / P1 | `DELETE /api/files/?path=allowed%2F..%2Fprivate%2Fsentinel.md`；在trash与permanent两个新fixture分别执行 | 已复现-L：编码query删除绕过200；删除模式组合待验证 | query解码后仍按最终路径拒绝；原文件与回收站均不变化 |
| PATH-09 / P1 | 对create/read/write/rename/copy/delete输入`..`、重复斜线、前导斜线、反斜杠、大小写、Unicode文件名；分别用JSON/query编码与双重编码 | 待验证（部分dot/query见上） | 所有接口遵循同一规范；Linux反斜杠是普通字符不能误判为Windows目录，支持与否明确；无跨根副作用 |
| PATH-10 / P1 | guest/owner/API Key尝试`.git/config`、`.git/hooks/...`、`allowed/link-git/...`；仅本地空Git夹具，hooks不执行 | 直接.git守卫静态确认；完整链待验证 | VCS元数据直接路径及符号链接别名都不能读写；不能只拦字符串`.git` |
| PATH-11 / P2 | `vault.root`空/非空、editableRoot相同/后代/不相交/空值；对root目录本身rename/delete；故障权限或祖先realpath报错 | 待验证 | 配置无效明确拒绝；不相交不扩大权限；根目录不可破坏；验证错误不当作不存在跳过 |
| READ-01 / 产品决策 | guest GET private内容、文件树、搜索、tags、backlinks、graph、同名basename解析、Git log/show | 已复现-L：private读取200；其他读入口待验证 | 先选择公开整个content或仅读允许目录。前者须保证整个content可公开；后者所有读/索引/历史/WS都要过滤。当前结果不单独误报“绕过写限制” |
| UPL-01 / P1 | guest `POST /api/files/upload` multipart field `file`，省略dir或令dir为空 | 已复现-L：200，写到content根 | 最终`rel`进入统一guest校验；缺dir不能自动扩大范围；不得写到根 |
| UPL-02 / P1 | 普通上传设置dir为allowed、private、`allowed/../private`、大小写别名及symlink目录 | dotdot样例已复现-L：`upload-dotdot`返回200、目标为private；其余组合待验证 | 允许上传成功；其他按最终写入目录拒绝；禁止目录收到请求后不应先完整接收大文件 |
| UPL-03 / P1 | 图床关闭；guest `POST /api/files/upload-image`上传小型假PNG，省略dir，attachmentDir为默认attachments | 已复现-L：200，fallback写到editableRoot外attachments | 最终fallback路径经相同guest守卫；策略允许附件时须定义明确专用根，不能默认全content可写 |
| UPL-04 / P1 | attachmentDir为空、allowed下、private、symlink、大小写目录；mock图床返回400/403/429/500/超时 | 待验证 | 每种fallback/error有明确策略；任何实际本地写入仍须授权；外部失败不静默落到未经批准目录 |
| UPL-05 / P2 | filename含`../`、反斜杠、前导点、同名文件、超长名；MIME伪装的非图片和SVG脚本fixture | `safeUploadName`静态确认；动态待验证 | 路径不由filename控制；碰撞不静默覆盖；MIME与实际内容策略明确，预览不执行脚本 |
| UPL-06 / P1 | 在专用受限测试机按新限额N发送N-1/N/N+1字节，2/4并发，连接中断、慢上传、multipart多字段 | 静态确认512MiB memoryStorage；本轮没有大包压力测试 | 超限413或约定4xx且内存受限、临时文件清理、并发受控；不得影响其他服务；禁止生产上复现512MiB负载 |

参考根因：`services/markdown.ts`与gray-matter调用；`services/guestpath.ts`；`services/vault.ts`；`routes/files.ts:21,33-47,119-173,175-209,265-285`。对应安全报告S01、S02、S03、S06。

## 4. 认证、API Key、浏览器与分享

| ID / 优先级 | 可执行操作与输入 | 基线结果/状态 | 修复后预期与证据 |
|---|---|---|---|
| AUTH-01 / P1 | publicEditor=false；匿名、显式guest、owner分别GET `/auth/me`和文件API；再true重试 | 已通过-L：封闭匿名/guest401，owner200；其余组合待验证 | 开关策略一致；无效/过期token不会提升owner；开启公开只获得guest能力 |
| AUTH-02 / P1 | 新Data无自定义密码时测试默认登录、`/auth/setup`、环境override以及重启后的状态 | 默认认证逻辑静态确认；具体完整组合待验证 | 后端强制安全初始化；不存在已知默认owner通行；override不能保留默认登录；不只依赖UI提示 |
| AUTH-03 / P1 | guest POST `/auth/change-password`，先12次错误currentPassword，再在另一个fresh fixture用已知默认测试密码与新夹具密码 | 已复现-L：12次401无429；正确默认密码可guest更改owner密码 | guest先被拒绝，无密码校验oracle/改owner能力；owner错误尝试有合理限流；日志不含输入 |
| AUTH-04 / P2 | 同IP连续11次错误POST `/auth/login`；改变X-Forwarded-For再次测试；另模拟同代理两客户端 | 已通过-L：第11次429；XFF及代理公平性待验证 | 正确Retry-After；伪造XFF不绕过；可信代理拓扑下不会不必要地把所有用户锁在单一bucket |
| AUTH-05 / P1 | owner改密码、退出、JWT secret轮换、guest开关关闭后重放旧cookie/token（只用夹具） | 待验证 | 明确会话撤销契约并据此PASS；过期/错误算法/篡改令牌拒绝，敏感操作不依赖前端状态 |
| AUTH-06 / P2 | 在新副本中将settings改为无效JSON/无效schema，或模拟不可读，再启动并检查文件及认证模式 | 静态确认广泛catch默认重置；动态待验证 | 启动明确失败，保留原文件/备份，不静默重置默认认证；健康不可误报就绪 |
| KEY-01 / P1 | owner POST `/api/keys`生成read、write、search三个临时key；guest尝试list/create/revoke；撤销后重放 | owner路由守卫静态确认；动态待验证 | 只有owner管理；明文仅创建响应一次且不落日志；撤销即时401；存储hash不是raw key |
| KEY-02 / P1 | 每种scope分别调用 `/api/v1/notes`、`/notes/*` GET/PUT/PATCH/DELETE、`/search`、`/backlinks`、`/tags`；无key/坏key对照 | scope守卫静态确认；动态待验证 | 无key401、缺scope403、正确scope按约定成功；owner session cookie不能冒充API key |
| KEY-03 / P1 | 对`/api/v1/notes/*`测试单/双编码dot、斜线、symlink、.git；观察Express参数解码与额外decodeURIComponent | 双重解码调用静态确认；动态待验证 | 最终规范路径限制一致，不跨content或VCS元数据；API Key目录授权与guest策略分开明确 |
| KEY-04 / P2 | fixture将rateLimitPerMin设低值，按单key、两个key、窗口过期、revoke/recreate运行；含非法scope输入 | 静态每key滑窗限流；动态待验证 | 超限429、scope白名单校验、不同key策略符合设定；进程重启限流重置的局限被记录 |
| WEB-01 / P2 | 实际浏览器HTTP本地与隔离TLS代理分别登录，检查Cookie属性；TRUST_PROXY=false、限定hop及伪造XFP | 静态HttpOnly/Lax/secure-auto；动态待验证 | TLS会话Secure，HTTP测试行为明确；不把Express `true`误称只信一跳；未知代理头不提升信任 |
| WEB-02 / P1 | 两个不同origin的本地页面发POST/PUT/DELETE，含simple form、JSON fetch、携带/不携带凭据；分别owner和public guest | 待验证；不能仅凭无CSRF token断言可利用 | owner跨站写失败且无副作用；公开guest滥用另按限流/权限控制；SameSite、CORS和实际请求方法共同验证 |
| WS-01 / P2 | `/ws`分别无token、owner、guest、失效token、异常Cookie编码、外站Origin连接；创建private文件观察事件 | 静态upgrade验证token并广播；动态待验证 | WS身份/公开策略一致，Origin受控，private路径是否广播遵循读策略；关闭公开/撤销后连接处理明确 |
| SHARE-01 / P2 | owner为夹具建立公开/密码分享；匿名请求 `/public/shares/:id`、`/:id/unlock`、`/:id/file`及`/share/:id`，wrong/expired/revoked对照 | 静态分享解锁无专用限流；动态待验证（S07） | 受密码保护内容/附件/SSR统一鉴权；错密码限流；不同share token不可互用；TLS unlock cookie安全 |
| SHARE-02 / P1 | 分享只嵌入allowed图片，尝试private附件、Markdown、basename碰撞、query traversal、symlink；rename源笔记再访问 | 附件allowlist静态确认；动态待验证 | 仅实际允许附件返回；未授权404/403，无结构泄露；rename/share更新保持一致 |
| WEB-03 / P1 | Markdown原始HTML、脚本/事件handler、危险URL、SVG、mermaid、canvas与iframe fixture分别进入编辑预览和SSR | sanitize/CSP调用静态确认；动态待验证 | 无脚本执行/跨origin敏感请求；正常图片、公式、链接仍能用；前端与SSR分别验收 |
| LOG-01 / P2 | 用明显假sentinel token/privateKey/key构造Git/上传/API异常；扫描API响应、stdout/stderr、Data/bak与构建上下文 | 部分redact静态确认；动态待验证 | 响应/日志不含sentinel秘密；失败原因仍可诊断；Data/bak的秘密存储按既定分离方案校验 |

## 5. Git、分支与PR（全部隔离）

先建独立临时内容仓库和本地bare远端；remote只准绝对临时路径或显式mock URL。`git log --name-status`、`git diff --cached --name-status`及bare refs是验证依据，不采用“接口返回ok”替代内容和目标branch核对。fixture需要allowed/private各一个modified文件、content外一个预暂存文件、无allowed改动场景，并准备无提交/干净/冲突/rename/delete状态。

| ID / 优先级 | 可执行操作 | 基线结果/状态 | 修复后预期 |
|---|---|---|---|
| GIT-01 / P1 | 调用当前`git.commitAll(message, [])`；private有改动且repo根已有预暂存文件；只检查本地commit | 已复现-L：private和既有staged文件被提交 | 空选择是no-op或明确拒绝；不能变成全仓提交；原index不被串带 |
| GIT-02 / P1 | `paths=['allowed/../private/sentinel.md']`；另测试allowed正常路径和预暂存private组合 | 已复现-L：绕过path提交private；合法组合待验证 | 最终路径授权；提交tree仅批准路径，已有index内容不意外进入commit |
| GIT-03 / P1 | guest `/api/git/sync`分别省略paths、`[]`、全空字符串、非法类型、仅private改动、allowed+private混合；mock push/PR | 路由→commit根因静态确认；**HTTP→远端完整链未执行** | 无allowed改动时不commit/push；路径选择不因normalize变成全量；清晰返回空操作 |
| GIT-04 / P1 | 本地当前分支设为base，配置editBranch为自定义名；guest/owner sync分别捕获checkout/commit/push refspec | guest硬编码web-edit静态确认；动态待验证 | 明确且唯一的editBranch契约；commit发生在受控编辑分支，base不被直接写；UI配置、Git和PR一致 |
| GIT-05 / P1 | 故意设置`git.branch`、`github.baseBranch`、`github.editBranch`互不相同；mock GitHub repo与remote不一致 | 静态关系见架构/配置文档；动态待验证 | 不一致配置在写入前失败；不会向QUT默认仓库、错误branch或错误PR目标写入 |
| GIT-06 / P1 | mock GitHub令牌成功、失败、超时、过期、无App、autoPullRequest=false；记录commit/push/PR调用序列 | 待验证 | guest贡献必须满足审核契约；PR失败不报告完整投稿成功；失败后有可查操作结果，不能自动重复推送 |
| GIT-07 / P1 | mock existing PR、重复sync、base ahead、edit ahead、merge冲突；调用follow-base和自动定时路径 | 暂停有PR跟随等源码静态已读；动态待验证 | 未合并贡献不被覆盖；冲突保留状态并停止；无force/reset绕过；回执含真实refs/commit |
| GIT-08 / P2 | 并发save/手动sync/autoSync/followBase；外部本地Git持有超过15秒锁；模拟异常中断 | 单进程队列及按年龄清锁静态确认；动态待验证 | 活跃锁不被删除；跨进程协调策略明确；不得靠锁年龄推断进程已死；未知结果只查询不重放 |
| GIT-09 / P2 | allowed中LFS小夹具、rename/delete、二进制、无LFS工具/远端不可达；无实际外网 | 待验证 | index/commit/pointer与对象一致；失败可诊断，内容不会只剩不可取的pointer |

上述本地commit复现不证明实际GitHub branch protection、App权限或PR审核绕过。真实测试仓库/App仅可在后续明确授权后创建/绑定，仍不得使用正式Wiki。

## 6. 构建、部署与可靠性

| ID / 优先级 | 可执行操作与条件 | 本轮状态 | 后续验收预期 |
|---|---|---|---|
| BUILD-01 / P2 | 冻结归档副本运行严格`npm ci --ignore-scripts`、typecheck、build，核对锁文件未变 | Mac Node22.23.4：安装exit0、build最终exit0；typecheck日志无错误但无独立退出码，见证据说明 | 修复候选相关检查通过；缺锁/失配立即失败；安装脚本禁用的覆盖局限单列 |
| BUILD-02 / P2 | 审核依赖生命周期脚本后在隔离构建器执行实际镜像安装路径，扫描server-only和web production依赖；修改最小兼容版本后重跑 | 公告快照已有；兼容修复待验证 | 受影响路径关闭，锁文件与依赖图一致；无`audit fix --force`；不把dev-only问题当运行时同等风险 |
| BUILD-03 / P2 | Mac buildx linux/amd64，build阶段原生ARM64；记录每阶段arch和esbuild执行；运行镜像架构检查 | 待验证 | 无QEMU esbuild崩溃；只复制静态构建产物；目标依赖匹配AMD64/musl；不复制ARM node_modules |
| BUILD-04 / P2 | AMD64原生隔离主机启动镜像，health+认证+读写+上传小文件+Git本地夹具 | 待验证 | 架构、Node、native/optional依赖真正可运行；镜像inspect和Mac仿真启动不替代此项 |
| BUILD-05 / P2 | 检查CI触发：nkustudy-dev push和以其为目标PR，lock故意失配、权限回归失败 | 静态现CI不匹配且有npm fallback；动态待验证 | 必需检查实际触发并阻止失败候选；不触发Electron或原作者仓库发布 |
| DEP-01 / P1 | 执行预审Compose配置，检查实际HostConfig、端口、mount、UID、capabilities、readonly、memory/CPU/pids/log限制 | 待验证 | 仅127.0.0.1:28787（或已审定空闲替代），不占保留端口；无root或共享挂载；限额真实生效 |
| DEP-02 / P1 | 先测既有服务峰值，再按deployment-plan中冷/热启动、2/4并发、文档规模、限额上传测资源 | 待验证 | 不OOM，不突破既有服务与系统余量；有实际容量结论；不能用640MiB配置值当作内存适用证明 |
| DEP-03 / P2 | 无secret文件、权限错误、配置损坏、vault不可写、索引故障、watcher降级分别启动 | 待验证 | 明确失败/降级，保留原文件；探针区分liveness/readiness；不因uncaughtException继续运行而误判健康 |
| DATA-01 / P1 | owner创建/改/删小哨兵，设置UI状态/分享，再停止并重启；核对Vault、settings/bak、shares、uistate和索引 | 待验证 | 数据及权限保持；索引正确；环境默认不误覆盖现有配置；没有自动连接旧remote |
| DATA-02 / P1 | 完成一致停机备份，解包到新generation；切换新候选制造可控启动失败，再回旧image+旧generation | 待验证 | 备份可恢复且哈希/权限正确；旧候选恢复所有哨兵；失败现场保留；不执行down -v/prune |
| DATA-03 / P1 | 新候选产生夹具写入后模拟回滚；另模拟远端结果未知 | 待验证 | 先记录差异与明确保留决定，不覆盖新数据；未知push/PR只读查询不重放 |
| COEX-01 / P1 | 后续授权部署前后比较NKU后台、Twikoo、OpenList、官方测试容器的状态/健康/端口/资源 | 本轮未连接服务器 | 既有配置、镜像、挂载与服务行为不变；异常只停本实例；不能仅凭新容器healthy宣称无影响 |

## 7. UI集中体验（技术门禁通过后）

这部分目前全部待验证，只使用脱敏夹具。先owner浏览器完成设置与合法编辑，再另开guest无痕窗口；保持同一候选版本，避免来回切换账号。产品未确认的功能不加入“必须实现”清单。

| ID | 操作顺序 | 预期 |
|---|---|---|
| UI-01 | owner打开文件树→allowed笔记→源码/实时/阅读视图→修改标题/正文→保存→刷新 | 内容一致、保存状态准确；中文/公式/图片/内部链接不丢失 |
| UI-02 | 新建/重命名/复制/删除夹具笔记→按当前支持恢复→搜索/图谱/反链 | 文件及派生索引一致，没有旧路径幽灵条目；可恢复性与deleteMode一致 |
| UI-03 | guest进入allowed编辑→上传允许的图片→尝试private操作→读取按已确认策略验收 | 被拒绝时可理解且不丢合法草稿；允许图片保存与显示正常；无越界成功提示 |
| UI-04 | 两窗口编辑同一夹具，断网/重连/刷新、保存失败、HTTP超时 | 不静默覆盖或误报保存成功；冲突策略待产品确认，未确定前记录限制而不虚构能力 |
| UI-05 | 只在Git mock/后续授权测试仓库查看变更→选择文件→提交→观察PR回执 | 选择和实际commit相符，提交失败/PR失败分开显示，目标仓库与branch清晰 |

## 8. 门禁与一次性反馈格式

**进入第4步实施前**：验收本轮五份文档与复现证据；明确公开读取范围、附件允许根、内容仓库/edit/base分支与PR审批契约。P0解析执行必须作为第一项修复；P1路径、上传最终路径、Git空选择/预暂存、guest改密码与资源控制随后完成。允许开始实施这些修复不等于允许联网或部署。

**进入联网测试前**：PAR/PATH/UPL/AUTH/GIT的本地P0/P1回归通过；真实测试仓库/App需另行明确授权。未授权时继续本地bare/mock，不“顺手”接正式Wiki。

**进入共享服务器测试前**：BUILD-03/04、DEP-01/02、DATA-01/02通过，并具备旧候选/回滚包与共存容量证据。任何P0/P1未解决、结果未知或证据缺失均不放行。P2/P3可逐项记录负责人、接受理由和后续期限；不能把“未执行”标为“通过”。

单一集中反馈模板：

```text
候选：commit / image digest（无镜像写“仅本地源码”）
环境：本地夹具 / AMD64隔离 / 后续授权测试环境
前提：夹具版本、公开读取策略、附件根、Git mock或测试仓库标识
结果：ID | PASS/FAIL/BLOCKED/NOT-RUN | 观察 | 预期 | 脱敏证据路径
例外：未执行原因 / 是否影响门禁 / 待谁处理
结论：接受文档 / 允许下一实施阶段 / 拒绝候选（部署验收另列）
```

失败处理：立即停止该用例的后续写入，保存候选、请求/响应、夹具前后哈希和脱敏日志；不重复未知Git写操作，不删除锁/receipt，不覆盖已有内容。总控集中定位；用户验收期间后续修复放到独立候选，版本变化时只列受影响项目增量复验。
