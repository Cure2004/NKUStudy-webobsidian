# 4B-1 r2 离线包与隔离存储

日期：2026-10-22（Asia/Shanghai）。本轮仅本地构建、夹具和包装；无SSH/SCP、服务器Docker、Caddy、真实Wiki或GitHub远端写入。服务器操作仍须另行授权。

## 候选与已保留反例

r1 (`nkustudy/webobsidian:4b-1bd3f6c`) 存在真实阻断：保存后的增量搜索缓存没有完整持久化，重启可能漏搜；Mac bind-mounted Vault的Git init持续500。r1 BindGit、cachedrop与liveburst失败保持原状态。同编译代码在Linux tmpfs中Git及bare/mock正例通过，不能把这些正例替代Mac bind失败。r1旧镜像、Data/Vault、报告和日志保留。直接internal网络发布为空、64MiB relay OOM/fork失败、CLI查询错误误作不存在等原件也保留，未改成PASS。

r2独立tag为 `nkustudy/webobsidian:4b-1bd3f6c-r2`，冻结image ID `sha256:c40801f54a4b16bb584a6187f981db5e2a10a0fdd66391fe535b131c35f7c406`，linux/amd64。应用代码仍为 `1bd3f6c088466c8b46b447c9516cec623bc194f6`，源码/文档基线为 `cb3a96e8546844416258c1af64549724685eeb04`。r2前13层与r1相同，第14层增加固定启动guard，业务源码未修改。

- lock SHA256：`671963de571dfc611e7f370482640455928bde108ed0e7c9383fd633f090d7ed`。
- Dockerfile SHA256：`8331f28f55ea2bc785315c5da166c4fbf54887d9414504a17ed3f42c5f184bdb`。
- 108项source-manifest-r2 SHA256：`46ad2d97bdc2c2fcb0f9b8811b9424886091ed71a81b9c17924cf62f9990b186`。
- container-entrypoint.sh SHA256：`9b2eafebd953c4cf3f419199d79685c282600face47fb94fee8cc07f95d79510`。

APP固定 `/usr/local/bin/nkustudy-entrypoint`，不透传命令；验证UID1000、Vault/Data物理目录及所有者、cache/history类型和权限。每次启动保留上一份派生cache，再冷建索引，不删除历史证据。relay显式覆盖为node固定TCP入口，不执行APP guard；其idle已改为60秒，APP上传接收仍30秒，以便返回真实408。relay SHA256为 `69a4d687d6f89183c72d20dfcec1675a4d6324170e73917343ccdee85c47cea7`；实际默认上传在30.629秒返回408并清理，见总控r2矩阵回执，不由静态检查代替。

## r2默认存储与约束

Vault/Data改用本实例专属Docker **named volumes**，由Linux Docker daemon本地文件系统承载；没有safe.directory豁免，没有复用r1 bind或原版数据。实例 `nkustudy-4b-1bd3f6c-r2` 的卷为同名前缀的 `-vault`、`-data`。init必须同时确认新state、容器、网络、两个卷均不存在，随后创建新代际和自造sentinel；绝不接管已有同名卷。

每卷固定local driver/local scope、无bind options，并核对以下labels：instance、volume-role、image-id、state绝对路径SHA256。`.nkustudy-4b-volumes.json`保存真实Name/Driver/Scope/Mountpoint/Options/Labels；后续生命周期精确比对，Mountpoint必须是该命名卷的Docker volumes路径。容器Mounts也必须与该记录的Name/Source/Destination一致，拒绝任意bind替代或额外数据挂载。

app只有internal网络、没有宿主端口：512MiB memory/swap、0.5CPU、96PID、256MiB V8、64MiB tmpfs。relay同镜像、只读挂载hash绑定的relay.mjs，无Data/Vault/env-file/秘密：128MiB memory/swap、0.1CPU、32PID、16MiB V8、16MiB tmpfs，固定argv目标app:8787、maxConnections16。两个容器总预算640MiB，均1000:1000、readonly、cap_drop ALL、no-new-privileges、restart=no、有限日志。relay先create/connect两专属网络再start，仅发布127.0.0.1:28787；app不发布端口。internal无普通外网路由，但不等于隔离宿主bridge服务。

HostConfig之外，运行门禁还以一个非特权shell只读容器私有cgroup v2的memory.max、memory.swap.max、pids.max、cpu.max，要求512/128MiB、swap0、96/32PID、CPU比率.5/.1。start/resume最终就绪必须两容器均Running且实际限额VERIFIED；运行中status同样核对。缺文件、无权限、读失败、max或漂移均非零；v1/未知控制器环境BLOCKED，不做猜路径fallback。已停容器只输出NOT-AVAILABLE和“仅元数据检查”，不代签实际限额，允许停止后快照。门禁失败保留代际，启动失败沿原逻辑只停止自有APP/relay；stop/cleanup不因约束漂移失去安全退出能力。

