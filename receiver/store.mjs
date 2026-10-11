import {open,mkdir,readFile,truncate} from 'node:fs/promises';
import {dirname} from 'node:path';
import {History,validateRules} from './history.mjs';
export class Store {
  constructor(path){this.path=path;this.history=new History();this.queue=Promise.resolve();}
  async init(){await mkdir(dirname(this.path),{recursive:true});let content='';try{content=await readFile(this.path,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    // A crash can leave an unterminated final entry; never acknowledge it on replay.
    const end=content.lastIndexOf('\n')+1;if(end<content.length)await truncate(this.path,Buffer.byteLength(content.slice(0,end)));
    for(const line of content.slice(0,end).split('\n'))if(line)this.history.apply(JSON.parse(line));this.file=await open(this.path,'a');return this;
  }
  append(entry){if(entry.type==='rules')entry={...entry,rules:validateRules(entry.rules)};const operation=this.queue.then(async()=>{await this.file.writeFile(JSON.stringify(entry)+'\n');await this.file.sync();this.history.apply(entry);});this.queue=operation.catch(()=>{});return operation;}
  async close(){await this.queue;await this.file.close();}
}
