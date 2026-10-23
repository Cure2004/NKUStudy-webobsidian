# r4 停止快照 → 全新 r3 代际：执行与回滚手册

日期：2026-10-23（Asia/Shanghai）。本轮仅在 Mac 新建夹具进行演练，没有操作服务器 r4。以下服务器步骤须另行授权，名称和路径必须现场核定；本手册不是服务器执行回执。

## 镜像和部署版本分离

- 冻结镜像为 `nkustudy/webobsidian:4b-1bd3f6c-r2`，业务代码 `1bd3f6c088466c8b46b447c9516cec623bc194f6`，源码基线 `cb3a96e8546844416258c1af64549724685eeb04`。
- r2 tar：`nkustudy-webobsidian-4b-1bd3f6c-r2-linux-amd64.tar`，SHA256 `c2a1839b9037784695a6e8ecfeba036a4f5ae4c3cd98ce561c09b9e5617d3beb`，80,442,368 bytes。
- `deploy.py` 是宿主部署脚本，不在镜像 108 项 `source-manifest.json` 中；将部署环境 `TRUST_PROXY=false` 改为 `TRUST_PROXY=1` 不要求重建镜像，也不要求重导出或重标记镜像 tar。
- 不能修改镜像 `source-manifest.json` 来表达部署脚本变化；它的哈希已写进镜像 label。修改该清单再更新 release.json 会触发 archive source label mismatch。
- r2 `release.json` 的严格字段集合没有部署版本字段。可保留它的原字节，在独立 r3 目录增加部署发行元数据；新 r3 `SHA256SUMS` 覆盖部署脚本、r3 文档和新元数据。若增加机器门禁，必须同时覆盖有效包与脚本漂移反例，不能仅增加未使用的装饰性哈希。
- 可原样复用的镜像绑定：config `sha256:b452934919d5dcee5a0c252716e9ef92d509456198acc85043cfbe6e24906c21`；AMD64 manifest `sha256:05078036f07abe6fb1d21b840915561eb0d026d5bd33ccf417c18dcd65d6469b`；index `sha256:c40801f54a4b16bb584a6187f981db5e2a10a0fdd66391fe535b131c35f7c406`。实际 Docker store 可返回其中一个已验证 ID，不能把不同种类 digest 混为同一物。

独立 r3 包必须普通复制可变成员，不能与 r2 脚本建立 hardlink 后编辑。运行任何 r2 Python 校验须使用 `PYTHONDONTWRITEBYTECODE=1`，避免向冻结目录增加 `__pycache__`。打包前后对整个 r2 文件集合与所有哈希进行对照，而不仅核 tar。当前 r2 `SHA256SUMS` 自身 SHA256 为 `cdf727f608c5d041f30842a5f4fd1a3dbac0a255b09f509e509d602268ff1c50`。

## 原有绑定及失败路径

`manifest.py` 校验格式、严格字段集合、基线 commit、锁、Dockerfile、entrypoint、relay、源码清单，再验证真实归档单 tag、config 架构、所有 OCI blob 地址及 descriptor 大小、Docker/OCI 层一致、解压 diff IDs、固定 entrypoint 和镜像 label。`deploy.py` 的 init/start/resume 对正式 release 重新 verify；load 拒绝同 tag 指向未核准镜像；实例 marker 绑定实例名、不可变实际 image ID 和端口。

`VolumeStore` 绑定两个独占命名卷的 Name/Driver/Scope/Options/Labels/Mountpoint。标签包括实例、卷角色、image ID、state 绝对路径 SHA。init/restore 拒绝已有 state、容器、网络、卷；卷复制 helper 使用 network=none。cleanup 只移除本实例已停容器和网络，不删卷、state、凭据或快照。

运行约束：app 512 MiB/0.5 CPU/96 PID、relay 128 MiB/0.1 CPU/32 PID、swap=0、UID 1000:1000、只读根文件系统、cap-drop ALL、no-new-privileges、独占 internal/ingress 网络、relay 仅回环发布。start/resume/status 核对实际 cgroup v2，停止态只能报告元数据核对，不能算运行约束验收。

