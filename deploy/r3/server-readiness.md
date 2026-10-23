# 4B-1 r2 服务器隔离测试前置

日期：2026-10-22（Asia/Shanghai）。服务器约1.6GiB RAM、无Swap是用户给定条件，本轮未登录核实。没有SSH/SCP、生产Docker/Caddy、真实Wiki或GitHub远端写入。本文件不是服务器部署回执。

r1曾真实重启漏搜、Mac bind Vault Git init500，因此不能进入服务器准备；Linux tmpfs Git正例不抵消Mac bind失败。r2保留同业务代码和r1前13层，通过固定启动guard保留cache后冷建，并以独占Linux Docker named volumes替代bind。没有safe.directory豁免，Mac bind本身仍未修复；r1镜像/目录/证据原样保留。

已完成的本地恢复证据：恢复2在新代际完成26条命令/HTTP回执、登录/文件精确字节/搜索/local Git提交/新写入/再次重启搜索；实际v2 memory/swap/PID/CPU四限额VERIFIED。源1104普通文件SHA及源state/credentials前后一致，setup.env未传播；恢复2容器/网络已清理，卷/state/私有快照保留。首次恢复Git500是源已禁用写入的预期策略拒绝、harness漏前提；旧失败现场保留，新代际显式固定本地bare后完成，最终再禁用Git。详见 `evidence/offline/volumes-r2/real-recovery-nkustudy-4b-r2-recovery2/`。这些回执仍只证明Mac Docker Desktop内的Linux AMD64受控夹具，不是Ubuntu服务器共存或业务上线。

正式归档已经在上述恢复通过后导出并独立解析：`/Users/carlos/Documents/ChatGPT/New project 3/4b-artifacts-20261022/offline-package-r2/nkustudy-webobsidian-4b-1bd3f6c-r2-linux-amd64.tar`，80,442,368 bytes，SHA256 `c2a1839b9037784695a6e8ecfeba036a4f5ae4c3cd98ce561c09b9e5617d3beb`。真实config/manifest/index与源/lock/guard绑定见同包release.json及deployment-package.md。只有完整SHA256SUMS校验、离线verify/load通过的format2/kind=release可交接；不转交本机candidate、state、setup.env、密码或私有快照。

资源结论为CONDITIONAL：1800.183秒soak、1191loops、5959请求均0FAIL；APP整轮mock峰382.75MiB、soak峰291.977MiB；relay最终cgroup peak134270976 bytes=128.050781MiB、采样current峰126.75MiB、memory.events.max窗口末53/停前55，OOM0且健康。128MiB relay已接近预算，不能用早期124.37MiB作最终峰或宣称充裕；不放宽640MiB总预算。服务器必须重测原生内核/CPU和既有服务共存，若出现OOM/持续压力则退出，不强行上线。

进入下一阶段的必要条件：

1. r2真实APP512MiB+relay128MiB总640MiB预算、无swap、1001自造corpus冷启动、矩阵/浏览器、30分钟稳定性、默认APP30秒上传408、local Git/bare/mock、重启不漏新写入搜索、完整volume快照/新代际恢复均有可复核回执；不能由unit或HTTP200替代。
2. 此后才导出r2正式AMD64 tar、形成format2/kind=release、SHA256SUMS及准确config/manifest/index绑定，并在本地真实load/启动复核。local-candidate无归档，显式flag且绑定本机engine/context，不能当服务器发行包。
3. 另行获得本次服务器隔离部署授权，确认唯一负责人、准确镜像/锁/入口/source hash和完整归档。Docker Engine28+、Bash、Python3.9+、curl与磁盘余量就绪，无需compose、在线拉取或在线build。当前服务器Engine版本UNKNOWN；不自动升级daemon。
4. 只读核查宿主既有服务、端口、内存/CPU峰值与OOM，再确认现有峰值+新实例640MiB预算+系统安全余量可共存。约256MiB系统余量仅初始策略，不是实测；若不能满足，应停止同机试运行，不能继续增大预算或挤压既有服务。
5. 使用全新canonical私有state、独立named volumes/container/network，不能复用原版或r1 Data/Vault。卷名、local driver/scope、空Options、instance/role/image/generation labels、真实Mountpoint和容器Mounts都匹配；不手工修改Docker Volume Mountpoint目录，不接入真实内容。
6. app仅internal网络，不发布端口；无Data/凭据的固定TCP relay连专属ingress/internal，只发布127.0.0.1:28787。relay idle60秒、连接数16；APP上传30秒。Engine<28的localhost发布存在官方同L2问题，脚本拒绝；internal也不是完整宿主bridge网络沙箱。参考[Docker官方端口文档](https://docs.docker.com/engine/network/port-publishing/)。
7. app和relay始终1000:1000、readonly、cap_drop ALL、no-new-privileges、日志/CPU/PID/tmpfs限制；APP guard不接受覆盖命令，relay显式node argv；helper仅无网络固定操作。一次性setup.env0600且不传relay，不使用恢复密码、App/PAT、图床或正式remote。**只支持已验证的容器私有cgroup v2路径**：HostConfig不等于实际执行；start/resume就绪及运行中status必须由非特权只读shell实读memory.max=512/128MiB、memory.swap.max=0、pids.max=96/32、cpu.max配额/周期=.5/.1。文件缺失、无权限、读失败、无限额或漂移均非零；v1、控制器未委派、未知rootless限制环境均BLOCKED，不猜路径或放宽限额。停止容器的cgroup可能已消失，status明确NOT-AVAILABLE/仅元数据，不代签运行限额；不阻止身份已核对的停止、清理或快照。
8. 所有拟运行的服务器脚本在本地以保存输入完成正常/失败路径。unknown Git结果只查询原key，禁止重放；文件/设置出错失败关闭。当前真实Ubuntu原生CPU/内核与共存、TLS代理、真实Wiki容量、LFS、业务策略仍分别待验收。

任何OOMKilled、持续内存/PID超预算、资源限制被放宽、重启/写入/索引失败、非法写或秘密泄漏、意外外连、loopback以外发布、既有服务明显受损，立即只停本候选，保留卷/state/log与失败case，不循环重启、不提高预算。daemon不可用或权限拒绝时stop/cleanup必须失败报告，不能把查询失败当实例不存在或宣称已停止；引擎恢复后先只读核查再行动。

首轮回滚仅停止r2并保留现场，不修改r1或其他服务。cleanup只移除本实例已停app/relay和两网络，永久保留named volumes、state/credentials、私有snapshot、staging和历史证据。恢复只从停止后的自造数据快照写入新generation和新卷，先完整成员/hash校验，原源永不覆盖；实际登录、文件、搜索、Git、新写入和再次重启必须通过。

正式上线、真实Wiki/App接入、公开编辑、域名/TLS/Caddy、秘密长期存储/轮换、最终附件额度和真实容量/业务验收均不属于本轮。Chokidar/braces公告与OS漏洞必须如实保留，构建和测试通过不等于漏洞清零。
