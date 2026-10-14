# 安装 WebObsidian Agent skill（复制粘贴，无需本地克隆）

你**不**需要克隆此仓库。复制下面方框中的*全部内容*并粘贴到你的编码智能体中
（Claude Code、Codex、OpenCode、Cursor…）。智能体将**下载**该技能
从 GitHub 到其自己的 skills 文件夹，向你索要 WebObsidian URL + API 密钥，
保存它们，然后从此即可远程操作你的仓库（Vault）。

> 每台机器一次性操作。之后只需说“用我的 WebObsidian 仓库（Vault）来……”。
>
> 前提条件：先在你的 WebObsidian 中于 **Settings → API Keys** 处创建一个 API 密钥
> （权限范围 `read` / `write` / `search`；形如 `wok_…`）。

---

```text
SYSTEM / TASK — Install the "webobsidian" agent skill from GitHub, then set up credentials.
Do every step in order; do not skip the credential step.

STEP 1 — Download the skill into your runtime's skills directory:
  - Claude Code: ~/.claude/skills/webobsidian/
  - Codex:       ~/.codex/skills/webobsidian/
  - OpenCode:    ~/.opencode/skills/webobsidian/
  - Otherwise use this runtime's documented skills directory.
  Run (substitute your SKILLS_DIR):
      SKILLS_DIR=~/.claude/skills        # 根据你的运行时修改
      mkdir -p "$SKILLS_DIR/webobsidian"
      curl -fsSL https://raw.githubusercontent.com/xnohat/webobsidian/main/docs/agent-skill/webobsidian/SKILL.md \
        -o "$SKILLS_DIR/webobsidian/SKILL.md"
  Confirm the file exists and starts with the YAML frontmatter "name: webobsidian".

STEP 2 — Set up credentials (ASK ME; never echo the key back):
  Ask me for:
    (a) my WebObsidian base URL  (e.g. https://notes.example.com or http://host:8787)
    (b) my API key               (Settings -> API Keys; looks like wok_...)
  Then save them:
      mkdir -p ~/.webobsidian && chmod 700 ~/.webobsidian
      printf '{ "baseUrl": "%s", "apiKey": "%s" }\n' "<BASE_URL>" "<API_KEY>" > ~/.webobsidian/credentials.json
      chmod 600 ~/.webobsidian/credentials.json

STEP 3 — Verify (do NOT print the API key) and confirm:
      BASE=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.webobsidian/credentials.json")))["baseUrl"].rstrip("/"))')
      KEY=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.webobsidian/credentials.json")))["apiKey"])')
      curl -s "$BASE/api/v1/health"
      curl -s -H "X-API-Key: $KEY" "$BASE/api/v1/tags" | head
  If health is ok and tags load, tell me the skill is installed and ready (say how many tags
  you saw, WITHOUT printing the key). From now on, whenever I ask you to work with my
  WebObsidian / Obsidian vault, load and follow the webobsidian skill.
```

---

## 说明

- 智能体下载的技能文件是规范文件
  [`webobsidian/SKILL.md`](webobsidian/SKILL.md) —— 它包含完整的 Agent API 参考
  以及 Obsidian Flavored Markdown 指南（wikilinks、embeds、callouts、properties、tags、
  tasks、math、mermaid）。
- 凭据存储在 `~/.webobsidian/credentials.json`（chmod 600），位于任何
  仓库**之外**。密钥绝不会被打印、记录或写入笔记。
- 之后如需**更新**该技能，请重新运行 STEP 1 中的 `curl`（它会覆盖 SKILL.md）。
- 在凭据已存在的情况下重新运行引导会跳过 STEP 2。

## 备选方案：技能安装器

如果你的运行时支持 [Agent Skills](https://github.com/obsidianmd/obsidian-skills)
安装器：

```bash
npx skills add https://github.com/xnohat/webobsidian --path docs/agent-skill/webobsidian
```
