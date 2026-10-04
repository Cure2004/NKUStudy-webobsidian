import type { Request, Response, NextFunction } from 'express';
import { verifyTokenRole, type SessionRole } from '../services/auth.js';
import { getSettings } from '../services/settings.js';

export const COOKIE_NAME = 'webobsidian_token';

// 把解析出的会话角色挂到 req 上，供后续中间件/路由判断。
declare module 'express-serve-static-core' {
  interface Request {
    sessionRole?: SessionRole;
  }
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return undefined;
}

/**
 * 允许 owner 或（开启公开编辑时的）guest 访问。
 * - 有有效 owner 令牌 → owner。
 * - 有有效 guest 令牌且 publicEditor.enabled → guest。
 * - 无令牌但 publicEditor.enabled → 视为 guest（免密访客）。
 * - 否则 401。
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME] || bearer(req);
  if (token) {
    const role = await verifyTokenRole(token);
    if (role === 'owner') {
      req.sessionRole = 'owner';
      next();
      return;
    }
    if (role === 'guest') {
      const s = await getSettings();
      if (s.publicEditor.enabled) {
        req.sessionRole = 'guest';
        next();
        return;
      }
    }
  }
  // 无令牌：仅在公开编辑开启时放行为 guest。
  const s = await getSettings();
  if (s.publicEditor.enabled) {
    req.sessionRole = 'guest';
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * 仅允许 owner。用于设置、密钥、插件、git 等敏感接口——即使公开编辑开启，
 * 访客也不能访问。
 */
export async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME] || bearer(req);
  if (token && (await verifyTokenRole(token)) === 'owner') {
    req.sessionRole = 'owner';
    next();
    return;
  }
  res.status(401).json({ error: '需要管理员权限' });
}

/**
 * 拒绝访客（公开编辑）访问，owner 放行。用于「读/写内容根」之外的管理类接口
 * （回收站、全局索引/属性配置等）——访客已通过 requireAuth 取得 guest 角色，
 * 这里返回 403（而非 401）以表明「已识别但无权限」。
 */
export function denyGuest(req: Request, res: Response, next: NextFunction): void {
  if (req.sessionRole === 'guest') {
    res.status(403).json({ error: '该操作仅限管理员' });
    return;
  }
  next();
}
