import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { COOKIE_NAME, requireAuth, requireOwner } from '../middleware/auth.js';
import {
  isPasswordSet,
  hasCustomPassword,
  initializeUserPassword,
  revokeSessions,
  verifyTokenRole,
  authenticatePassword,
  changePassword,
  MIN_PASSWORD_LEN,
} from '../services/auth.js';
import { loginRateLimit, setupRateLimit, passwordChangeRateLimit } from '../middleware/ratelimit.js';
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
    // A recovery login without a user password must establish one.
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
  setupRateLimit,
  asyncHandler(async (req, res) => {
    const { password, setupToken } = req.body ?? {};
    if (typeof password !== 'string' || typeof setupToken !== 'string') {
      res.status(400).json({ error: 'password and setupToken required' });
      return;
    }
    const token = await initializeUserPassword(setupToken, password);
    res.cookie(COOKIE_NAME, token, cookieOpts(req)).json({ ok: true });
  }),
);

authRouter.post(
  '/change-password',
  requireOwner,
  passwordChangeRateLimit,
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
    const token = await changePassword(currentPassword, newPassword);
    // The mutation revoked old sessions. Refresh this browser's cookie atomically
    // with the successful response so ordinary Settings use remains signed in.
    res.cookie(COOKIE_NAME, token, cookieOpts(req)).json({ ok: true });
  }),
);

authRouter.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { password } = req.body ?? {};
    const token = typeof password === 'string' ? await authenticatePassword(password) : null;
    if (!token) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }
    res
      .cookie(COOKIE_NAME, token, cookieOpts(req))
      .json({ ok: true, mustChangePassword: !(await hasCustomPassword()) });
  }),
);

authRouter.post('/logout', asyncHandler(async (req, res) => {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const token = req.cookies?.[COOKIE_NAME] || bearer;
  if (token && await verifyTokenRole(token) === 'owner') await revokeSessions();
  res.clearCookie(COOKIE_NAME, { path: '/' }).json({ ok: true });
}));

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
