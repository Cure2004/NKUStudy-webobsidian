import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config, SETTINGS_FILE } from '../config.js';

/** ---- Schema (PRD §6) ---------------------------------------------------- */

const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  hash: z.string(),
  prefix: z.string(), // first chars, for display
  scopes: z.array(z.enum(['read', 'write', 'search'])).default(['read', 'search']),
  createdAt: z.string(),
  lastUsed: z.string().nullable().default(null),
});

const SettingsSchema = z.object({
  version: z.number().int().min(1).max(2).default(2),
  auth: z
    .object({
      // Empty means uninitialized; it never enables a shared default password.
      userPasswordHash: z.string().regex(/^$|^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/i).default(''),
      // Mật khẩu override để khôi phục khi quên pass (sửa tay vào file). Rỗng = không có.
      passwordHash: z.string().regex(/^$|^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/i).default(''),
      jwtSecret: z.string().default(''),
      sessionVersion: z.number().int().nonnegative().default(0),
    })
    .default({}),
  vault: z
    .object({
      path: z.string().default(''),
      allowedRoots: z.array(z.string()).default([]),
      trash: z.string().default('.trash'),
      // Xoá file: 'trash' = chuyển vào thư mục .trash (khôi phục được);
      // 'permanent' = xoá vĩnh viễn ngay.
      deleteMode: z.enum(['trash', 'permanent']).default('trash'),
      attachmentDir: z.string().default('attachments'),
      // 编辑器的「内容根目录」：相对仓库根的子目录（如 docs/start）。
      // 文件树只显示该目录下的内容；git 操作仍以仓库根为基准。
      root: z.string().default(''),
      // 文件夹中文名映射：相对内容根目录的路径 → 显示名（对齐 VitePress config.ts）。
      folderLabels: z.record(z.string(), z.string()).default({}),
      // 文件夹自定义顺序：相对内容根目录的路径数组，按此顺序显示；
      // 未列出的文件夹排在后面，按名称排序。
      folderOrder: z.array(z.string()).default([]),
      // 是否用 Markdown 文档标题替换英文文件名显示。
      useDocTitles: z.boolean().default(true),
    })
    .default({}),
  git: z
    .object({
      enabled: z.boolean().default(false),
      remote: z.string().default(''),
      branch: z.string().default('main'),
      token: z.string().default(''),
      authorName: z.string().default('WebObsidian'),
      authorEmail: z.string().default('webobsidian@localhost'),
      autoSync: z.boolean().default(false),
      autoCommitOnSave: z.boolean().default(false),
      intervalSec: z.number().default(300),
      lfsPatterns: z
        .array(z.string())
        .default(['*.png', '*.jpg', '*.jpeg', '*.gif', '*.pdf', '*.mp4', '*.mov', '*.zip']),
    })
    .default({}),
  // GitHub App 鉴权 + 在线投稿（PR）配置。
  github: z
    .object({
      // 是否启用 GitHub App 鉴权（优先于 PAT）。
      appEnabled: z.boolean().default(false),
      appId: z.string().default(''),
      privateKey: z.string().default(''),
      installationId: z.string().default(''),
      // 目标仓库（在线编辑统一提交到该仓库的 web-edit 分支）。
      targetConfirmed: z.boolean().default(false),
      owner: z.string().default(''),
      repo: z.string().default(''),
      // 在线编辑推送的分支与 PR 的目标分支。
      editBranch: z.string().default(''),
      baseBranch: z.string().default(''),
      // 是否自动为 web-edit 分支创建/更新 PR。
      autoPullRequest: z.boolean().default(true),
      // 是否让编辑分支自动跟进主分支（baseBranch → editBranch）。
      // 开启后，若编辑分支没有未合并的 PR，则定期把主分支合并进编辑分支，
      // 使在线编辑器始终基于最新的主分支内容。
      autoFollowBase: z.boolean().default(true),
      // 跟进主分支的检查间隔（秒），最小 60。
      followIntervalSec: z.number().default(300),
    })
    .default({}),
  // 图片上传（PicList-Core 图床）。
  upload: z
    .object({
      // 是否启用外部图床上传（否则图片仍存到 vault 的 attachments）。
      enabled: z.boolean().default(false),
      // PicList-Core 服务地址，例如 https://piclist.example.com
      server: z.string().default(''),
      // 接口鉴权 key（对应 picgo-server 的 -k）。
      key: z.string().default(''),
      // 上传接口路径（默认 /upload）。
      path: z.string().default('/upload'),
      // 表单文件字段名（PicList-Core 为 file）。
      field: z.string().default('file'),
    })
    .default({}),
  // 公开编辑模式：访客免密进入，只能编辑指定目录并走 PR 流程。
  publicEditor: z
    .object({
      // 是否开启公开编辑。开启后未登录访客可读写 editableRoot 下的文件。
      enabled: z.boolean().default(false),
      // 访客可编辑的目录（相对仓库根，如 docs/start）。默认等于内容根。
      editableRoot: z.string().default('docs/start'),
    })
    .default({}),
  search: z
    .object({
      fuzzy: z.number().default(0.2),
      prefix: z.boolean().default(true),
      indexFrontmatter: z.boolean().default(true),
    })
    .default({}),
  api: z
    .object({
      keys: z.array(ApiKeySchema).default([]),
      rateLimitPerMin: z.number().default(120),
    })
    .default({}),
  ui: z
    .object({
      theme: z.enum(['obsidian-dark', 'obsidian-light']).default('obsidian-light'),
      defaultView: z.enum(['live', 'source', 'reading']).default('live'),
    })
    .default({}),
  plugins: z
    .object({
      enabled: z.array(z.string()).default([]),
      installed: z.array(z.string()).default([]),
    })
    .default({}),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type ApiKeyRecord = z.infer<typeof ApiKeySchema>;

/** ---- Store --------------------------------------------------------------- */

let cache: Settings | null = null;
let loading: Promise<Settings> | null = null;
let mutations: Promise<unknown> = Promise.resolve();

function defaults(): Settings {
  const base = SettingsSchema.parse({});
  base.auth.jwtSecret = randomBytes(48).toString('hex');
  base.vault.path = config.defaultVaultPath;
  base.vault.allowedRoots = config.allowedRoots.length
    ? config.allowedRoots
    : [path.dirname(config.defaultVaultPath), config.defaultVaultPath];
  return base;
}

/**
 * Guarantee the folder browser can reach the configured vault. The default
 * allowedRoots are derived from the sample vault, so pointing the vault at a
 * path outside them (e.g. ~/ObsidianVault) made Browse… return 403 with
 * "Path outside allowed roots". Add the vault's parent directory as a root
 * whenever it isn't already covered. Returns true if it mutated the draft.
 */
export function ensureVaultBrowsable(d: Settings): boolean {
  const vaultPath = path.resolve(d.vault.path);
  const roots = d.vault.allowedRoots ?? [];
  const covered = roots.some((r) => {
    const rr = path.resolve(r);
    return vaultPath === rr || vaultPath.startsWith(rr + path.sep);
  });
  if (covered) return false;
  d.vault.allowedRoots = [...roots, path.dirname(vaultPath)];
  return true;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
}

/** Safe diagnostics never interpolate settings, schema values or credentials. */
function settingsError(reason: string): Error {
  return Object.assign(new Error(`Cannot safely load or save settings (${reason}); settings and existing backups were preserved.`), {
    status: 503, code: 'SETTINGS_UNAVAILABLE',
  });
}

function isMissing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Atomic replacement. Existing .bak is immutable; a failed save never changes cache. */
async function persist(s: Settings): Promise<void> {
  await ensureDataDir();
  const tmp = `${SETTINGS_FILE}.tmp-${randomBytes(4).toString('hex')}`;
  try {
    if (!(await fs.lstat(SETTINGS_FILE)).isFile()) throw settingsError('primary_not_regular');
    await fs.writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600, flag: 'wx' });
    try {
      await fs.copyFile(SETTINGS_FILE, `${SETTINGS_FILE}.bak`, constants.COPYFILE_EXCL);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (!(await fs.lstat(`${SETTINGS_FILE}.bak`)).isFile()) throw settingsError('backup_not_regular');
    }
    await fs.rename(tmp, SETTINGS_FILE);
  } catch {
    throw settingsError('write_failed');
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

async function readSettings(): Promise<Settings> {
  try { await ensureDataDir(); } catch { throw settingsError('data_directory_unavailable'); }
  let raw: string;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    // Refuse links and special files before reading. NONBLOCK also avoids a
    // replaced FIFO hanging startup between opening and the regular-file check.
    handle = await fs.open(SETTINGS_FILE, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!(await handle.stat()).isFile()) throw settingsError('primary_not_regular');
    raw = await handle.readFile('utf8');
  } catch (e) {
    if (!isMissing(e)) throw settingsError('read_failed');
    // A missing primary with a backup is recovery, never a new installation.
    try {
      await fs.lstat(`${SETTINGS_FILE}.bak`);
      throw settingsError('primary_missing_with_backup');
    } catch (backupError) {
      if (!isMissing(backupError)) throw settingsError('primary_missing_or_backup_unreadable');
    }
    const created = defaults();
    try {
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(created, null, 2), { mode: 0o600, flag: 'wx' });
    } catch { throw settingsError('initialization_failed'); }
    return created;
  } finally {
    await handle?.close().catch(() => {});
  }
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw settingsError('invalid_json'); }
  // Defaults are for new installs and non-sensitive optional features, never
  // for missing persisted credentials. Recognize only the actual legacy single-
  // hash format; a partial current auth object is an error, not fresh setup.
  const record = z.object({
    version: z.number().int().min(1).max(2),
    auth: z.object({
      jwtSecret: z.string().min(1),
      userPasswordHash: z.string().optional(),
      passwordHash: z.string(),
      sessionVersion: z.number().int().nonnegative().optional(),
    }),
    vault: z.object({ path: z.string().min(1) }),
  }).safeParse(input);
  if (!record.success) throw settingsError('invalid_structure');
  const rawAuth = record.data.auth;
  const persistedVersion = record.data.version;
  const legacySingleHash = persistedVersion === 1 && rawAuth.userPasswordHash === undefined
    && rawAuth.passwordHash.length > 0 && rawAuth.sessionVersion === undefined;
  if (rawAuth.userPasswordHash === undefined && !legacySingleHash) {
    throw settingsError('missing_credential_fields');
  }
  if (persistedVersion === 2 && rawAuth.sessionVersion === undefined) {
    throw settingsError('missing_session_version');
  }
  const result = SettingsSchema.safeParse(input);
  if (!result.success || !result.data.auth.jwtSecret || !result.data.vault.path) {
    throw settingsError('invalid_schema');
  }
  const parsed = result.data;
  let dirty = persistedVersion !== 2;
  parsed.version = 2;
  // Preserve the old strong password when migrating the legacy single-hash format.
  if (parsed.auth.passwordHash && !parsed.auth.userPasswordHash) {
    parsed.auth.userPasswordHash = parsed.auth.passwordHash;
    parsed.auth.passwordHash = '';
    dirty = true;
  }
  if (ensureVaultBrowsable(parsed)) dirty = true;
  if (dirty) await persist(parsed);
  return parsed;
}

