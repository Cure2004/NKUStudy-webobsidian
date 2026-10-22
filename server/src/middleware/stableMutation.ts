import { asyncHandler } from './error.js';
import { COOKIE_NAME } from './auth.js';
import { getSettings, withSettingsSnapshotLock } from '../services/settings.js';
import { verifyTokenRole } from '../services/auth.js';
import { assertGuestWritable } from '../services/guestpath.js';

/** Bind authorization, physical paths and derived indexes to one settings generation. */
export const stableMutationHandler: typeof asyncHandler = (handler) => asyncHandler((req,res,next) => {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return handler(req,res,next);
  return withSettingsSnapshotLock(async()=>{
    const settings=await getSettings();
    if (req.apiKey) {
      if (!settings.api.keys.some(k=>k.id===req.apiKey!.id && k.hash===req.apiKey!.hash && k.scopes.includes('write'))) {
        throw Object.assign(new Error('API write capability has been revoked'),{status:403});
      }
    } else if (req.sessionRole==='guest') {
      if (!settings.publicEditor.enabled) throw Object.assign(new Error('Public editing is disabled'),{status:403});
      for (const value of [req.query.path,req.body?.path,req.body?.from,req.body?.to,req.body?.dir]) {
        if (typeof value==='string' && value) await assertGuestWritable(value);
      }
    } else {
      const header=req.headers.authorization;
      const token=req.cookies?.[COOKIE_NAME] || (header?.startsWith('Bearer ')?header.slice(7):undefined);
      if (!token || await verifyTokenRole(token)!=='owner') throw Object.assign(new Error('Owner session expired'),{status:401});
    }
    return handler(req,res,next);
  });
});
