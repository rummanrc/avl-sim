import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TeltonikaClient } from './teltonika.mjs';
const root=resolve(new URL('../web',import.meta.url).pathname),sessions=new Map();
const port=Number(process.env.PORT||8787);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json'};
const server=http.createServer(async(req,res)=> {
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
    const url=new URL(req.url,'http://localhost');
    // This bridge serves its own UI and accepts mutations only from that origin.
    if(req.method==='POST') {
      if(req.headers.origin && ![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin))return reply(403,{error:'Open the local app to use the TCP bridge'});
      if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'Expected application/json'});
      let body='';for await(const chunk of req){body+=chunk;if(body.length>65536)return reply(413,{error:'Request too large'});}
      const data=JSON.parse(body);
      if(url.pathname==='/api/connect') {
        if(sessions.size>=10)return reply(429,{error:'Too many sessions; disconnect an existing session'});
        const client=new TeltonikaClient(data);
        try{await client.connect();}catch(e){client.close();throw e;}
        const id=randomUUID();sessions.set(id,{client,last:Date.now()});return reply(200,{session:id,connected:true});
      }
      const session=sessions.get(data.session);
      if(!session)return reply(400,{error:'Session expired; reconnect to the receiver'});
      session.last=Date.now();
      if(url.pathname==='/api/disconnect'){session.client.close();sessions.delete(data.session);return reply(200,{connected:false});}
      if(url.pathname==='/api/send') {
        try{return reply(200,await session.client.send(data.records));}
        catch(e){if(session.client.closed)sessions.delete(data.session);throw e;}
      }
      return reply(404,{error:'Unknown API route'});
    }
    if(req.method!=='GET')return reply(405,{error:'Method not allowed'});
    if(url.pathname.startsWith('/api/'))return reply(405,{error:'Use POST'});
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(root+'/'))return reply(403,{error:'Forbidden'});
    const file=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'});res.end(file);
  }catch(e){reply(e.code==='ENOENT'?404:400,{error:e.message});}
});
const sweep=setInterval(()=>{for(const [id,s]of sessions)if(Date.now()-s.last>120000){s.client.close();sessions.delete(id);}},30000);sweep.unref();
server.listen(port,'127.0.0.1',()=>console.log(`Tokyo Drive ready at http://localhost:${port}`));
process.on('SIGINT',()=>{for(const s of sessions.values())s.client.close();server.close();process.exit(0);});
