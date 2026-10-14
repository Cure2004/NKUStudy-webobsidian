import { getSettings } from './settings.js';
import { followBase } from './git.js';

/**
 * 让编辑分支（web-edit）自动跟进主分支（contribute）的定时任务。
 *
 * 与 autosync 类似：每 30s 检查一次设置，按 followIntervalSec 节流真正执行。
 * 若编辑分支存在未合并 PR，followBase 会自行暂停；这里只负责调度。
 */
let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRun: number | null = null;

export function startBaseFollow(): void {
  if (timer) clearInterval(timer);
  // Re-evaluate settings each tick so toggling takes effect without restart.
  timer = setInterval(tick, 30_000);
}

async function tick(): Promise<void> {
  if (running) return;
  const s = await getSettings();
  if (!s.git.enabled || !s.github.autoFollowBase || !s.git.remote) return;
  const intervalMs = Math.max(s.github.followIntervalSec, 60) * 1000;
  if (Date.now() - (lastRun ?? 0) < intervalMs) return;
  running = true;
  try {
    const res = await followBase();
    lastRun = Date.now();
    if (res.merged) console.log('[basefollow] merged:', res.log.join(' | '));
    else if (!res.ok) console.warn('[basefollow] not-ok:', res.log.join(' | '));
  } catch (e: any) {
    console.warn('[basefollow] failed:', e.message);
  } finally {
    running = false;
  }
}
