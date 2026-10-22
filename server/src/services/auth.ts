import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { getSettings, updateSettings } from './settings.js';
import { config } from '../config.js';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

const RETIRED_DEFAULT_PASSWORD = '123456';
export const MIN_PASSWORD_LEN = 12;
const MAX_PASSWORD_LEN = 1024;

/** So sánh chuỗi an toàn về timing (cho override pass dạng plaintext). */
function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** scrypt$<saltHex>$<hashHex> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** An explicitly configured strong recovery credential also supports desktop auto-login. */
function recoveryPassword(): string | undefined {
  const value = config.initialPassword;
  return value && value.length >= MIN_PASSWORD_LEN && value.length <= MAX_PASSWORD_LEN && value !== RETIRED_DEFAULT_PASSWORD
    ? value : undefined;
}

export async function isPasswordSet(): Promise<boolean> {
  const s = await getSettings();
  return Boolean(s.auth.userPasswordHash || s.auth.passwordHash || recoveryPassword());
}

export async function hasCustomPassword(): Promise<boolean> {
  return Boolean((await getSettings()).auth.userPasswordHash);
}

function validateNewPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN || password === RETIRED_DEFAULT_PASSWORD) {
    throw Object.assign(new Error(`Password must be between ${MIN_PASSWORD_LEN} and ${MAX_PASSWORD_LEN} characters`), { status: 400 });
  }
}

/** Protected, once-only setup. The persistent hash consumes the setup capability. */
export async function initializeUserPassword(token: string, password: string): Promise<string> {
  validateNewPassword(password);
  const expected = process.env.WEBOBSIDIAN_SETUP_TOKEN;
  if (!expected || expected.length < 32 || expected.length > 1024 || token.length > 1024 || !safeEqualStr(token, expected)) {
    throw Object.assign(new Error('Setup credential required or invalid'), { status: 403 });
  }
  const persisted = await updateSettings(async (draft) => {
    if (draft.auth.userPasswordHash || draft.auth.passwordHash) {
      throw Object.assign(new Error('Password already set'), { status: 409 });
    }
    draft.auth.userPasswordHash = await hashPassword(password);
    draft.auth.sessionVersion += 1;
    draft.auth.jwtSecret = randomBytes(48).toString('hex');
  });
  return signOwner(persisted.auth);
}

export async function setUserPassword(password: string): Promise<void> {
  validateNewPassword(password);
  await updateSettings(async (draft) => {
    draft.auth.userPasswordHash = await hashPassword(password);
    draft.auth.sessionVersion += 1;
  });
}

async function checkAgainst(password: string, auth: Awaited<ReturnType<typeof getSettings>>['auth']): Promise<boolean> {
  // Reject the retired credential even if it was explicitly saved by an old version.
  if (!password || password === RETIRED_DEFAULT_PASSWORD || password.length > MAX_PASSWORD_LEN) return false;
  if (auth.userPasswordHash && await verifyPassword(password, auth.userPasswordHash)) return true;
  if (auth.passwordHash && await verifyPassword(password, auth.passwordHash)) return true;
  const recovery = recoveryPassword();
  return Boolean(recovery && safeEqualStr(password, recovery));
}

export async function checkPassword(password: string): Promise<boolean> {
  return checkAgainst(password, (await getSettings()).auth);
}

/** Recheck inside the serialized transaction so concurrent changes cannot use a stale password. */
export async function changePassword(current: string, next: string): Promise<string> {
  validateNewPassword(next);
  const persisted = await updateSettings(async (draft) => {
    if (!(await checkAgainst(current, draft.auth))) {
      throw Object.assign(new Error('Current password is incorrect'), { status: 401 });
    }
    draft.auth.userPasswordHash = await hashPassword(next);
    draft.auth.sessionVersion += 1;
  });
  return signOwner(persisted.auth);
}

/** Single-owner logout revokes all owner/guest sessions, without invalidating share cookies. */
export async function revokeSessions(): Promise<void> {
  await updateSettings((draft) => { draft.auth.sessionVersion += 1; });
}

const TOKEN_TTL = '30d';

export type SessionRole = 'owner' | 'guest';

function signOwner(auth: Awaited<ReturnType<typeof getSettings>>['auth']): string {
  return jwt.sign({ sub: 'owner', ver: auth.sessionVersion }, auth.jwtSecret, {
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
  });
}

/** Bind login to the exact credential generation checked, never a newer session version. */
export async function authenticatePassword(password: string): Promise<string | null> {
  const snapshot = (await getSettings()).auth;
  return await checkAgainst(password, snapshot) ? signOwner(snapshot) : null;
}

export async function issueToken(): Promise<string> {
  return signOwner((await getSettings()).auth);
}

/** 为公开编辑访客签发一个受限会话令牌（sub: 'guest'）。 */
export async function issueGuestToken(): Promise<string> {
  const s = await getSettings();
  return jwt.sign({ sub: 'guest', ver: s.auth.sessionVersion }, s.auth.jwtSecret, {
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
  });
}

/**
 * 校验令牌并返回角色。owner 令牌 sub='owner'；访客令牌 sub='guest'。
 * 其它（如 share 解锁 cookie）一律视为无效。
 */
export async function verifyTokenRole(token: string): Promise<SessionRole | null> {
  try {
    const s = await getSettings();
    const payload = jwt.verify(token, s.auth.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'object' && payload !== null && payload.ver === s.auth.sessionVersion) {
      if (payload.sub === 'owner') return 'owner';
      if (payload.sub === 'guest') return 'guest';
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Xác minh token phiên CHỦ SỞ HỮU. Ngoài chữ ký hợp lệ, token bắt buộc phải có
 * `sub === 'owner'` và dùng đúng thuật toán HS256. Điều này ngăn các token khác
 * cũng ký bằng cùng `jwtSecret` (ví dụ unlock-cookie của share công khai, mang
 * `sub: 'share'`) bị tái sử dụng như một phiên owner đầy đủ.
 */
export async function verifyToken(token: string): Promise<boolean> {
  return (await verifyTokenRole(token)) === 'owner';
}

/** ---- API keys ----------------------------------------------------------- */

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Returns { raw, record-fields }. `raw` is shown to the user exactly once. */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `wok_${randomBytes(24).toString('base64url')}`;
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 12) };
}
