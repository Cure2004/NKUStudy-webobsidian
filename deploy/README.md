# NKUStudy 部署源码与冻结 r3 包

当前开发入口见 [开发交接](../docs/nkustudy/DEVELOPMENT.md)。

`r3/` 保存 2026-10-23 验证通过的部署包文本，逐字节保留；唯一省略的是镜像 TAR。目录中的 `SHA256SUMS`、`source-manifest.json` 和 `deployment-release.json` 是原发行身份，不是当前 Git HEAD 的新构建声明。不要向该目录添加文件或静默更新清单。后续部署修改应建立新版本、重新验证和封包。

历史文档及 `server_status` 的“未部署”描述 2026-10-23 的验证时点。用户在 2026-10-24 确认当前服务器使用 r2 AMD64 应用镜像与 r3 HTTPS 配置；本次仅整理 Git，没有连接服务器重新核验。公网预览运行已部署镜像，不会自动拉取 GitHub 提交，合并 PR 不会自动部署。

## 复原完整包并只读校验

在仓库外建立一个新的空目录，将 `deploy/r3/` 的全部文本复制进去，再从受控发行存储复制 `release.json` 指定的镜像 TAR。不要从不明来源取得镜像，不把 TAR 提交到 Git。

```sh
# R3_PACKAGE 指向仓库外完整包目录（含正确的镜像 TAR）
bash "$R3_PACKAGE/offline.sh" verify "$R3_PACKAGE"
```

`verify` 核验完整文件集合、SHA、部署绑定及镜像归档，不加载镜像、不启动容器。缺少 TAR 时失败是预期行为，不能删掉检查绕过。`load/init/start/resume/stop/restore` 是另行授权的部署/数据操作，本轮未运行。实际迁移前阅读包内 README、迁移文档，使用独立实例和卷，保留旧现场与回滚材料；不把历史示例路径直接用于真实服务器。

## HTTPS 与资源约束

拓扑：Caddy HTTPS → 主机回环 → 固定 TCP relay → 隔离 app。Caddy 模板要求清洗转发头、剥离外层 Basic 凭据并校验 WebSocket Origin；app 为 `TRUST_PROXY=1`。不能脱离受控代理拓扑直接暴露 app。

- app：512 MiB、0.50 CPU、96 PID；relay：128 MiB、0.10 CPU、32 PID。
- swap 为 0，UID 1000，只读根文件系统，cap-drop、no-new-privileges 和隔离网络。
- `/vault` 和 `/data` 是独立持久化命名卷；凭据、`settings.json`、`setup.env`、快照均留在受控运行环境。

`scripts/4b/offline/` 保留 r2 工具供审查/历史复现；r3 的完整部署入口是上述 `R3_PACKAGE/offline.sh`，两者不可混用。`scripts/4b/start-local-fixture.py` 等旧验收工具带历史路径，不是通用部署命令。`prepare-context.py` 固定旧代码基线，仅供历史复现，不会打包未来 feature 修改。
