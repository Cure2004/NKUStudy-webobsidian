# 4A 依赖处置

日期：2026-10-22。未使用 npm audit fix --force。冻结基线的完整版本差异见 [dependency-version-diff.json](dependency-version-diff.json)，最终锁文件哈希在 remediation-summary.md。

## 实际变化

| 包 | 基线 → 候选 | 兼容性与验证 |
|---|---|---|
| js-yaml | 3.14.2, 4.2.0 → 4.3.2 | gray-matter完全移除，直接使用4系数据schema；marker/正常YAML/API/索引/SSR回归。 |
| multer | 2.1.1 → 2.4.0 | 同主版本更新；磁盘存储/大小并发/中断清理真实multipart回归。 |
| simple-git | 3.36.0 → 4.0.2 | 3→4大版本；环境变量采用显式白名单，不启用unsafe；真实本地Git/index/tree/bare/分支/unknown回归。 |
| proxy-addr | 2.0.7 → 2.0.8 | 补丁升级；代理信任默认false，明确白名单下分桶测试。 |
| qs | 6.15.2 → 6.16.1 | 定向override，Express真实JSON/query路由及负向路径回归。 |
| body-parser | 1.20.5 → 1.20.8 | 兼容1系更新；应用实际JSON限制2MiB。 |
| @xmldom/xmldom | 0.8.13, 0.9.10 → 0.8.15, 0.9.12 | Pixi链0.8补丁；desktop/plist的0.9链独立计数；构建与Desktop类型检查，不声称完整Canvas浏览器验收。 |
| mermaid | 11.15.0 → 11.17.2 | 保持11系；前端构建通过；浏览器图表/数学组合待4B。 |
| dompurify | 3.4.9 → 3.4.17 | 3系补丁override；不以安装成功代替浏览器XSS测试。 |
| katex | 0.16.47, 0.17.0 → 0.19.0 | 0.x跨次版本到0.19，连Mermaid嵌套副本一起override；正常公式与不可信URL渲染API测试、构建通过；真实DOM集成待4B。 |
| pixi.js | 8.19.0 → 8.22.0 | 同主版本minor，父依赖重解析带入；完整Canvas交互待4B。 |

gray-matter及其旧JavaScript engine链不再是生产依赖。js-yaml的明确数据schema而非单纯升级，是关闭S01的关键。

锁文件定向重解析、npm dedupe后共 57 个包名的版本集合发生变化（含开发/desktop和间接依赖，不是仅11个直接包）；完整差异已保留。曾检测到旧lock的override未落实，采用独立解析目录复用原锁并刷新相关子树后，执行干净npm ci及npm ls；不把中间安装成功当最终结果。

## 当前公告快照与实际可达性

| 扫描 | 退出码 | 结果 |
|---|---|---|
| npm audit --omit=dev --workspace server --json | 1 | 2个high包条目：chokidar与braces，同一条GHSA根因 |
| npm audit --omit=dev --workspace web --json | 0 | 0个报告条目 |

最终原件：[server-audit-release.json](server-audit-release.json)、[web-audit-release.json](web-audit-release.json)。退出码1是仍有公告，不是把扫描失败改成通过；没有宣称依赖全绿。

剩余 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 针对深层glob模式导致栈耗尽。当前watcher只监听owner配置的一个根，ignored为函数，并显式 disableGlobbing:true。已通过真实服务在含花括号的字面目录启动并接收文件事件的测试；没有运行资源耗尽攻击。包仍受公告影响，后续Chokidar6迁移及原生/polling回归单列，不把不可达性判断当上游已修复。

其他原公告命中项的候选版本已不再出现在当前server/web生产扫描中。真实可利用性仍以应用输入链和回归为准：旧simple-git公告不等于曾用guest执行系统命令，KaTeX公告的前置原型污染链也未被假造为已利用。

开发工具/Electron依赖未做全面安全清零，未触发发布工作流。未核验容器OS包公告及AMD64实际安装，这属于4B范围。

## 可重复检查

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ls --omit=dev --all
npm audit --omit=dev --workspace server --json
npm audit --omit=dev --workspace web --json
npm run test:security
npm run typecheck
npm run build
```

安装禁生命周期脚本是本地验证条件；4B必须检查最终镜像安装路径和原生依赖，不能从这份结果推断所有架构或安装脚本都已验收。所有命令的独立退出码和最终日志链接见 regression-results.md。
