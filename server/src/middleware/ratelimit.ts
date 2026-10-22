import type { Request, Response, NextFunction } from 'express';

/** Use forwarded addresses only behind an explicitly allowlisted proxy topology. */
function clientIp(req: Request): string {
  const setting = req.app.get('trust proxy');
  const trust = req.app.get('trust proxy fn') as ((ip: string, hop: number) => boolean) | undefined;
  const peer = req.socket.remoteAddress || 'unknown';
  // Boolean true trusts arbitrary headers. Numeric hop counts alone also do not
  // authenticate a proxy. Use the TCP peer unless a subnet/name allowlist is set.
  if ((typeof setting === 'string' || Array.isArray(setting)) && trust?.(peer, 0)) {
    return req.ip || peer;
  }
  return peer;
}

export function createAttemptLimiter(options: {
  limit: number;
  windowMs?: number;
  key?: (req: Request) => string;
}) {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const attempts = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${clientIp(req)}:${options.key?.(req) ?? ''}`;
    const recent = (attempts.get(key) ?? []).filter((t) => t > now - windowMs);
    if (attempts.size >= 10_000) {
      for (const [k, v] of attempts) if (v.every((t) => t <= now - windowMs)) attempts.delete(k);
    }
    if (recent.length >= options.limit || (!attempts.has(key) && attempts.size >= 10_000)) {
      const retryAfter = Math.max(1, Math.ceil(((recent[0] ?? now) + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many authentication attempts. Try again later.', retryAfter });
      return;
    }
    recent.push(now);
    attempts.set(key, recent);
    next();
  };
}

export const loginRateLimit = createAttemptLimiter({ limit: 10 });
export const setupRateLimit = createAttemptLimiter({ limit: 10 });
export const passwordChangeRateLimit = createAttemptLimiter({ limit: 10 });
export const sharePeerRateLimit = createAttemptLimiter({ limit: 30 });
export const sharePasswordRateLimit = createAttemptLimiter({ limit: 10, key: (req) => String(req.params.id) });
