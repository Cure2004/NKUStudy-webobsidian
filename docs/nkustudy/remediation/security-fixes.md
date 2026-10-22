# 4A 安全修复与源码证据

日期：2026-10-22。范围：冻结基线 e2201591c02ecb96e4d42d6adbd0644f1a15b40a 上的本地修复。最终候选与命令回执见 remediation-summary.md、regression-results.md；历史 evidence 未改写。

| ID | 原边界与修复 | 当前源码入口 | 验证 |
|---|---|---|---|
| S01 / P0 | 移除 gray-matter 动态引擎，仅 js-yaml JSON_SCHEMA；未知语言/异常回退原文；64KiB元数据、深度32、循环/展开预算限制 | services/markdown.ts:parseNote/dataFrontmatter；统一 search、links、agent 调用 | PAR-01/02，正常中文/YAML/title/tags/BOM/CRLF；无害marker不变，保存/冷索引/增量/搜索匹配/API/SSR |
| S02 / P1 | 最终物理路径统一授权，拒绝内容symlink、绝对/反斜杠/.git、根破坏、递归隐藏别名；非ENOENT失败关闭 | services/vault.ts:normalizeRelativePath/resolveInVault/assertTreeSafe；guestpath.ts；middleware/stableMutation.ts | PATH-01–11，拒绝前后文件树/索引/Git不变；合法编辑/移动/复制/删除；配置并发切换不能改变操作目标 |
| S03 / P1 | 上传派生的实际落点重新授权，case目录解析后仍检查；未确认guest附件范围失败关闭；碰撞不覆盖 | routes/files.ts upload/upload-image；vault.importUpload | UPL-01–05，空dir/dotdot/symlink/fallback/碰撞/伪MIME；owner mock图床正常成功 |
| S04 / P1 | 区分省略/空/非法paths；隔离index+literal pathspec；核对commit tree；保留无关staged；guest/显式选择禁止夹带未push历史 | services/git.ts:selectedPaths/commitAllImpl/syncImpl；routes/git.ts | GIT-01–04及祖先串带、owner Commit→Sync/clean pull回归 |
| S05 / P1 | 改密owner专属，guest不进入密码校验；错误尝试限流；校验与换密按同代配置处理 | routes/auth.ts；services/auth.ts:authenticatePassword/changePassword；middleware/ratelimit.ts | AUTH-01/03/04/05，错密、XFF、并发换密、旧token、guest副作用 |
| S06 / P1 | multer磁盘临时文件、大小/字段/总请求预算、并发及接收期限；清理/断连取消；原子发布 | services/uploadPolicy.ts；services/upload.ts；vault.importUpload | UPL-06：小夹具N−1/N/N+1、并发429、超时408、中断和上游取消；无512MiB压力测试 |
| S07 / P2 | 分享解锁来源及分享双层限流，TLS Secure，口令变更撤销旧解锁cookie | routes/shares.ts；middleware/ratelimit.ts | SHARE-01：正确口令、错误限流、不同分享隔离、禁用/改密 |
| S08 / P1 | 删除默认管理员登录；一次性setup凭据；强恢复入口；旧已知默认hash不允许登录 | services/auth.ts；routes/auth.ts；Login/ForceChangePassword/Settings；desktop/main.ts | AUTH-02/05，非法/并发/重启setup、旧配置迁移、正常登录与改密保持 |
| R01 / P1 | 一套remote/owner/repo/edit/base；无QUT默认写目标；明确确认UI；全操作settings快照锁；区分commit/push/PR/publication；未知结果只查询 | services/git.ts/githubApp.ts；routes/settings.ts；Settings.tsx | GIT-04–08：两个bare、mock PR、wrong branch/mismatch、token失败、未决回执、配置并发、公开模式后台写禁止 |
| R02 / P1 | 仅确实首次安装创建配置；持久化关键字段先校验再补可选默认；v2结构与旧格式迁移；NOFOLLOW/regular；原件/bak保留；保存成功才更新cache | services/settings.ts:readSettings/persist/updateSettings | AUTH-06：坏JSON/schema/字段截断/不可读/symlink/目录/丢主文件/写失败，真实启动exit1且未就绪 |

## 独立审查的修正闭环

