# NKUStudy WebObsidian 部署准备审计与候选方案

审计日期：2026-10-22（Asia/Shanghai）。程序仓库基线：`e2201591c02ecb96e4d42d6adbd0644f1a15b40a`，本地分支 `nkustudy-dev`。

**本文件是方案，不是部署回执。** 本轮未构建/运行 Docker 镜像，未修改 Docker Desktop、服务器、Caddy 或现有服务，也未使用真实 Wiki、Token 或 GitHub App 私钥。全部示例命令留待后续明确授权和前置验收通过后执行。现有官方原版部署经验没有提供可复核配置、镜像 digest 或资源记录，不能据此声称 QUT 分支已经兼容。

## 1. 已确认的运行与构建事实

| 证据位置（基线文件行号） | 实际行为 | 部署含义 |
|---|---|---|
| `package.json:7-22`；`web/vite.config.ts:5-10`；`server/tsconfig.json:11-12` | 根 workspace 包含 server/web/desktop；`build` 先 Vite 前端再 tsc 后端；前端写入 `server/public`，后端写入 `server/dist` | 浏览器 UI 与 Express 合并成一个 Node 服务；Web 部署不需要 Electron |
| `Dockerfile:7-19,22-41` | 两阶段均为浮动 `node:22-alpine`；构建 `npm install`，运行依赖 `npm install --omit=dev --workspace server` | 锁文件存在但安装不 fail-closed；不能声称相同提交必然得到相同依赖/镜像 |
| `Dockerfile:3-4,12-13,29-37`；`package-lock.json` | APK/NPM 默认镜像源可覆盖；锁文件 v3，当前解析的 tarball host 为 `registry.npmjs.org` | 改 registry 配置不等于全部锁定 URL 改走镜像；包完整性由 lock integrity 校验，镜像源选择须记录 |
| `Dockerfile:7,22` | 没有 `--platform=$BUILDPLATFORM` 构建阶段 | Mac 上直接 `buildx --platform linux/amd64` 可能在仿真环境执行 Vite/esbuild；本轮没有复现 QEMU 崩溃，风险标为待构建验证 |
| `Dockerfile:31,48,50-56` | 安装 git/git-lfs；V8 old space 上限 4096 MiB；持久化 /vault、/data；无 `USER` | 镜像默认 root；4 GiB heap 不适合作为 1.6 GiB 共存服务器预算；该值不是启动立即占用量，也不限制 Buffer 或 Git 子进程 |
| `docker-compose.yml:3-10,28-40` | 默认本机构建、`latest`、固定容器名 `webobsidian`、默认 `0.0.0.0:8787`、sample-vault bind mount 和命名 data volume | 直接执行会有端口/容器名冲突和外部暴露风险，不能用于本项目隔离部署 |
| `docker-compose.yml:31-37`；`server/src/index.ts:48-51,113-114,144-157` | 健康探针请求固定 8787 `/healthz`；首次设置、vault、索引、watcher 初始化后才 listen；Compose 宽限 90 秒 | 启动慢时探针可失败；端口改动需同步探针；健康结果只证明 HTTP 活着，不证明可写、Git/PR或索引正确 |
| `server/src/config.ts:57-69`；`server/src/services/settings.ts:149-156,196-225` | 环境提供首次默认 vault/data/root；已有 settings 优先；任意读取/解析失败会 fallback 默认并持久化 | 更换环境变量不能保证已有 vault 配置迁移；坏 settings 不应当作新安装，必须修复为受控失败后再上线 |
| `server/src/index.ts:154-155`；`services/autosync.ts:8-25`；`services/basefollow.ts:14-31` | 启动自动调度器，每 30 秒重新读 settings；是否网络同步由 git.enabled/autoSync/autoFollowBase/remote 决定 | 复用旧 Data 可能自动连接旧远端；测试必须新建 Data，并明确关闭全部同步 |

