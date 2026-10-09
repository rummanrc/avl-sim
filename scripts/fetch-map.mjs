import {convert} from './convert-osm.mjs';
const url='https://api.openstreetmap.org/api/0.6/map?bbox=139.692,35.6525,139.710,35.668';
const response=await fetch(url,{headers:{'User-Agent':'TokyoAVLDrive/1.0 (small local map extract)'},signal:AbortSignal.timeout(120000)});
if(!response.ok)throw Error(`Map fetch failed (${response.status}); existing extract preserved.`);
await convert(await response.text());
