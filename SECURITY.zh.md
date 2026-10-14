# 安全策略

## 报告漏洞

**请不要为安全漏洞发起公开的 GitHub issue。**

请改为私下报告：

- 使用 **GitHub Security Advisories**（在 Security 标签页中的"Report a vulnerability"），或
- 发送电子邮件给维护者：**xnohat@gmail.com**

请包含：

- 对问题及其影响的描述。
- 复现步骤（如果可能，附上概念验证）。
- 受影响的版本 / 提交。

你将在几天内收到初步确认。我们将与你共同修复，
并在补丁可用后协调披露。

## 范围与加固说明

WebObsidian 是**自托管且单用户的**。运维人员负责安全地部署它。
要点：

- 首次登录后请立即**更改默认密码（`123456`）**。
- 主密码使用 scrypt 哈希；JWT 密钥自动生成。
- API 密钥在存储时经过哈希处理，并带有作用域（`read` / `write` / `search`），且每个密钥都有速率
  限制。
- 文件路径受到遍历防护；仓库（Vault）选择器被限制在 `ALLOWED_ROOTS` 内。
- 密钥（git token、API key）位于服务器上的 `data/settings.json` 中——请将 `/data`
  作为私有卷挂载，并将其排除在版本控制之外。
- 对于任何面向互联网的部署，请运行在终止 TLS 的反向代理之后（设置
  `HTTP_BIND=127.0.0.1`）。`TRUST_PROXY` 默认为 `true`，因此在该代理之后
  `X-Forwarded-Proto` 会被遵循（Secure cookie 可正常工作）；如果你愿意，
  可以将其收紧为一个子网列表，或者对于直接暴露给客户端、没有代理的实例，
  设置 `TRUST_PROXY=false`。无论哪种方式，登录速率限制都以真实的 TCP socket
  地址为键，因此无法通过轮换 `X-Forwarded-For` 来绕过。

## 支持的版本

本项目尚处于 1.0 之前；安全修复会应用到最新的 `main`。请运行
最近的构建。
