# NKUStudy WebObsidian r3 HTTPS 部署兼容包

日期：2026-10-23（Asia/Shanghai）。部署版本 `r3-https-20261023`；镜像版本仍为已验收的 r2。本包不自动连接或部署任何服务器。

## 根因与最小变更

Caddy 终止 TLS 后，通过宿主回环入口和固定 TCP relay 将 HTTP 交给应用。relay 原样转发字节。r2 `deploy.py` 固定 `TRUST_PROXY=false`，Express 因而将 `req.protocol` 判为 `http`；合法浏览器的 `Origin: https://wiki-preview.nkustudy.top` 与它不符，`sameOriginWrites` 在登录认证之前返回 403 `Cross-origin write rejected`。

核心修复仅为部署环境 `TRUST_PROXY=1`。应用、认证、Origin 校验、Cookie 代码、relay、Dockerfile、entrypoint、source-manifest 和 AMD64 镜像均未修改。登录 Cookie 继续通过 `req.secure` 自动设置 Secure。

数值 1 信任一个 TCP 对端，不是代理身份验证。本应用实际看到的对端是 relay；它不会给 HTTP XFF 增加一跳。设置 2 或全局 true 没有必要。r3 只适用于下述固定受控拓扑：

```
浏览器 --HTTPS+Basic Auth--> Caddy
        --规范化头部、去除外层凭据--> 127.0.0.1:28787
        --固定 TCP relay--> 专属 internal 网络上的 app:8787
```

只有可信宿主进程和 Caddy 可达回环 relay，Docker daemon 和能加入这两个网络的主体也必须可信。应用无宿主端口。回环本身不能阻止同宿主低信任进程伪造头部；若这项前提不成立，**停止上线**，改用经过认证的入口（例如受控 Unix socket/权限或 mTLS/专用代理）并另做设计与验证，不能通过放开 Origin 修复。

## Caddy 条件

`Caddyfile.preview.example` 是本地审查模板，不能直接覆盖现有生产配置。本轮没有读写服务器 Caddy。后续执行前须核定既有配置满足以下条件，否则仅改应用环境不足以安全上线：

1. 精确站点 `wiki-preview.nkustudy.top`，TLS 和外层 Basic Auth 有效；所有应用路径包括 `/ws` 均经过认证。
2. 同一 `route` 内先 Basic Auth，再来源 gate，再反代。上游固定为 `127.0.0.1:28787`。
3. 覆盖 X-Forwarded-Proto 为 `{scheme}`、X-Forwarded-Host 为 `{hostport}`、X-Forwarded-For 为 `{remote_host}`，清除 `Forwarded`、`Authorization`、`Proxy-Authorization`。不得让客户端提供的转发值决定应用协议。
4. 保留 Host 和原始 Origin。**不能删除、伪造或重写 Origin，也不能关闭 CSRF。**
5. 原 r2 WebSocket 只比较 Origin 的主机/端口，未比较协议。模板额外拒绝 `/ws` 上所有非空且不等于 `https://wiki-preview.nkustudy.top` 的 Origin，关闭这一入口上的协议差异。没有 Origin 的非浏览器连接仍需外层 Basic 和有效应用会话，延续原策略。

Basic 使用 Authorization，因此该入口下应用会话用 Cookie，Agent API 用已有的 `X-API-Key`；不要期望同时在同一 Authorization 头里承载应用 Bearer。API key 权限规则保持不变。

所有通过 relay 的登录尝试继续共享应用按 TCP peer 计算的 10 次/15 分钟额度。`TRUST_PROXY=1` 不会让限流器盲信客户端 XFF；遇 429 应按 Retry-After 等待，不要在服务器上用重启绕过限流。

## r3 包完整性与运行约束

- 原 `release.json` 描述镜像，保持字节不变。新增 `deployment-release.json` 描述 r3 部署文件，避免破坏镜像里的源码清单 label。
- `SHA256SUMS` 覆盖整个发行目录。`verify-package.py` 拒绝缺失、额外、重复、软链接、哈希漂移和不完整的部署绑定。它是完整性校验，不能替代从可信渠道核对发行归档 SHA256。
- `offline.sh` 的 verify/load/init/start/resume 会先验证完整部署包及 wrapper/package 一致性。程序禁止写入 `__pycache__`；手工调用 Python 时也设置 `PYTHONDONTWRITEBYTECODE=1`。
- start/resume/status 只提取 `NODE_ENV`、`TRUST_PROXY`、`COOKIE_SECURE` 三项非秘密环境，要求 production、1、auto/未设置。不会把 setup token 或完整环境写入回执。stop 保留原身份/挂载检查，可在配置漂移时停止自有实例。
- app：512 MiB、0.50 CPU、96 PID、无额外 swap；relay：128 MiB、0.10 CPU、32 PID、无额外 swap。两者 UID/GID 1000、只读根、drop ALL、no-new-privileges、专属网络保持不变。实际 cgroup v2 四项限制由 start/resume/status 验证。

镜像 tar 名称仍为 `nkustudy-webobsidian-4b-1bd3f6c-r2-linux-amd64.tar`，80,442,368 bytes，SHA256：

```
c2a1839b9037784695a6e8ecfeba036a4f5ae4c3cd98ce561c09b9e5617d3beb
```

无需构建、重导出或重标记镜像。已有相同且绑定通过的镜像直接复用；不要覆盖不同镜像或 tag。

## 交付状态

本地验收与服务器验收分开记录。`VALIDATION-r3.md` 记录本次实际测试、失败尝试及证据边界。`MIGRATION-r4-to-r3.md` 给出从停止的 r4 快照到新 r3 代际的步骤和回滚分支。旧 `deployment-package.md`、`server-readiness.md` 作为原 r2 历史材料保留，r3 的代理配置和切换流程以这三份 r3 文档为准。

服务器执行、Caddy 变更、公网浏览器验收及业务接受均未完成。本轮完成本地修复、验证和打包即停止。

## 依据

本地依据为冻结 r2 对应源码、Express 实际依赖和真实镜像测试；官方说明用于复核代理语义：[Express behind proxies](https://expressjs.com/en/guide/behind-proxies/)、[Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[Caddy basic_auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth)。