`ALLOWED_ROOTS` 主要服务文件夹浏览；它不是容器沙箱，也不是 guest 可写目录。`getVaultRoot()` 返回仓库根，`getContentRoot()` 拼接 `vault.root`（`services/vault.ts:52-66`），Git 使用前者（`services/git.ts:34-39`）。程序源码仓库不能作为 `/vault`，程序的 `nkustudy-dev` 分支与未来 Wiki 的 base/edit 分支没有继承关系。

## 2. 部署阻断与优先级

| ID / 级别 | 条件与影响 | 建议 / 验证 |
|---|---|---|
| DEP-01 / P1 | 公网使用当前默认监听、默认认证或公开编辑风险未关闭，可能扩大攻击面；详见 security-audit.md | 安全 P0/P1 关闭前只准无真实内容、无外连的本机夹具；正式部署门禁须检查默认认证和 guest/Git 边界 |
| DEP-02 / P1 | 512 MiB 内存上传（`routes/files.ts:21`）叠加索引、Buffer、并发和 Git，原 Compose 无 memory limit；可能拖累同机其他服务 | 降低上传限额、受限流式临时文件、总并发/总字节限制；初步容器上限 640 MiB，压力测量后调整；不能用缩小 V8 heap 替代上传治理 |
| DEP-03 / P2 | 两阶段目标架构相同导致跨架构构建仿真；浮动 Node/APK/npm install 使重建漂移 | build 原生架构、runtime 目标架构；严格 npm ci、固定基础镜像 digest、记录 APK 版本和产物清单；AMD64原生启动验证 |
| DEP-04 / P2 | `.dockerignore:1-16` 没排除 `.env`、`.env.*`、Secrets、PEM，`Dockerfile:18 COPY . .` 把它们纳入 builder 上下文/层 | 即使最终 runtime 未复制这些源文件，远程构建器/缓存也可能接触；后续加入 deny patterns，构建上下文仅来自干净程序源码，不放秘密 |
| DEP-05 / P2 | root 运行、无资源/日志上限、固定全局容器名 | 独立 Compose project，无 container_name，非 root、最小挂载、cap_drop、no-new-privileges、只读 rootfs、日志轮转；验证 Git/LFS/temp 所需写路径 |
| DEP-06 / P2 | settings 出错静默重置（`services/settings.ts:221-224`），探针不能发现配置/内容语义错误 | 上线前改成明确失败且保留原文件；独立 readiness检查与备份恢复演练；不能仅用 health=healthy 验收 |
| DEP-07 / P2 | CI 不覆盖 `feat/qut-fork` / `nkustudy-dev`，失败后 npm install fallback；暂无自动权限回归 | 第4步修改触发分支/PR目标，严格ci，补关键权限/Git回归和镜像启动检查 |

总审计已在隔离夹具确认 P0：不可信 Markdown 经服务端解析触发 JavaScript 执行（见 security-audit.md S01）。部署子审计没有独立重跑该夹具，直接复用已有证据。P0/P1 未解决前仅允许无秘密、无真实内容、无外连的本地隔离工作，不进入联网或共享服务器测试。上述部署条目是工程优先级，资源不足和构建漂移不自动等同已复现漏洞。

## 3. Mac 构建 Linux AMD64 的建议

以下为**后续 Dockerfile 修改草案**，本轮不落地业务/配置变更。关键点：在 Docker Desktop 的 Linux ARM64 build 平台运行 Vite/esbuild；只复制生成的 JS/CSS/静态文件到 AMD64 runtime，在目标平台重新安装 server 依赖，绝不能复制 ARM64 `node_modules`。