资源限制是实测条件：总控30分钟soak为1800.183秒、1191loops、5959请求、0FAIL；APP整轮mock峰382.75MiB、soak峰291.977MiB。relay最终cgroup peak为134270976 bytes（128.050781MiB），采样current峰126.75MiB，memory.events.max窗口末53/停前55，OOM0且健康。该内核peak略高于配置计数边界，不掩盖或当作更多可用内存；128MiB relay余量很小，保留CONDITIONAL压力风险，不能沿用早期124.37MiB或提高预算取得通过。真实Ubuntu共存、内核/原生AMD64与宿主余量仍须下一阶段验证。

init的唯一root helper为已验证镜像、显式entrypoint node、network=none、128MiB/同额swap、PID32；仅挂刚创建的两卷，拒绝非空，再设置owner1000/mode0700和sentinel。所有helper绕过APP入口只执行固定操作，不接真实数据。

## 本机candidate与正式release的区分

当前实际本机候选目录为 `/Users/carlos/Documents/ChatGPT/New project 3/4b-artifacts-20261022/candidate-r2-runtime`。旧candidate-r2保持原样。candidate.json为format2/kind=local-candidate，绑定本机Docker Engine ID和context，必须显式 `--local-candidate`，复制到其他引擎也拒绝。没有tar，不能load或作为服务器离线包。

```bash
bash scripts/4b/offline/offline.sh --local-candidate init CANDIDATE_DIR NEW_STATE nkustudy-4b-example
# init不会启动；仅在已确认的fresh卷中写入自造fixture后再执行start。
bash scripts/4b/offline/offline.sh --local-candidate start CANDIDATE_DIR NEW_STATE nkustudy-4b-example
bash scripts/4b/offline/offline.sh --local-candidate status CANDIDATE_DIR NEW_STATE nkustudy-4b-example
```

真实容器、重启索引、Git、上传、30分钟资源与新代际恢复通过后，总控已导出正式r2 tar。assemble_package.py仅接受r2 tag和final-image-r2.json对应的真实tar，使用source-manifest-r2.json生成format2/kind=release，不包含candidate.json/本机engine授权。包含tar、release.json、SHA256SUMS、Dockerfile/source manifest、入口/relay及offline.sh、deploy.py、storage.py、manifest.py、validate_runtime.py、snapshot.py，共15个文件。runtime scripts不依赖compose、宿主Node/npm、在线pull或build；需要Docker Engine28+、Bash、Python3.9+、curl。

正式包目录：`/Users/carlos/Documents/ChatGPT/New project 3/4b-artifacts-20261022/offline-package-r2`。归档为同目录 `nkustudy-webobsidian-4b-1bd3f6c-r2-linux-amd64.tar`，80,442,368 bytes，SHA256 **`c2a1839b9037784695a6e8ecfeba036a4f5ae4c3cd98ce561c09b9e5617d3beb`**。

实际归档验证为linux/amd64、14层、固定APP guard，三个不同身份分别为：config `sha256:b452934919d5dcee5a0c252716e9ef92d509456198acc85043cfbe6e24906c21`；AMD64 manifest `sha256:05078036f07abe6fb1d21b840915561eb0d026d5bd33ccf417c18dcd65d6469b`；OCI index/Docker29本机ID `sha256:c40801f54a4b16bb584a6187f981db5e2a10a0fdd66391fe535b131c35f7c406`。这些值来源于真实tar解析，不把config和index混为一个ID。validator校验单tag、所有blob SHA及descriptor大小、实际AMD64 config、Docker/OCI层一致、解压rootfs diff_ids、源码/lock/build/入口hash。classic store可能以config为ID；只接受归档证明的准确ID，并将实际post-load不可变ID写入代际marker。真实归档原件为 `evidence/offline/volumes-r2/release-r2/actual-archive-info.json`。

未来经授权的服务器步骤如下（当前未执行）：

```bash
PACKAGE=/absolute/path/to/reviewed-r2-package
STATE=/absolute/path/to/new-private-state
INSTANCE=nkustudy-4b-isolated-r2
(cd "$PACKAGE" && sha256sum -c SHA256SUMS)
bash "$PACKAGE/offline.sh" verify "$PACKAGE"
bash "$PACKAGE/offline.sh" load "$PACKAGE"
bash "$PACKAGE/offline.sh" init "$PACKAGE" "$STATE" "$INSTANCE"
bash "$PACKAGE/offline.sh" start "$PACKAGE" "$STATE" "$INSTANCE"
bash "$PACKAGE/offline.sh" status "$PACKAGE" "$STATE" "$INSTANCE"
```

setup token只存在state/0600 setup.env，不打印，不传relay。操作者私下初始化独立密码；默认123456不可用、setup重放拒绝、公开编辑关闭，GitHub/PAT/App/图床均为空。start/resume健康等待最多240秒，先核同名APP/relay进程与Docker Health，再探测loopback；HTTP200不替代功能/DOM。APP/relay的Path、Args、Entrypoint和Cmd分别核查，不可通过覆盖APP命令绕过guard。