完成一次独立只读候选review；review没有运行应用，其发现由主控/实现者用隔离测试核实并修复，未把“review通过”冒充动态验证。

| 审查发现 | 处理与追加验证 |
|---|---|
| guest推送携带已有私有祖先提交 | guest/显式选择要求HEAD与远端edit一致；owner完整同步另走明确语义；bare历史断言 |
| pending后空选择返回假成功 | 先检查同一持久回执；省略paths/[]干净重试仍拒绝，不丢unknown状态 |
| owner干净Sync、Commit→Sync失效 | 保留owner省略paths的受控快进/推送；explicit[]和guest无选择仍no-op |
| Git目标在await间漂移 | 整个Git队列操作，包括取得Vault/本地锁，都持有settings快照锁；并发两个bare验证 |
| 目标确认没有UI入口 | 现有GitHub设置加入确认checkbox；目标编辑/remote保存后确认失效；后端仍校验 |
| 主控增量发现：截断auth字段被default补空 | 无default持久结构校验+版本2；7种截断反例不能重新消费setup |
| 主控增量发现：文件授权与实际写入之间可切换Vault | mutation持有同一settings快照到索引完成；实际请求+索引gate验证配置修改等待 |

## 正常行为与明确兼容变化

正常文件编辑、保存、搜索、链接、API key、owner登录/改密/恢复、普通本地Git、owner完整同步和guest合规投稿均保留正例。没有用全局403关闭核心能力。

有意改变：不再支持可执行frontmatter；未知语言保留正文。YAML合并键/特殊tag不作为扩展能力，日期为字符串，循环/过深/超预算数据回退原文。内容symlink与反斜杠路径拒绝；图片限定PNG/JPEG/GIF/WebP签名与类型，SVG只不接受为图片上传。普通附件仍可上传到授权目录。同名上传409，不静默覆盖。公开访客图床外发尚未确认，失败关闭；owner图床能力保留。

读取范围仍是完整内容根，不因写入修复擅自变成guest仅读editableRoot。公开模式共享草稿不变；是否需要身份和隔离由产品决定。

配置版本升级2；既有强密码迁移不丢失；旧无版本JWT需要重新登录。新密码至少12字符，setup token至少32字符且只在无持久密码时可消费；成功后持久化密码阻止重放。显式恢复环境密码至少12字符，是长期恢复入口，应在恢复后撤除；本文不包含真实凭据。

## S07 与 R03–R10 的处置

| 项目 | 当前处置 | 剩余验证/启用门槛 |
|---|---|---|
| S07 | 已修限流与口令会话 | 实际TLS浏览器体验放4B；协议cookie属性已测 |
| R03 Cookie/CSRF/Proxy | 默认不信转发头；浏览器Origin写入守卫；可信代理限流分桶 | 4B按实际代理网段配置，验证TLS/Secure/浏览器；不默认trust=true |
| R04 WS | owner鉴权、Origin、异常Cookie安全拒绝、发送前复核会话 | 真实代理长连接及目标设备体验待4B |
| R05 API key | 原scope边界保留，写入重验权限及canonical路径 | 全部低频scope/rate生命周期组合仍需扩展；不宣称完整API审计 |
| R06 秘密与日志 | URL用户信息/query、图床/GitHub错误正文脱敏；配置0600；无真实秘密 | 生产秘密仍存settings/.bak；4B仅一次性夹具秘密，真实接入前决定秘密文件/轮换与备份保护 |
| R07 Git锁/并发 | 操作锁不按年龄删除，未结束merge保留，设置与Git串行；unknown不重放 | 跨主机多实例不支持；单实例独占Vault/Data；实际LFS待验证 |
| R08 预览/插件/动态Vault | parser执行已消除，现有前端/SSR净化保留；数学渲染API回归 | 浏览器XSS/图表插件组合未穷尽；4B固定Vault路径，换根后重启并重建索引；不启用社区插件 |
| R09 CI/部署 | nkustudy-dev与对应PR触发；严格npm ci；新增安全测试；release workflow未触发 | Dockerfile/Compose仍按部署草案在4B另行准备；未构建镜像/改Docker环境 |
| R10 品牌等 | 未做品牌适配 | 可以暂缓；不能把默认文案等同真实投稿契约 |