```dockerfile
# syntax=docker/dockerfile:1
# NODE_IMAGE 由构建记录填入已核验的多架构 manifest digest。
ARG NODE_IMAGE
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
COPY desktop/package.json ./desktop/package.json
# 留存全部 workspace manifest 以便与根锁文件保持一致；不安装 Electron。
RUN npm ci --workspace server --workspace web --include-workspace-root --no-audit --no-fund
COPY server ./server
COPY web ./web
RUN npm run build

FROM --platform=$TARGETPLATFORM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp
RUN apk add --no-cache git git-lfs && git lfs install --system
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
COPY desktop/package.json ./desktop/package.json
RUN npm ci --omit=dev --workspace server --include-workspace-root --no-audit --no-fund
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
ENV PORT=8787 HOST=0.0.0.0 DATA_DIR=/data VAULT_PATH=/vault ALLOWED_ROOTS=/vault
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "server/dist/index.js"]
```

此草案需要验证：workspace 精简安装与 npm 版本匹配、Alpine musl 所需 optional 包、非 root bind mount UID/GID、Git/LFS config和临时文件位置。当前 lock 的安装脚本主要见 esbuild、Electron、fsevents；不能因此承诺未来 server 永远没有 native dependency。目标阶段的 npm/apk仍可能使用 QEMU；此方案专门避免在 QEMU 运行前端 esbuild，并非消除所有仿真。若目标依赖安装仍不稳定，改用独立 AMD64 CI runner 构建，不在小内存生产机编译。

可复现要求：固定 Node/Alpine manifest digest及 Node/npm版本，依赖锁文件强制存在、失配即失败，不再 `npm ci || npm install`；记录源 SHA、lock SHA256、基础 digest、buildx/BuildKit版本、构建参数、SBOM、APK package版本和最终镜像 digest。`apk add` 依赖滚动仓库仍会漂移，严格重建还需可重复取回的版本/仓库快照。构建可复核不等于承诺逐字节镜像相同。

未来操作样例（`NODE_IMAGE`、`CANDIDATE` 等须先从审核记录取得；当前不得执行）：

```sh
# 在专用干净程序 checkout 中；构建上下文不含任何 Vault/Data/Secrets。
docker buildx build --platform linux/amd64 \
  --build-arg NODE_IMAGE="$NODE_IMAGE" \
  --tag "nkustudy-webobsidian:$CANDIDATE" --load .
docker image inspect "nkustudy-webobsidian:$CANDIDATE" \
  --format '{{.Id}} {{.Os}}/{{.Architecture}}'
docker save -o "nkustudy-webobsidian-$CANDIDATE.tar" "nkustudy-webobsidian:$CANDIDATE"
shasum -a 256 "nkustudy-webobsidian-$CANDIDATE.tar"
```

离线 tar 方案记录 tar SHA256 + Docker image ID；本地 `--load` 镜像不保证有 RepoDigest。未来若使用镜像仓库，则保存 registry manifest digest并使用 `repo@sha256:...` 部署；本轮不推送。镜像架构声明不是 AMD64 原生启动回执，仍须隔离目标机验收。

## 4. Vault / Data / Secrets 的边界

建议后续独立根目录 `/srv/nkustudy-webobsidian-test/`（这是计划路径，当前未创建）：

```text
releases/<candidate>/     compose + 无秘密的发布记录 + 镜像信息
state/<generation>/vault/  独立测试 Wiki 内容与 .git，不能是程序仓库
state/<generation>/data/   settings/index/shares/uistate 及 .bak
state/<generation>/secrets/ 独立只读 secret 文件，待代码支持
backups/<timestamp>/       受限权限、加密的状态备份与校验清单
```

