// Fixed-destination TCP ingress. No HTTP proxy/CONNECT routing and no secret/data access.
import net from 'node:net';
const target=process.argv[2];
if(!/^nkustudy-4b-[a-z0-9][a-z0-9-]{0,40}$/.test(target))throw Error('Candidate container name required');
const server=net.createServer({allowHalfOpen:false},incoming=>{
  const upstream=net.connect({host:target,port:8787});
  // Leave time for the application's default 30s receive deadline to return 408.
  incoming.setTimeout(60_000,()=>incoming.destroy());
  upstream.setTimeout(60_000,()=>upstream.destroy());
  incoming.on('error',()=>upstream.destroy());upstream.on('error',()=>incoming.destroy());
  incoming.on('close',()=>upstream.destroy());upstream.on('close',()=>incoming.destroy());
  incoming.pipe(upstream);upstream.pipe(incoming);
});
server.maxConnections=16;
server.listen({host:'0.0.0.0',port:8787,backlog:16},()=>console.log('Fixed candidate TCP relay ready'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