r3 runtime validator 已校验 NODE_ENV、TRUST_PROXY、COOKIE_SECURE 的非秘密投影，并测试缺失、重复和漂移。stop 仍依赖原有身份和挂载检查，可用于配置漂移的自有实例。

## 服务器迁移前提

1. 另行获得服务器执行授权；本轮不运行以下命令。
2. 确认真实 r4 的部署目录、canonical state 绝对路径和 `.nkustudy-4b-instance`，使用它原来的包作为 `OLD_PACKAGE`。本轮没有服务器回执，不能凭“r4”推断容器名、state 路径或当前配置。
3. 确认当前 r4 确实使用该 r2 AMD64 镜像及 format2 命名卷。若 ID、标签、挂载或源状态不符，停止；不要修改 marker 或接管卷。
4. 核对 Caddy 的 TLS、Basic Auth、清理/覆盖转发头、去除上游 Authorization、固定回环 upstream。生产 Caddy 本轮未读，是否满足仍待现场只读核查。如果这些前提缺失，r3 包不能单独修复代理信任边界。
5. 新 r3 容器、卷、网络、state 均不存在。确认 Docker Engine 28+、私有 cgroup v2、磁盘余量；保持原资源预算。旧 r4 已停后再启动新 r3，不同时保留两套运行预算。
6. 旧 r4 未包含真实 Wiki、公开编辑及外连策略仍关闭。私有快照含认证数据，目录0700、文件0600，不放进发行包或公开证据。

## 单次切换方案

以下变量由现场已核定路径填写，禁止猜测。`NEW_STATE` 的父目录须先存在且 canonical；快照目录也须独立于 state。

```bash
export PYTHONDONTWRITEBYTECODE=1
export NKU_4B_PORT=28787
OLD_PACKAGE=/absolute/path/to/original-r4-deployment-package
OLD_STATE=/absolute/path/to/verified-r4-state
OLD_INSTANCE=nkustudy-4b-VERIFIED-OLD-NAME
NEW_PACKAGE=/absolute/path/to/reviewed-r3-package
NEW_STATE=/absolute/path/to/fresh-private-r3-state
NEW_INSTANCE=nkustudy-4b-https-r3-20261023
SNAPSHOT_DIR=/absolute/path/to/new-private-r4-snapshot-directory
SNAPSHOT="$SNAPSHOT_DIR/r4-stopped-before-r3.tar"
```

先核定发行包总归档 SHA256 与传输来源，再解包到全新目录。包内正常验证：

```bash
(cd "$NEW_PACKAGE" && sha256sum -c SHA256SUMS)
bash "$NEW_PACKAGE/offline.sh" verify "$NEW_PACKAGE"
```

本机已有服务器 r4 使用的镜像，优先复用原 image。检查 `docker image inspect --format '{{.Id}}' nkustudy/webobsidian:4b-1bd3f6c-r2` 并用 `python3 "$NEW_PACKAGE/manifest.py" accept-id "$NEW_PACKAGE" VERIFIED_IMAGE_ID` 校验。无需重打 tag 或 `docker load`。仅在目标上确实缺少该 tag/image 时，另按包的 `load` 门禁处理，不能覆盖不一致 tag。

停止 r4 并取得一致快照：

```bash
bash "$OLD_PACKAGE/offline.sh" status "$OLD_PACKAGE" "$OLD_STATE" "$OLD_INSTANCE"
bash "$OLD_PACKAGE/offline.sh" stop "$OLD_PACKAGE" "$OLD_STATE" "$OLD_INSTANCE"
docker inspect --format '{{.State.Running}}' "$OLD_INSTANCE" "${OLD_INSTANCE}-relay"
mkdir -m 700 "$SNAPSHOT_DIR"
python3 "$OLD_PACKAGE/snapshot.py" backup "$OLD_PACKAGE" "$OLD_STATE" "$OLD_INSTANCE" "$SNAPSHOT"
sha256sum "$SNAPSHOT"
```

