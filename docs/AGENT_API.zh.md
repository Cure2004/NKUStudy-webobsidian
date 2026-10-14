# WebObsidian Agent API (`/api/v1`)

供 AI 智能体与仓库（Vault）交互的 REST API。通过 **Settings → API Keys** 中创建的
**API 密钥**进行身份验证。将其作为以下任一请求头传入：

```
Authorization: Bearer wok_xxx
X-API-Key: wok_xxx
```

权限范围（scope）：`read`、`write`、`search`。速率限制：可配置（默认 120 次请求/分钟/密钥）。
所有 `{path}` 值均为仓库相对路径（对斜杠进行 URL 编码也可以，例如 `Notes/Ideas.md`）。

## 接口

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/api/v1/health` | – | Liveness check |
| GET | `/api/v1/notes?offset=&limit=` | read | List markdown notes (paginated) |
| GET | `/api/v1/notes/{path}` | read | Read a note + parsed metadata |
| PUT | `/api/v1/notes/{path}` | write | Create/overwrite a note (`{ "content": "..." }`) |
| PATCH | `/api/v1/notes/{path}` | write | Append (`{ "append": "..." }`) |
| DELETE | `/api/v1/notes/{path}` | write | Move note to trash |
| GET | `/api/v1/search?q=&limit=` | search | QMD search |
| GET | `/api/v1/backlinks?path=` | read | Notes linking to a path |
| GET | `/api/v1/tags` | read | All tags with counts |

## 示例

```bash
KEY=wok_your_key_here
BASE=http://localhost:8787/api/v1

# 列出笔记
curl -H "X-API-Key: $KEY" "$BASE/notes?limit=10"

# 读取笔记
curl -H "X-API-Key: $KEY" "$BASE/notes/Welcome.md"

# 创建 / 更新笔记
curl -X PUT -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"content":"# From the agent\n\nHello vault."}' \
  "$BASE/notes/Agent/Generated.md"

# 追加
curl -X PATCH -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"append":"\n- a new bullet"}' "$BASE/notes/Agent/Generated.md"

# 搜索（支持字段查询：tag:、path:、title:）
curl -H "X-API-Key: $KEY" "$BASE/search?q=tag:idea%20graph&limit=5"

# 反向链接
curl -H "X-API-Key: $KEY" "$BASE/backlinks?path=Welcome.md"
```

## 响应结构

```jsonc
// GET /notes/{path}
{
  "path": "Welcome.md",
  "content": "...",
  "title": "Welcome to WebObsidian",
  "frontmatter": { "tags": ["welcome"] },
  "tags": ["welcome", "getting-started"],
  "links": ["Notes/Ideas"]
}

// GET /search
{ "query": "graph", "hits": [
  { "path": "Notes/Ideas.md", "title": "Ideas", "score": 4.2, "tags": ["idea"], "snippet": "..." }
] }
```
