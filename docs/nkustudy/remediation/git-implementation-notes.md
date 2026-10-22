# Git 修复核收说明

本地实现范围：S04 / R01，并收紧 R07 的锁与恢复行为。未提交，交由总控统一整合；未连接真实 GitHub 或 Wiki。

## 实现

- `services/git.ts` 的 `selectedPaths` 区分省略、空数组、非法类型；规范化最终内容路径，拒绝目录式宽选、元数据、符号链接与 guest 越界。Git 所有选中文件使用 literal pathspec。
- `commitAllImpl` 在独立临时 index 从 HEAD 构建树，读取实际 delta 校验只含批准文件；`commit-tree` 加 `update-ref` CAS 更新明确编辑分支。真实 index 只更新已选择项，其他 staged blob 不变。空选择在身份、LFS、index、commit之前返回 no-op。
- `writeTarget`、`assertTargetRepository` 统一显式 edit/base（无 web-edit/contribute 回退），检查开关、remote、owner/repo、确认标记、当前branch与origin；错误分支不自动checkout。`git.branch`保留为旧显示字段，不控制新写入。
- `syncImpl` 写前核对远端edit/base存在、与当前HEAD关系；guest和显式文件选择要求当前HEAD恰等于remote edit，避免一次合法选择携带已有未推送的owner/private提交历史。owner省略paths表示完整同步，可推送已本地提交历史，或在干净且无分叉时快进拉取；明确[]仍无操作，guest不获得此权限。
- sync、独立push和独立PR写入保存 `DATA_DIR/git-sync-receipt.json`。未知push为 `pushed:null`，未知PR保留已确认push=true；重复写阻断，且pending检查先于空选择/干净工作区no-op，不能将未知结果误报Synced。owner `GET /api/git/sync-status`仅查询远端ref/已有PR，不重放写操作。
- PR查询失败/格式异常不尝试创建；已有未审PR暂停新sync，查询复用不会重复POST。输出分别含本地commit、push、PR以及 `publication:not_performed`。
- `githubApp.ts`严格解析GitHub host，遵守appEnabled；token缓存绑定私钥摘要；外部HTTP有15秒截止时间；API异常不回显远端响应正文。
- `.git`已有锁不按年龄清理；本进程串行队列加协作实例operation lock；未完成merge/conflict保留，不自动reset/abort或替用户解决冲突。
- 整个Git操作（含取Vault根、operation lock、transport/branch/PR/receipt）持有settings mutation队列的snapshot锁，owner改配置排队到操作结束。公开guest模式下后台autoSync/autoCommit/baseFollow不再无身份全量外发，并在该锁内再次核对开关。owner显式保存、local commit、sync、push、PR仍保留；followBase保留干净工作区fast-forward-only路径。
- `routes/settings.ts`绑定确认的5项为git.remote、github.owner/repo/editBranch/baseBranch；改变任一项且同请求未明确targetConfirmed=true则撤销确认。UI由总控集成。

## 当前回归证据

`node scripts/record-check.mjs git-tests node --import tsx --test --test-concurrency=1 server/test/git.test.ts`

24 tests / 24 pass / 0 fail / exit 0：`git-tests-2026-10-22T10-02-13-712Z.json`及同名log。早期失败保留：simple-git4拒绝继承的GIT_PAGER等环境、Mac /var与/private/var路径差异；已改窄环境白名单与物理仓库根。

测试逐个创建临时内容仓库与bare remote，真实Git路由/commit tree/index/branch/磁盘断言。GitHub使用内存fetch mock和本地生成的假RSA夹具；Git URL rewrite只到临时bare。夹具已设置file-only Git协议拒绝外连，该版本24项全部通过；总控仍需统一全集回归。并发目标变更测试使用两个bare仓库和可控mock gate，确认修改等待Git结束，新目标未被写入。

覆盖GIT01–08的本轮关键边界及GIT09普通二进制/rename/delete。GIT09真实git-lfs工具、LFS对象推送/恢复尚未运行，不能标成完整PASS；这与本地普通Git正确性分开。真实App权限、GitHub分支保护、网络故障完整分布、Linux目标服务、实际Wiki业务仍未测试。

## 兼容与后续门槛

1. 旧QUT默认配置仍可读取，但未确认目标不能写；需要owner配置明确edit/base/remote/仓库并确认。当前内容分支必须为该edit，不偷偷切换用户branch。
2. 明确空选择不会推送旧提交；已有local-only历史由owner审查后使用独立push或省略paths的完整Sync，guest不能触发附带发布。
3. base/remote落后或冲突不自动产生合并/覆盖；保留状态，进入明确审查流程。
4. 未知回执若查询仍不能确认，继续阻断写入，不自动删除或另起操作；需要后续owner针对现场确认恢复策略。
5. 单实例专属内容目录与秘密是运行前提；配置变更现已由snapshot锁串行保护；不要与外部可写工作区/并行Git进程共享挂载。协作锁不能代替目标环境的独占部署验证。