| 类别 | 当前实际消费路径 | 方案与限制 |
|---|---|---|
| Vault | `config.defaultVaultPath → settings.vault.path → getVaultRoot/getContentRoot`；`services/vault.ts:52-66` | 新建脱敏夹具；与现有官方容器和任何内容工作树完全分离，挂载 `/vault`；禁止两个进程共享可写 `.git` |
| Data | `config.ts:68-69`；`settings.ts:183-193`；`search.ts:312-345`；`shares.ts:16,38-42`；`uistate.ts:14,48-53` | `/data/settings.json` 与 `.bak`、搜索缓存、分享链接及UI状态都属于实例，备份时作为一个一致快照；搜索缓存可重建，但配置/分享链接不可丢 |
| Secrets | `settings.ts:23-27,56,73,99`；`githubApp.ts:23-33,47-55` | 目前 JWT secret、Git token、App私钥、图床key与Data混存；接口redact不是磁盘分离。**当前没有 `*_FILE` 或 `/run/secrets` 读取实现**；单纯添加 Compose secrets 不会生效。真正分离需要第4步增加明确读取优先级/权限/轮换/迁移支持，并移除settings及bak中的旧副本 |
| 环境密码 | `config.ts:63`；`bootstrap.ts:10-18` | 是恢复/override，不是“仅首次初始化密码”；不能据 `.env.example` 注释认定默认认证已经消失；后续须完成安全报告要求的认证初始化修复 |

临时无真实凭据测试可保持 Git/App/图床均关闭。未来真实Secrets不得进入Git、镜像、命令行、日志、完整 `docker inspect` / `compose config` 输出；这里只保存秘密字段是否存在、路径/权限与轮换结果。Data及备份也按秘密处理。

## 5. 独立运行草案

候选宿主端口 **28787**，容器内保留8787；部署前查重确认，不占现有8787、18787、8080。容器内部 `HOST=0.0.0.0` 是为了端口转发，宿主发布只能 `127.0.0.1:28787`。容器内也绑定127.0.0.1会使Docker端口转发不可达，不能混淆这两层。

以下是未来文件内容示例，本轮未创建 Compose配置或启动服务。`STATE_ROOT` 指向一个已创建、权限匹配且明确属于本实例的 generation；`NKU_IMAGE` 为已验证不可变候选引用。

```yaml
name: nkustudy-webobsidian-test
services:
  editor:
    image: ${NKU_IMAGE:?set-reviewed-image-reference}
    platform: linux/amd64
    pull_policy: never # 离线导入候选；registry流程另行明确
    init: true
    restart: "no" # 测试失败保留现场，不用重启循环掩盖故障
    user: "1000:1000" # 核对所选镜像node UID/GID后锁定
    ports:
      - "127.0.0.1:28787:8787"
    environment:
      NODE_ENV: production
      PORT: "8787"
      HOST: 0.0.0.0
      DATA_DIR: /data
      VAULT_PATH: /vault
      ALLOWED_ROOTS: /vault
      TRUST_PROXY: "false" # 本地直连/SSH隧道；TLS代理阶段单独审定可信hop
      WEBOBSIDIAN_WATCH: auto
      NODE_OPTIONS: --max-old-space-size=256
      HOME: /tmp
    volumes:
      - type: bind
        source: ${STATE_ROOT:?set-isolated-state-root}/vault
        target: /vault
        bind:
          create_host_path: false
      - type: bind
        source: ${STATE_ROOT:?set-isolated-state-root}/data
        target: /data
        bind:
          create_host_path: false
    read_only: true
    tmpfs:
      - /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    mem_limit: 640m
    mem_reservation: 256m
    memswap_limit: 640m
    cpus: 0.50
    pids_limit: 96
    stop_grace_period: 30s
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
    healthcheck:
      test: [CMD, wget, -qO-, http://127.0.0.1:8787/healthz]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 90s
    networks: [isolated]
networks:
  isolated:
    internal: true # 第一阶段无外连夹具；GitHub联网测试需后续另行授权并改方案
```

独立Secrets挂载未加到可运行片段，原因是当前应用不消费该文件；不能给一个“看似独立、实际无效”的安全配置。配置修改后再把必要secret单文件只读挂到 `/run/secrets/...`，不是把整个宿主凭据目录挂进去。绝不挂 Docker socket、主机根目录、SSH home 或其他服务的目录。