export async function loadSettings(): Promise<Settings> {
  if (cache) return cache;
  if (!loading) {
    loading = readSettings().then((loaded) => {
      cache = loaded;
      return loaded;
    }).finally(() => { loading = null; });
  }
  return loading;
}

export async function getSettings(): Promise<Settings> {
  return cache ?? (await loadSettings());
}

/** Hold a stable settings generation across a multi-step operation.
 * The callback may call getSettings(), but MUST NOT call updateSettings() or
 * recursively acquire this lock: both would wait on the slot it already owns.
 */
export function withSettingsSnapshotLock<T>(fn: () => Promise<T>): Promise<T> {
  const operation = mutations.then(async () => {
    await getSettings();
    return fn();
  });
  mutations = operation.catch(() => {});
  return operation;
}

/** Serialize read-modify-persist operations; failed writes leave the prior cache intact. */
export function updateSettings(mutator: (draft: Settings) => void | Promise<void>): Promise<Settings> {
  const operation = mutations.then(async () => {
    const current = await getSettings();
    const draft: Settings = JSON.parse(JSON.stringify(current));
    await mutator(draft);
    const validated = SettingsSchema.parse(draft);
    await persist(validated);
    cache = validated;
    return validated;
  });
  mutations = operation.catch(() => {});
  return operation;
}

/** Redact secrets for sending to the client. */
export function redactSettings(s: Settings) {
  return {
    ...s,
    auth: {
      // Only report presence; never expose authentication material.
      hasCustomPassword: Boolean(s.auth.userPasswordHash),
      hasOverridePassword: Boolean(s.auth.passwordHash),
    },
    git: { ...s.git, token: s.git.token ? '••••••••' : '' },
    github: {
      ...s.github,
      // 私钥绝不下发；仅告知是否已配置。
      privateKey: s.github.privateKey ? '••••••••' : '',
      hasPrivateKey: Boolean(s.github.privateKey),
    },
    upload: { ...s.upload, key: s.upload.key ? '••••••••' : '' },
    api: {
      ...s.api,
      keys: s.api.keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        createdAt: k.createdAt,
        lastUsed: k.lastUsed,
      })),
    },
  };
}
