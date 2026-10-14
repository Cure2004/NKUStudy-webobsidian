import { createSign } from 'node:crypto';
import { getSettings } from './settings.js';

/**
 * GitHub App 鉴权（PRD 扩展）。
 *
 * 相比 Personal Access Token（PAT），GitHub App 使用「私钥签 JWT → 换取
 * installation token（1 小时过期）」的方式，权限更细、令牌自动轮换、泄露风险更低。
 *
 * 配置来自 settings.github：appId / privateKey(PEM) / installationId。
 * 生成的 installation token 会缓存到过期前 1 分钟，避免每次请求都换取。
 */

export interface GithubAppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
  owner: string;
  repo: string;
}

/** 读取并校验 GitHub App 配置；未配置时返回 null。 */
export async function getGithubAppConfig(): Promise<GithubAppConfig | null> {
  const s = await getSettings();
  const g = s.github;
  if (!g.appId || !g.privateKey || !g.installationId) return null;
  return {
    appId: g.appId,
    privateKey: g.privateKey,
    installationId: g.installationId,
    owner: g.owner,
    repo: g.repo,
  };
}

export async function isGithubAppConfigured(): Promise<boolean> {
  return (await getGithubAppConfig()) !== null;
}

/** base64url 编码（JWT 要求，无填充）。 */
function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 用 App 私钥签发一个短期 JWT（RS256，最长 10 分钟，这里取 9 分钟）。 */
export function signAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${data}.${b64url(signature)}`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
  key: string;
}

let cachedToken: CachedToken | null = null;

/** 换取（并缓存）installation access token。 */
export async function getInstallationToken(): Promise<string> {
  const cfg = await getGithubAppConfig();
  if (!cfg) throw new Error('GitHub App 尚未配置（缺少 App ID / 私钥 / Installation ID）');

  const cacheKey = `${cfg.appId}:${cfg.installationId}`;
  if (cachedToken && cachedToken.key === cacheKey && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const jwt = signAppJwt(cfg.appId, cfg.privateKey);
  const res = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(cfg.installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'QUTWiKi-Editor',
      },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub App 令牌换取失败：${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { token: string; expires_at: string };
  cachedToken = {
    token: json.token,
    expiresAt: new Date(json.expires_at).getTime(),
    key: cacheKey,
  };
  return cachedToken.token;
}

/** 清空令牌缓存（修改 App 配置后调用）。 */
export function clearInstallationTokenCache(): void {
  cachedToken = null;
}

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/** 解析 https://github.com/owner/repo(.git) → { owner, repo }。 */
export function parseGithubRemote(remote: string): GithubRepoRef | null {
  const m = remote
    .trim()
    .replace(/\.git$/i, '')
    .match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

interface PullRequestResult {
  number: number;
  html_url: string;
  created: boolean;
}

/**
 * 创建（或复用已存在的）Pull Request：head → base。
 * 已存在同一 head→base 的开放 PR 时直接返回它，避免重复创建。
 */
export async function createOrGetPullRequest(opts: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}): Promise<PullRequestResult> {
  const token = await getInstallationToken();
  const api = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'QUTWiKi-Editor',
    'Content-Type': 'application/json',
  };

  // 先查是否已有同 head 的开放 PR。
  const q = `?state=open&head=${encodeURIComponent(`${opts.owner}:${opts.head}`)}&base=${encodeURIComponent(opts.base)}`;
  const existing = await fetch(api + q, { headers });
  if (existing.ok) {
    const list = (await existing.json()) as Array<{ number: number; html_url: string }>;
    if (Array.isArray(list) && list.length > 0) {
      return { number: list[0].number, html_url: list[0].html_url, created: false };
    }
  }

  const res = await fetch(api, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: opts.title, body: opts.body, head: opts.head, base: opts.base }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`创建 PR 失败：${res.status} ${text.slice(0, 300)}`);
  }
  const pr = (await res.json()) as { number: number; html_url: string };
  return { number: pr.number, html_url: pr.html_url, created: true };
}

/**
 * 查询某个 head 分支是否已有开放的 Pull Request（不限 base）。
 * 用于「编辑分支有未合并 PR 时暂停跟进主分支」的判断。
 * GitHub App 未配置时返回 null，调用方据此决定是否跳过检查。
 */
export async function findOpenPullRequest(opts: {
  owner: string;
  repo: string;
  head: string;
}): Promise<{ number: number; html_url: string; base: string } | null> {
  if (!(await isGithubAppConfigured())) return null;
  const token = await getInstallationToken();
  const api = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls`;
  const q = `?state=open&head=${encodeURIComponent(`${opts.owner}:${opts.head}`)}`;
  const res = await fetch(api + q, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'QUTWiKi-Editor',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`查询 PR 失败：${res.status} ${body.slice(0, 300)}`);
  }
  const list = (await res.json()) as Array<{ number: number; html_url: string; base?: { ref?: string } }>;
  if (!Array.isArray(list) || list.length === 0) return null;
  return { number: list[0].number, html_url: list[0].html_url, base: list[0].base?.ref ?? '' };
}

/**
 * 触发一个 GitHub Actions 工作流（workflow_dispatch）。
 * 用于在「Actions 空窗期」由编辑器主动触发 web-edit 跟进主分支的同步工作流。
 * 需要 GitHub App 具备 **Actions: Read and write** 权限；未授予时会抛错，
 * 调用方应回退到本地合并。
 */
export async function dispatchWorkflow(opts: {
  owner: string;
  repo: string;
  workflow: string;
  ref: string;
}): Promise<void> {
  const token = await getInstallationToken();
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/actions/workflows/${encodeURIComponent(opts.workflow)}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'QUTWiKi-Editor',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: opts.ref }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`触发同步工作流失败：${res.status} ${body.slice(0, 300)}`);
  }
}

/** 用 installation token 拼出带鉴权的 https 远程地址。 */
export async function authedRemoteWithApp(remote: string): Promise<string | null> {
  if (!(await isGithubAppConfigured())) return null;
  const token = await getInstallationToken();
  const without = remote.replace(/^https:\/\//, '');
  if (without.includes('@')) return remote; // 已含凭据
  return `https://x-access-token:${token}@${without}`;
}