两容器必须明确为 false。快照输出 SHA256 与独立 sha256sum 完全一致后，将该值填写为 `SNAPSHOT_SHA256`；不要复用旧值。保留旧 r4 容器、两网络、两个卷和全部 state，不执行 cleanup。backup 在复制前后都核停止态、专属卷与消费者，源卷 readonly 挂载。

确认旧 r4 已停且 28787 已释放后，恢复到全新代际。可用 `ss -ltnp` 检查监听者，并进行一次 Python socket 绑定探测后立即关闭；若仍不可绑定，应等待连接状态释放并重新只读检查。Mac 演练首次遇到停机后暂时不能绑定，保留了该失败，等待释放后在新代际通过。持续占用则停止切换并调查，不杀死未知进程、不绕过绑定检查。

恢复到全新代际：

```bash
SNAPSHOT_SHA256=EXACT_64_HEX_FROM_VERIFIED_SNAPSHOT
python3 "$NEW_PACKAGE/snapshot.py" restore "$NEW_PACKAGE" "$SNAPSHOT" "$SNAPSHOT_SHA256" "$NEW_STATE" "$NEW_INSTANCE"
bash "$NEW_PACKAGE/offline.sh" start "$NEW_PACKAGE" "$NEW_STATE" "$NEW_INSTANCE"
bash "$NEW_PACKAGE/offline.sh" status "$NEW_PACKAGE" "$NEW_STATE" "$NEW_INSTANCE"
```

**恢复后不要再运行 init。** restore 已创建新代际并确认持久化密码；setup.env 不传播，登录应使用已存在应用密码。源快照 marker 的 image ID 必须属于 r3 原样复用的 tar，目标 marker 使用该主机实际 image ID。

目标从恢复起固定 28787。不要先恢复到 28788 后手改 marker 切换；端口属于代际绑定。若需要旁路彩排，使用另一个名字、state 和两新卷的独立 28788 代际，彩排停止后从同一只读快照另建最终 28787 代际；不得复用彩排实例的 marker/卷。

最终验收按一次浏览器会话集中完成：外层 Basic Auth、应用已有密码登录、Secure/HttpOnly/SameSite Cookie、无Cookie与错误Cookie API拒绝、只读文件/搜索及一个受控测试文件写读、HTTPS WebSocket成功、恶意 Origin 的 POST和WebSocket仍403、退出后原会话失效、公开编辑和远端接入关闭。Caddy上游/应用旁路回执只可记录“Authorization 不存在”等布尔值，不记录 Basic 凭据或 Cookie。健康200和HostConfig不替代这些验收。

## 失败与回滚

- 发行包或镜像绑定不符：不停止原 r4、不加载/覆盖镜像；保留证据，修正来源后才继续。
- stop/inspect 失败或状态不明确：不得开始新 r3；不能将 Docker daemon/权限错误视为容器不存在。先恢复只读可观测性。
- backup失败：保留 staging/partial/源卷；不要删文件后重跑到相同输出。若确认原 r4 停止且需要恢复服务，以原包 resume；以后用新的快照路径重新发起。
- restore失败：原 r4 快照/卷保持不变。失败目标 state/卷保留，不重跑 restore 覆盖；回滚先确认新代际没有运行容器，再恢复旧 r4。下次恢复用新代际名和新 state。
- start或功能验收失败：先停止新 r3，再确认它两容器均 false，28787 无其他服务占用，最后恢复旧 r4。不要并行执行 stop/start。

```bash
bash "$NEW_PACKAGE/offline.sh" stop "$NEW_PACKAGE" "$NEW_STATE" "$NEW_INSTANCE"
docker inspect --format '{{.State.Running}}' "$NEW_INSTANCE" "${NEW_INSTANCE}-relay"
bash "$OLD_PACKAGE/offline.sh" resume "$OLD_PACKAGE" "$OLD_STATE" "$OLD_INSTANCE"
bash "$OLD_PACKAGE/offline.sh" status "$OLD_PACKAGE" "$OLD_STATE" "$OLD_INSTANCE"
```

若新代际容器尚未创建，不能期待双对象 inspect 成功；必须逐个只读确认“明确不存在”或“已停”，遇daemon/权限/未知错误即停。`stop` 会按身份和挂载检查已存在自有容器，不依赖新runtime代理门禁。

