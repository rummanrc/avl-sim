import net from 'node:net';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePacket} from './decoder.mjs';
import {Store} from './store.mjs';
export async function startReceiver({tcpPort=5027,httpPort=8788,dataFile=fileURLToPath(new URL('./data/history.ndjson',import.meta.url)),host='127.0.0.1'}={}) {
  const store=await new Store(dataFile).init(),sockets=new Set(),connections=new Map(),stats={packets:0,rejected:0,lastError:null};
  const tcp=net.createServer(socket=>{sockets.add(socket);socket.setTimeout(120000,()=>socket.destroy());let buffer=Buffer.alloc(0),imei,processing=false;
    socket.on('error',()=>{});socket.on('close',()=>{sockets.delete(socket);if(imei){const active=connections.get(imei)||new Set();active.delete(socket);if(!active.size)connections.delete(imei);}});
    socket.on('data',async chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>131072){socket.destroy();return;}if(processing)return;processing=true;socket.pause();
      try{while(buffer.length){if(!imei){if(buffer.length<2)break;const size=buffer.readUInt16BE(0);if(size!==15)throw Error('IMEI must have 15 digits');if(buffer.length<17)break;const value=buffer.subarray(2,17).toString('ascii');if(!/^\d{15}$/.test(value))throw Error('Invalid IMEI');imei=value;buffer=buffer.subarray(17);if(!connections.has(imei))connections.set(imei,new Set());connections.get(imei).add(socket);socket.write(Buffer.from([1]));}
        else{if(buffer.length<8)break;const size=buffer.readUInt32BE(4)+12;if(size>1280||size<15||buffer.readUInt32BE(0)!==0)throw Error('Invalid AVL frame header');if(buffer.length<size)break;const packet=buffer.subarray(0,size);buffer=buffer.subarray(size);const decoded=decodePacket(packet);await store.append({type:'records',imei,...decoded,receivedAt:Date.now()});stats.packets++;const ack=Buffer.alloc(4);ack.writeUInt32BE(decoded.records.length);socket.write(ack);}}
      }catch(e){stats.rejected++;stats.lastError=e.message;socket.destroy();}
      finally{processing=false;socket.resume();}
    });
  });
  const root=fileURLToPath(new URL('./web/',import.meta.url));
  const web=http.createServer(async(req,res)=>{const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};try{const url=new URL(req.url,'http://localhost');
    if(req.method==='POST'&&url.pathname==='/api/rules'){const allowed=[`http://localhost:${web.address().port}`,`http://127.0.0.1:${web.address().port}`];if(req.headers.origin&&!allowed.includes(req.headers.origin))return send(403,{error:'Use the receiver dashboard origin'});if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Use application/json'});let text='';for await(const c of req){text+=c;if(text.length>4096)return send(413,{error:'Request too large'});}const rules=JSON.parse(text);await store.append({type:'rules',rules,at:Date.now()});return send(200,{rules:store.history.rules});}
    if(req.method!=='GET')return send(405,{error:'Method not allowed'});
    if(url.pathname==='/api/state')return send(200,{...store.history.snapshot(),connections:[...connections.keys()],stats,tcpPort:tcp.address().port});
    if(url.pathname==='/api/trip'){const trip=store.history.trip(url.searchParams.get('id'));return trip?send(200,trip):send(404,{error:'Trip not found'});}
    if(url.pathname==='/api/export'){const snapshot=store.history.snapshot();res.setHeader('Content-Disposition','attachment; filename="tokyo-receiver-history.json"');return send(200,{...snapshot,trips:snapshot.trips.map(t=>store.history.trip(t.id))});}
    const path=url.pathname==='/data/world.json'?fileURLToPath(new URL('../web/data/world.json',import.meta.url)):resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(url.pathname!=='/data/world.json'&&!path.startsWith(resolve(root)+'/'))return send(403,{error:'Forbidden'});const bytes=await readFile(path);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[extname(path)]||'application/octet-stream'});res.end(bytes);
  }catch(e){send(e.code==='ENOENT'?404:400,{error:e.message});}});
  const listen=(server,port)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  try{await listen(tcp,tcpPort);await listen(web,httpPort);}catch(e){tcp.close();web.close();await store.close();throw e;}
  return {tcp,web,store,async close(){for(const s of sockets)s.destroy();await Promise.all([new Promise(r=>tcp.close(r)),new Promise(r=>web.close(r))]);await store.close();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const app=await startReceiver({tcpPort:Number(process.env.RECEIVER_PORT||5027),httpPort:Number(process.env.RECEIVER_HTTP_PORT||8788),dataFile:process.env.RECEIVER_DATA_FILE||undefined});console.log(`Teltonika TCP receiver: localhost:${app.tcp.address().port}\nTrip dashboard: http://localhost:${app.web.address().port}`);let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();process.exit(0);};process.on('SIGINT',close);process.on('SIGTERM',close);}
