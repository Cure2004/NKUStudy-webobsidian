import type http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { COOKIE_NAME } from '../middleware/auth.js';
import { allowedBrowserOrigin } from '../middleware/requestOrigin.js';
import { verifyToken } from './auth.js';
import { setBroadcaster } from './realtime.js';

function sessionToken(req: http.IncomingMessage): string | undefined {
  try {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const eq = part.indexOf('=');
      if (eq >= 0 && part.slice(0,eq).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(eq+1).trim());
    }
    const auth = req.headers.authorization;
    return auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  } catch { return undefined; }
}

export function setupWebsocket(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const tokens = new WeakMap<WebSocket, string>();
  server.on('upgrade', (req, socket, head) => {
    const refuse = (status: number) => { socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if (req.url?.split('?')[0] !== '/ws') { refuse(404); return; }
    if (!allowedBrowserOrigin(req.headers.origin, req.headers.host)) { refuse(403); return; }
    const token = sessionToken(req);
    void (async () => {
      if (!token || !(await verifyToken(token))) { refuse(401); return; }
      if (socket.destroyed) return;
      wss.handleUpgrade(req,socket,head,ws=>{
        tokens.set(ws,token);
        ws.send(JSON.stringify({type:'hello'}));
        wss.emit('connection',ws,req);
      });
    })().catch(()=>refuse(401));
  });
  setBroadcaster(msg=>{
    void (async()=>{
      const data = JSON.stringify(msg);
      for (const client of wss.clients) {
        if (!(await verifyToken(tokens.get(client) ?? ''))) { client.close(1008,'Session expired'); continue; }
        if (client.readyState === 1) client.send(data);
      }
    })().catch(()=>{ for (const client of wss.clients) client.close(1011,'Authentication unavailable'); });
  });
  return wss;
}
