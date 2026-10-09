import {readFile,writeFile} from 'node:fs/promises';
export async function convert(xml) {
  const attrs=text=>Object.fromEntries([...text.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>')]));
  const nodes=new Map();
  for(const m of xml.matchAll(/<node\b([^>]+)>/g)){const a=attrs(m[1]);nodes.set(a.id,[+a.lon,+a.lat]);}
  const ways=[];
  for(const m of xml.matchAll(/<way\b([^>]+)>([\s\S]*?)<\/way>/g)) {
    const a=attrs(m[1]),tags={};
    for(const t of m[2].matchAll(/<tag\b([^>]+)>/g)){const b=attrs(t[1]);if(['highway','building','building:levels','height','name','name:en','landuse','leisure','railway','lanes','oneway','access','motor_vehicle','layer','bridge','tunnel'].includes(b.k))tags[b.k]=b.v;}
    if(!tags.highway&&!tags.building&&!tags.railway&&tags.leisure!=='park'&&!tags.landuse)continue;
    const points=[...m[2].matchAll(/<nd\b([^>]+)>/g)].map(n=>nodes.get(attrs(n[1]).ref)).filter(Boolean);
    if(points.length<2)continue;
    if(!points.some(([lon,lat])=>lon>=139.692&&lon<=139.710&&lat>=35.6525&&lat<=35.668))continue;
    ways.push({id:+a.id,tags,points});
  }
  const data={bbox:[35.6525,139.692,35.668,139.710],origin:[139.7016,35.6595],source:'OpenStreetMap contributors',license:'ODbL-1.0',fetchedAt:new Date().toISOString(),ways};
  await writeFile(new URL('../web/data/shibuya.json',import.meta.url),JSON.stringify(data));console.log(`Saved ${ways.length} ways (${ways.filter(w=>w.tags.building).length} buildings, ${ways.filter(w=>w.tags.highway).length} roads)`);
}
if(process.argv[2])await convert(await readFile(process.argv[2],'utf8'));
