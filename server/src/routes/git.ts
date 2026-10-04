import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireOwner, denyGuest } from '../middleware/auth.js';
import * as git from '../services/git.js';
import { COMMIT_PREFIXES, buildCommitMessage, CommitTemplateError } from '../services/commitTemplate.js';
import { isGithubAppConfigured } from '../services/githubApp.js';

export const gitRouter = Router();
// 允许 owner 与（公开编辑开启时的）guest；敏感操作再单独 requireOwner。
gitRouter.use(requireAuth);

// 提交模板：可用的中文前缀列表（访客构建提交信息也需要）。
gitRouter.get('/commit-prefixes', (_req, res) => {
  res.json({ prefixes: COMMIT_PREFIXES });
});

gitRouter.get(
  '/log',
  asyncHandler(async (req, res) => {
    const path = String(req.query.path ?? '').trim();
    if (!path) return res.status(400).json({ error: 'path required' });
    res.json({ commits: await git.log(path) });
  }),
);

gitRouter.get(
  '/show',
  asyncHandler(async (req, res) => {
    const hash = String(req.query.hash ?? '').trim();
    const path = String(req.query.path ?? '').trim();
    if (!hash || !path) return res.status(400).json({ error: 'hash and path required' });
    res.json({ content: await git.showFile(hash, path) });
  }),
);

// 仅本地提交（不推送）。仅 owner：访客必须走 /sync 投稿流程（推 web-edit + 开 PR），
// 不允许把改动留在本地仓库。
gitRouter.post(
  '/commit',
  requireOwner,
  asyncHandler(async (req, res) => {
    const message = resolveMessage(req.body);
    if (message instanceof CommitTemplateError) {
      res.status(400).json({ error: message.message });
      return;
    }
    const out = await git.commitAll(message);
    console.log('[git] commit:', out);
    res.json({ message: out });
  }),
);

// 投稿：提交 + 拉取 + 推送 + 自动开 PR（受 GitHub App 配置约束）。
// owner 推送到配置的编辑分支；访客强制推送到 web-edit（不信任客户端输入）。
gitRouter.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const message = resolveMessage(req.body);
    if (message instanceof CommitTemplateError) {
      res.status(400).json({ error: message.message });
      return;
    }
    const branch = req.sessionRole === 'guest' ? 'web-edit' : undefined;
    console.log('[git] manual sync requested');
    const result = await git.sync(message, branch);
    console.log(`[git] sync ${result.ok ? 'ok' : 'not-ok'}:`, result.log.join(' | '));
    res.json(result);
  }),
);

// ---- 以下为 owner 专属（访客不可用）----

gitRouter.get('/status', requireOwner, asyncHandler(async (_req, res) => res.json(await git.status())));

gitRouter.get(
  '/github-app',
  requireOwner,
  asyncHandler(async (_req, res) => {
    res.json({ configured: await isGithubAppConfigured() });
  }),
);

gitRouter.post(
  '/pull-request',
  requireOwner,
  asyncHandler(async (req, res) => {
    const result = await git.openPullRequest({ title: req.body?.title, body: req.body?.body });
    res.json(result);
  }),
);

gitRouter.post(
  '/init',
  requireOwner,
  asyncHandler(async (_req, res) => {
    await git.init();
    res.json(await git.status());
  }),
);

gitRouter.post(
  '/clone',
  requireOwner,
  asyncHandler(async (_req, res) => {
    await git.clone();
    res.json(await git.status());
  }),
);

gitRouter.post(
  '/pull',
  requireOwner,
  asyncHandler(async (_req, res) => {
    const message = await git.pull();
    console.log('[git] pull:', message);
    res.json({ message });
  }),
);

gitRouter.post(
  '/push',
  requireOwner,
  asyncHandler(async (_req, res) => {
    const message = await git.push();
    console.log('[git] push:', message);
    res.json({ message });
  }),
);

/** 解析提交信息：支持 { prefix, description } 模板或 { message }。 */
function resolveMessage(body: any): string | CommitTemplateError {
  let message = String(body?.message ?? '');
  const prefix = body?.prefix;
  const description = body?.description;
  if (prefix !== undefined || description !== undefined) {
    try {
      message = buildCommitMessage({ prefix: String(prefix ?? ''), description: String(description ?? '') });
    } catch (e) {
      if (e instanceof CommitTemplateError) return e;
      throw e;
    }
  }
  return message;
}