非 root + read-only/tmpfs 是候选约束，需真实 Git/LFS/索引/上传测试验证，不能为通过测试直接改回root。`mem_reservation` 是软提示，不是预留容量；`mem_limit`/`memswap_limit` 必须以运行容器 HostConfig和 cgroup读数确认生效。tmpfs、Buffer、Node native memory、Git子进程和文件页缓存均计入实际资源分析。

## 6. 1.6 GiB共存服务器的容量门禁

640 MiB容器、256 MiB V8只是首轮小型夹具预算，**没有证明能容纳真实Wiki**。服务器总量约1.6GiB时，先量化现有四类服务峰值、系统和页缓存余量；如果既有峰值加新实例预算和安全余量超过可用总量，则暂缓同机试运行或扩容，不能挤压既有服务。部署前最低保留至少约256 MiB系统余量作为初始策略，最终以连续测量结果确定。

资源路径：全文索引持有 MiniSearch 和 snippets/tag/property maps；单文档 `MAX_BODY=100_000` 在 `readFileText/parseNote` **之后**才截断（`search.ts:104-124`），不能阻止读取超大原文造成峰值。启动还构建link graph和file index（`index.ts:144-148`），部分工作在索引缓存恢复后仍执行。watcher遇inotify不足自动改轮询（`index.ts:228-258`），可能提高CPU；不在本轮改宿主sysctl。

至少测：空夹具、计划文件数/文本总量、最大文档、正常上传、拒绝超限上传、2与4个并发操作、搜索/图谱、Git/LFS受控夹具、首次冷启动、缓存启动、持续写入30分钟。记录 peak RSS、cgroup memory.current/peak、OOMKilled、CPU、启动/响应p95和既有服务基线差异。禁止在共享生产机发512MiB压力请求。异常判据：OOM、持续swap/明显主机压力、现有服务延迟显著恶化、索引缺失、进程存活但不能写；任一触发立即仅停本实例并保留现场。

## 7. CI与发布门禁

`ci.yml:4-7`只监听main/web-edit的push和以它们为目标的PR；开发分支nkustudy-dev的push及以其为目标的PR不匹配。`ci.yml:23`的fallback会掩盖lock失配；当前只有typecheck/build/i18n/docker build（`ci.yml:25-35,50-86,94-95`），没有容器启动、权限矩阵、资源与回滚测试。

`release.yml:15-22,39-55`由v* tag或手动触发，contents:write，Node20，严格npm ci后执行Electron发布。`desktop/package.json` publish目标仍是原作者仓库；此工作流不是NKUStudy Web镜像发布渠道。本轮不触发发布，也不改GitHub默认分支。

后续实施：

1. 在新分支补严格npm ci、Node/npm版本一致、相关分支及PR触发；Actions由浮动主版本进一步锁到审核过的SHA，权限最小化。
2. 把guest/路径/上传/Git分支/API认证回归列为必须通过；不拿typecheck代替权限验证。
3. 构建AMD64镜像并验证架构、无秘密/开发产物、非root、健康、启动和持久化；必要时用AMD64原生runner复验。
4. 生成可追溯候选（源码/lock/image/tar哈希与测试结果），环境测试使用该候选；验收中不移动tag或更换镜像。
5. 经独立测试与恢复演练后才拟定生产接入Caddy/域名/外连GitHub方案；本轮未授权实施这些步骤。

## 8. 备份与明确回滚步骤

Git提交不是完整备份：未提交文件、.trash、附件/LFS本地对象、settings/bak、分享链接和UI状态都需覆盖。一次回滚单位为“旧镜像引用 + 旧无密配置 + 同一时点Vault/Data/Secrets”，禁止只回退镜像却让旧代码直接读取已变化的新settings。

未来授权后的操作顺序：

