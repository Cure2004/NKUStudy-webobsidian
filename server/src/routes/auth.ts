import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { COOKIE_NAME, requireAuth } from '../middleware/auth.js';
import {
  isPasswordSet,
  hasCustomPassword,
  setUserPassword,
  checkPassword,
  changePassword,
  issueToken,
  MIN_PASSWORD_LEN,
} from '../services/auth.js';
import { loginRateLimit } from '../middleware/ratelimit.js';
import { getSettings } from '../services/settings.js';

export const authRouter = Router();

// A `Secure` cookie is silently dropped by browsers over plain http://, so tying
// it to NODE_ENV broke HTTP-only self-hosting (every API call 401'd → blank UI).
// Default 'auto' = match the request's actual transport (honours X-Forwarded-Proto
// via `trust proxy`); set COOKIE_SECURE=true/false to force.
const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? 'auto').toLowerCase();

function cookieOpts(req: Request) {
  const secure =
    COOKIE_SECURE === 'true' ? true : COOKIE_SECURE === 'false' ? false : req.secure;
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

authRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    // mustChangePassword=true ⇒ still on the default 123456; the UI forces a change.
    // publicEditor=true ⇒ 访客免密进入编辑器（只能编辑指定目录并走 PR 投稿）。
    const s = await getSettings();
    res.json({
      passwordSet: await isPasswordSet(),
      mustChangePassword: !(await hasCustomPassword()),
      publicEditor: s.publicEditor.enabled,
    });
  }),
);

authRouter.post(
  '/setup',
  asyncHandler(async (req, res) => {
    if (await isPasswordSet()) {
      res.status(409).json({ error: 'Password already set' });
      return;
    }
    const { password } = req.body ?? {};
    if (typeof password !== 'string') {
      res.status(400).json({ error: 'password required' });
      return;
    }
    await setUserPassword(password);
    const token = await issueToken();
    res.cookie(COOKIE_NAME, token, cookieOpts(req)).json({ ok: true });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      res.status(400).json({ error: 'currentPassword and newPassword required' });
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LEN) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters` });
      return;
    }
    try {
      await changePassword(currentPassword, newPassword);
    } catch {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { password } = req.body ?? {};
    if (typeof password !== 'string' || !(await checkPassword(password))) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }
    const token = await issueToken();
    res
      .cookie(COOKIE_NAME, token, cookieOpts(req))
      .json({ ok: true, mustChangePassword: !(await hasCustomPassword()) });
  }),
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' }).json({ ok: true });
});

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    // role: 'owner' = 已登录管理员；'guest' = 公开模式访客（免密或访客令牌）。
    const role = req.sessionRole ?? 'owner';
    const s = await getSettings();
    res.json({
      authenticated: true,
      role,
      publicEditor: s.publicEditor.enabled,
      // 访客不强制改密码（那是 owner 的账户安全流程）。
      mustChangePassword: role === 'owner' ? !(await hasCustomPassword()) : false,
    });
  }),
);
