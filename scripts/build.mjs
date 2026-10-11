import {prepareMapFile} from './prepare-map.mjs';
await prepareMapFile();
import { cp, rm } from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await cp('web','dist',{recursive:true});
await cp('receiver/web','dist/receiver',{recursive:true});
console.log('Static application copied to dist/');