## 快照、恢复与清理

snapshot.py仅用于本轮自造夹具。必须先停止APP和relay，核对容器归属、卷labels/Mountpoint，以及没有其他容器使用这些卷。无网络helper以readonly挂源卷，复制到新的0700私有staging；归档只含Vault/Data及身份marker，普通文件0600，不传播setup.env。staging和snapshot含一次性settings秘密，留在受限外部目录，不进入发行包；不承诺任意可执行位或真实Wiki/LFS语义。

restore先核SHA和全部成员，拒绝重复、绝对/..路径、symlink/hardlink/设备，确认settings有持久化密码后，才创建全新state及两个新owned volumes；绝不覆盖源或失败现场。显式网络隔离node helper只写新卷，owner1000；恢复元数据绑定image/name/port，start才允许无setup.env。APP仍执行配置schema fail-closed和guard，缺失settings不能重置为新安装。

```bash
# 正式release示例；本机candidate在snapshot.py后加 --local-candidate。
bash "$PACKAGE/offline.sh" stop "$PACKAGE" "$STATE" "$INSTANCE"
python3 "$PACKAGE/snapshot.py" backup "$PACKAGE" "$STATE" "$INSTANCE" PRIVATE_SNAPSHOT
python3 "$PACKAGE/snapshot.py" restore "$PACKAGE" PRIVATE_SNAPSHOT EXACT_SHA256 NEW_STATE NEW_INSTANCE
bash "$PACKAGE/offline.sh" start "$PACKAGE" NEW_STATE NEW_INSTANCE
```

真实恢复闭环已经完成：`nkustudy-4b-r2-recovery2` 从停止的r2自造源恢复到新state/两新卷，26条串行命令/HTTP回执全部成功（不是26个独立unit case）。登录、`4b-fixture/renamed.md`精确字节、unique4bneedle搜索、本地选中文件提交/日志、新写入及再次重启后的新写入搜索通过；start/status实际cgroup四限额全部VERIFIED。最后恢复Git disabled、公开模式始终关闭；stop/cleanup只移除恢复2容器和网络，恢复两卷/state保留。源1104个普通文件前后SHA相同，源state/credentials不变，setup.env未传播。证据 `evidence/offline/volumes-r2/real-recovery-nkustudy-4b-r2-recovery2/summary.json`、`command-results.json`、`source-volume-hash-comparison.json`。

第一轮恢复的Git init返回500，保留FAIL与停止现场：源G06已主动关闭Git写入，恢复忠实保留该安全策略，runner漏了测试前提。没有重放旧实例请求。恢复2先以readonly/network-none/UID1000核HEAD=draft/4b、origin=/data/fixture-remote.git及同路径bare=true，再通过owner设置API仅在新代际显式启用本地Git；autoSync/autoCommit/App/PR始终关闭，末尾再禁用。初次runner的CookieJar命名遮蔽错误也保留，发生在任何Docker/HTTP/快照调用之前。两次失败没有改业务实现或源数据。

stop先relay后app，核归属及挂载后只停本实例。cleanup要求两容器均停，仅移除专属APP/relay及两网络，**保留两个named volumes、state、credentials、snapshot和审计证据**，没有volume rm/prune。首次回滚就是停止r2、保留现场，不启动或覆盖r1。daemon/权限/未知CLI错误不能视为对象不存在；必须非零退出，不打印PASS。只有完整错误明确指向请求的那个缺失对象才可optional。

## 证据与未完成项

r1原34/39合同、真实归档10项、daemon/权限4项及旧脚本/报告完整保留，适用范围不扩充为r2容器通过。r2证据独立在 `evidence/offline/volumes-r2/`：prepare真实只读回执；最小11项、扩展15项及最终16项unit合同（full-contract-r2）；runtime guard反例、named-volume快照正反例。unit合同不创建真实容器，不是Mac/Ubuntu动态验收。r2容器矩阵83个unique PASS、浏览器7 PASS/1 NOT-RUN（rename prompt）、默认30秒408、1001文件冷建/重启搜索、Git、30分钟稳定性及上述停止快照恢复均有真实回执。包内说明在assemble前冻结；后续真实release verify/load与反例结果独立保存在外部审计证据和总控报告，不反复重写包内说明或制造自引用hash。

新增cgroup-r3为19个unit case通过（case04内24条限额反例、case05内7条格式反例已包含，不另加测试数）；4条host shell文件夹具输入包含在case18/19。该合同的CPU正例明确为合成预期；后续真实恢复2的start/status已经实读cpu.max=50000/100000及10000/100000，与内存/Swap/PID一起VERIFIED，另有独立实际回执。原16项合同在新脚本下独立复跑通过，旧16项证据保留。详见工作区覆盖账本 `server-script-test-coverage.md`，该动态账本不装入发行包。
