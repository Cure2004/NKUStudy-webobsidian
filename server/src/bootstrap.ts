import { loadSettings as _load, getSettings } from './services/settings.js';
import { config } from './config.js';

export { getSettings };

export async function loadSettings() {
  return _load();
}

/** Report mode only: never print credentials or create a default password. */
export async function setPasswordIfInitial(): Promise<void> {
  if (config.initialPassword) {
    console.log('[boot] Explicit recovery credential configured; retired or short credentials are rejected');
  } else if (!(await getSettings()).auth.userPasswordHash) {
    console.log('[boot] Owner setup required; configure a private one-time setup credential before initialization');
  }
}
