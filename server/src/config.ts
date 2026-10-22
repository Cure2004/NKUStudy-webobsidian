import path from 'node:path';

/** Runtime configuration derived from environment variables. */
export interface RuntimeConfig {
  port: number;
  host: string;
  dataDir: string;
  /** Default vault path used on first run if settings has none. */
  defaultVaultPath: string;
  /** Roots the folder browser is allowed to traverse. */
  allowedRoots: string[];
  initialPassword?: string;
  isProd: boolean;
  /** Explicit proxy topology; unconfigured deployments ignore forwarded headers. */
  trustProxy: boolean | number | string;
}

function resolveRoots(): string[] {
  const raw = process.env.ALLOWED_ROOTS?.trim();
  if (raw) {
    return raw.split(',').map((p) => path.resolve(p.trim())).filter(Boolean);
  }
  return [];
}

/** Accept an explicit subnet/preset or hop configuration; default to no proxy trust. */
function resolveTrustProxy(): boolean | number | string {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower === 'false' || lower === 'off' || lower === '0') return false;
  if (lower === 'true' || lower === 'on') return true;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  return raw;
}

export const config: RuntimeConfig = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  defaultVaultPath: path.resolve(process.env.VAULT_PATH ?? './sample-vault'),
  allowedRoots: resolveRoots(),
  initialPassword: process.env.WEBOBSIDIAN_PASSWORD || undefined,
  isProd: process.env.NODE_ENV === 'production',
  trustProxy: resolveTrustProxy(),
};

export const SETTINGS_FILE = path.join(config.dataDir, 'settings.json');
export const INDEX_FILE = path.join(config.dataDir, 'qmd-index.json');