回滚恢复的是停止快照时的旧 r4 数据；新 r3 验收写入不会自动并回旧卷。保留失败 r3、两卷、state、日志及私有快照，禁止自动反向复制或删卷。旧 r4 原有公网登录403会随兼容性回退重新出现，应如实报告；回滚成功不能表述为HTTPS修复成功。

## 本地重验入口与避免覆盖旧证据

- `test_volumes_r2.py`：16项命名卷/启动/标签/挂载/快照/恢复/已有对象保留/正式归档门禁合同；模块 `PACKAGE`/`EVIDENCE` 是硬编码，须在新 runner 内显式覆盖后运行，不能原样执行覆盖旧证据。
- `test_cgroup_r3.py`：19项实际cgroup解析、metadata-only、start/resume失败只停本实例、CLI不确定失败关闭；同样硬编码历史证据路径，需新 runner 重定向。
- `test_archive_r2.py PACKAGE NEW_FIXTURES`：真实原tar、classic投影正例、ID正反例、hash/架构/guard/源码label/层diff/blob/tag反例；EVIDENCE硬编码且mkdir不得存在，需副本改为新证据路径。原始 tar 的 hardlink仅被读取，变异归档写新文件；r3 重验宜使用普通复制确保隔离。
- `test_release_smoke.py`：真实冻结包生命周期/API/重启索引；硬编码实例名、端口、目录名及 r2 SHA256SUMS，不能原样套用 r3，需独立新名字/新state、正确r3清单并增加HTTPS矩阵。
- `recovery_real.py`：现有测试依赖旧私有夹具与特定Git路径，只可复用流程思想。r3应创建新的本地源/目标，并测试 snapshot hash错误、目标已存在、持久化认证缺失、路径穿越等失败在写目标前阻断。

## 集中验收与反馈

候选：`r3-https-20261023` 部署包加原 r2 AMD64 镜像。前提：外部归档 SHA256、包内校验、现场代理边界、r4 停止快照、新 r3 两容器实际 cgroup 四项限制全部通过。

| 顺序 | 操作 | 预期 | 异常处理 |
|---|---|---|---|
| 1 | 无痕窗口打开公网域名，先不提供 Basic，再输入已有 Basic | 未认证401；认证后进入应用登录 | 认证可绕过或凭据泄漏则停止 |
| 2 | 用已有应用密码登录，查看 Cookie 属性 | 200；Secure、HttpOnly、SameSite=Lax、Path=/ | 403核协议/Origin；429按Retry-After等待，不靠重启绕过 |
| 3 | 读取迁移前测试文档、搜索；在独立验收路径写读一个 Markdown | 原字节/搜索保留，新写读一致 | 不把新写入自动反向覆盖旧 r4 |
| 4 | 同窗口核 WSS；受控测试工具发送跨主机、跨协议 Origin 的写请求和 WS | 合法101/hello，非法403 | 不删改 Origin，不放松校验 |
| 5 | 无应用会话访问 API；只读 X-API-Key 读/写测试 | 无会话401；read key读200、写403 | 不启用公开编辑绕过 |
| 6 | 应用退出后再访问 API/WS | Cookie 删除，旧会话401 | 保留证据，按失败回滚序列处理 |
| 7 | status 与安全设置复核 | 限制无漂移；公开编辑/真实Wiki/远端集成关闭 | 一项不符即停止，不推广为业务验收 |

集中反馈：`候选/归档SHA256；1–7各PASS或失败状态；失败路径/状态码/脱敏日志；r4与r3当前running状态；是否需要回滚`。不发送密码、Cookie、Authorization、setup token或快照内容。

Caddy 现有配置本轮未核验。如果现场缺少头清洗或 WS gate，须另行授权后准备明确差异、验证配置并保留旧配置回滚副本。本包不自动安装或修改 Caddy；不得将删除 Basic Auth 作为回退。最终本地验证见 `VALIDATION-r3.md`，服务器上线仍为 **CONDITIONAL**。
