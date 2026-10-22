import { getSettings } from './settings.js';

/**
 * 图片上传服务：把图片转发到 PicList-Core 图床。
 *
 * 为什么由服务端代理而不是前端直传：
 *  1. 隐藏接口鉴权 key（key 只保存在服务端 settings.json）。
 *  2. 规避浏览器 CORS（图床通常不开放跨域）。
 *
 * 接口约定（PicList-Core / picgo-server）：
 *   POST <server><path>?key=<key>   multipart/form-data，文件字段名默认 `file`
 *   成功返回 { success: true, result: ["https://..."] }
 */

export interface UploadResult {
  url: string;
  raw: unknown;
}

export class UploadError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

/** 拼接上传地址：去掉 server 末尾斜杠、path 首斜杠，避免出现 `//upload`。 */
export function buildUploadUrl(server: string, path: string, key: string): string {
  const base = server.trim().replace(/\/+$/, '');
  const p = (path.trim() || '/upload').replace(/^\/+/, '');
  const url = new URL(`${base}/${p}`);
  if (key) url.searchParams.set('key', key);
  return url.toString();
}

/** 从图床响应里提取第一个图片 URL。 */
export function extractUrl(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  if (data.success === false) return null;
  const result = data.result ?? data.data ?? data.url;
  if (Array.isArray(result)) return typeof result[0] === 'string' ? result[0] : null;
  if (typeof result === 'string') return result;
  return null;
}

/**
 * 上传一张图片到配置的图床。未启用或未配置时抛出 UploadError（404/400），
 * 调用方据此回退到本地 attachments 存储。
 */
export async function uploadImage(
  buffer: Buffer,
  filename: string,
  mime: string,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const s = await getSettings();
  const cfg = s.upload;
  if (!cfg.enabled) throw new UploadError('图片上传未启用', 400);
  if (!cfg.server) throw new UploadError('未配置图床服务地址', 400);

  const url = buildUploadUrl(cfg.server, cfg.path, cfg.key);
  const form = new FormData();
  form.append(cfg.field || 'file', new Blob([buffer], { type: mime || 'application/octet-stream' }), filename);

  const timeoutMs = Number(process.env.WEBOBSIDIAN_IMAGE_UPSTREAM_TIMEOUT_MS ?? 10_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > 10_000) throw new UploadError('Invalid image upstream timeout', 503);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch (e: any) {
    throw new UploadError('图床连接失败或超时');
  }
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024) { await reader.cancel(); throw new UploadError('图床响应过大'); }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    throw new UploadError(`图床返回 ${res.status}`, 502);
  }
  const imageUrl = extractUrl(data);
  if (!imageUrl) {
    throw new UploadError('图床未返回图片地址', 502);
  }
  let parsed: URL;
  try { parsed = new URL(imageUrl); } catch { throw new UploadError('图床返回无效图片地址'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new UploadError('图床返回无效图片地址');
  return { url: parsed.toString(), raw: data };
}