1. 记录当前候选镜像ID/digest、独立Compose project、generation、端口、容器状态和无秘密版本清单；确认只作用于 `nkustudy-webobsidian-test`。
2. 暂停本实例写入口，等待或中止本实例Git队列并确定结果。若远端写入结果未知，先只读查询，不重放、不新建操作来“补齐”。停止本实例容器后再做一致快照；不能边写边tar。
3. 以受限权限备份整个当前generation，记录SHA256，按秘密级别加密保存；解密密钥不能同存。另存旧镜像tar或确保旧digest可取回。备份验证须实际解包到新的隔离目录核查文件/权限，不仅检查压缩命令退出码。
4. 新候选使用从快照复制出的新generation，保存旧generation不动；两个候选绝不同时写同一Vault/Data。启动新候选后通过健康、认证、固定哨兵文件、索引、Git关闭状态和资源验收。
5. 失败则停止新候选，封存其generation和脱敏日志。若期间有用户写入，先列出差异交由总控确认保留策略，不覆盖或丢弃。
6. 选择旧镜像及旧generation，用同一独立Compose配置重建**仅本实例**；健康及哨兵验证通过再恢复其入口。首轮没有旧候选时，回滚就是停止新实例并保留现场，现有其他服务继续原状。

未来命令骨架（需要事先准备配置与变量；本轮不执行）：

备份清单须先核对实际目录。无凭据首轮应预先创建专属空 `secrets` 目录，或将备份命令调整为发布清单中的实际目录；任一 tar、校验或加密步骤失败即停止，不能继续将不完整包当作可恢复备份。

```sh
# 所有变量由本实例发布记录取得；不使用其他服务的Compose文件。
docker compose --project-name nkustudy-webobsidian-test --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" stop editor

# 在容器停止后，备份明确的旧generation。BACKUP_DIR 权限0700。
tar -C "$OLD_STATE_ROOT" -czf "$BACKUP_DIR/state.tar.gz" vault data secrets
shasum -a 256 "$BACKUP_DIR/state.tar.gz" > "$BACKUP_DIR/state.tar.gz.sha256"
# 以上明文临时包按既定加密方案封存，恢复校验后处理临时明文；不输出秘密内容。

# 回滚文件只含旧镜像引用、旧 STATE_ROOT 等非秘密绑定；旧数据未被新候选写入。
docker compose --project-name nkustudy-webobsidian-test --env-file "$ROLLBACK_ENV" -f "$COMPOSE_FILE" up -d --no-build --no-deps editor
curl --fail --silent http://127.0.0.1:28787/healthz
```

若必须从备份恢复，先在新的空generation解包并核验所有权/权限、设置结构、Vault根及未启用自动外连，再指向该目录；不解包覆盖失败现场。禁止 `docker system prune`、`compose down -v`、删除共享卷或清理其他服务。不能通过健康检查自动宣称回滚成功，必须完成哨兵、认证、索引和此前可用功能的复验。

## 9. 进入下一步前的状态

已完成：源码部署/配置/CI链路阅读；生成隔离候选方案和恢复顺序。

待验证：严格workspace安装、ARM原生build与AMD64runtime、镜像实际架构及权限、Compose资源限制、真实Linux启动、内存预算、限额上传、完整备份恢复、Git/PR沙盒、官方原版经验适用性。

禁止直接上线的原因：安全P0/P1尚未修复、当前认证/设置失败恢复问题、512MiB内存上传、Secrets未分离、CI和Docker不具备完整可复现/启动验收证据。可暂缓：Electron发布、公开域名/Caddy接入、真实App创建、正式Wiki绑定、外部图床、轮询性能调优；这些不阻止第4步先做本地安全修复与回归。

## 收尾核收补充：Git 开关与隔离边界

`git.enabled=false` 约束后台自动同步、保存触发同步和自动跟进，但不是所有 Git 操作的总开关。手工 `/api/git/sync` → `syncImpl` 没有同等开关校验（`server/src/routes/git.ts:73-100`、`server/src/services/git.ts:836-888`）。将 `git.remote` 设为空也不会清除已有 `.git/config` 的 origin（`git.ts:562-570`）。首轮隔离依靠全新 Data/Vault、无真实凭据或远端以及禁外连网络；不能仅设布尔开关就认定没有外部写入。
