import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import * as git from '../services/git.js';
import { COMMIT_PREFIXES, buildCommitMessage, CommitTemplateError } from '../services/commitTemplate.js';
import { isGithubAppConfigured } from '../services/githubApp.js';

export const gitRouter = Router();
gitRouter.use(requireAuth);

gitRouter.get('/status', asyncHandler(async (_req, res) => res.json(await git.status())));

// 提交模板：可用的中文前缀列表。
gitRouter.get('/commit-prefixes', (_req, res) => {
  res.json({ prefixes: COMMIT_PREFIXES });
});

// 是否已配置 GitHub App（决定能否自动开 PR）。
gitRouter.get(
  '/github-app',
  asyncHandler(async (_req, res) => {
    res.json({ configured: await isGithubAppConfigured() });
  }),
);

// 手动为在线编辑分支创建/复用 PR���
gitRouter.post(
  '/pull-request',
  asyncHandler(async (req, res) => {
    const result = await git.openPullRequest({ title: req.body?.title, body: req.body?.body });
    res.json(result);
  }),
);

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

gitRouter.post(
  '/init',
  asyncHandler(async (_req, res) => {
    await git.init();
    res.json(await git.status());
  }),
);

gitRouter.post(
  '/clone',
  asyncHandler(async (_req, res) => {
    await git.clone();
    res.json(await git.status());
  }),
);

gitRouter.post(
  '/pull',
  asyncHandler(async (_req, res) => {
    const message = await git.pull();
    console.log('[git] pull:', message);
    res.json({ message });
  }),
);

gitRouter.post(
  '/commit',
  asyncHandler(async (req, res) => {
    // 支持两种调用：{ prefix, description }（提交模板）或 { message }（已拼好的规范信息）。
    let message = String(req.body?.message ?? '');
    const prefix = req.body?.prefix;
    const description = req.body?.description;
    if (prefix !== undefined || description !== undefined) {
      try {
        message = buildCommitMessage({ prefix: String(prefix ?? ''), description: String(description ?? '') });
      } catch (e) {
        if (e instanceof CommitTemplateError) {
          res.status(400).json({ error: e.message });
          return;
        }
        throw e;
      }
    }
    const out = await git.commitAll(message);
    console.log('[git] commit:', out);
    res.json({ message: out });
  }),
);

gitRouter.post(
  '/push',
  asyncHandler(async (_req, res) => {
    const message = await git.push();
    console.log('[git] push:', message);
    res.json({ message });
  }),
);

gitRouter.post(
  '/sync',
  asyncHandler(async (req, res) => {
    // 同步同样支持提交模板：{ prefix, description } 或 { message }。
    let message = req.body?.message as string | undefined;
    const prefix = req.body?.prefix;
    const description = req.body?.description;
    if (prefix !== undefined || description !== undefined) {
      try {
        message = buildCommitMessage({ prefix: String(prefix ?? ''), description: String(description ?? '') });
      } catch (e) {
        if (e instanceof CommitTemplateError) {
          res.status(400).json({ error: e.message });
          return;
        }
        throw e;
      }
    }
    console.log('[git] manual sync requested');
    const result = await git.sync(message);
    console.log(`[git] sync ${result.ok ? 'ok' : 'not-ok'}:`, result.log.join(' | '));
    res.json(result);
  }),
);
