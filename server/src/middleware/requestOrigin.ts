import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function allowedBrowserOrigin(origin: string | undefined, host: string | undefined, protocol?: string): boolean {
  if (!origin) return true; // Non-browser clients still need the normal route authentication.
  try {
    const url = new URL(origin);
    if (origin !== url.origin || !['http:', 'https:'].includes(url.protocol)) return false;
    if (!config.isProd && origin === 'http://localhost:5173') return true;
    return url.host === host && (!protocol || url.protocol === protocol + ':');
  } catch { return false; }
}

/** Browsers send Origin on cross-site writes, including simple multipart forms. */
export function sameOriginWrites(req: Request, res: Response, next: NextFunction): void {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !allowedBrowserOrigin(req.get('origin'), req.get('host'), req.protocol)) {
    res.status(403).json({ error: 'Cross-origin write rejected' });
    return;
  }
  next();
}
