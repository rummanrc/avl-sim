import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import clipping from './polygon-clipping.cjs';
import {project,roadWidths,distance,roadCorridor,boundsOf,SpatialIndex} from '../web/geometry.js';
export function prepareMap(raw){const corridors=[];for(const way of raw.ways){const t=way.tags;if(!roadWidths[t.highway]||t.access==='private'||t.motor_vehicle==='no')continue;const points=way.points.map(project);for(let i=1;i<points.length;i++)if(distance(points[i-1],points[i])>.1){const ring=roadCorridor({a:points[i-1],b:points[i],width:roadWidths[t.highway]});corridors.push({ring,bounds:boundsOf(ring.map(([x,z])=>({x,z})))});}}
  const index=new SpatialIndex(corridors),buildings=[];let trimmed=0;
  const low=project([raw.bbox[1],raw.bbox[2]]),high=project([raw.bbox[3],raw.bbox[0]]);
  for(const way of raw.ways){if(!way.tags.building||way.points.length<4)continue;const polygon=way.points.map(project),bounds=boundsOf(polygon);if(bounds.maxX<low.x||bounds.minX>high.x||bounds.maxZ<low.z||bounds.minZ>high.z)continue;const nearby=index.query(bounds);let result=[[[...polygon.map(p=>[p.x,p.z])]]];
    if(nearby.length){result=clipping.difference(result,...nearby.map(c=>[c.ring]));trimmed++;}
    for(const rings of result){const area=Math.abs(rings[0].reduce((sum,p,i)=>{const q=rings[0][(i+1)%rings[0].length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;if(area<3)continue;buildings.push({id:way.id,tags:way.tags,rings:rings.map(r=>r.map(([x,z])=>({x:Number(x.toFixed(5)),z:Number(z.toFixed(5))})))});}
  }
  return {...raw,ways:raw.ways.filter(w=>!w.tags.building),buildings,geometryVersion:2,trimmedBuildings:trimmed};
}
export async function prepareMapFile(){const raw=JSON.parse(await readFile(new URL('../web/data/shibuya.json',import.meta.url),'utf8'));const data=prepareMap(raw);await writeFile(new URL('../web/data/world.json',import.meta.url),JSON.stringify(data));console.log(`Prepared ${data.buildings.length} building parts; cleared rendered road and sidewalk corridors.`);}
if(process.argv[1]===fileURLToPath(import.meta.url))await prepareMapFile();
