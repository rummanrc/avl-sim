import {crc16} from '../web/codec.js';
class Reader {
  constructor(bytes){this.bytes=bytes;this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);this.offset=0;}
  take(n){if(this.offset+n>this.bytes.length)throw Error('Truncated AVL record');const p=this.offset;this.offset+=n;return p;}
  uint(n){const p=this.take(n);if(n===1)return this.view.getUint8(p);if(n===2)return this.view.getUint16(p);if(n===4)return this.view.getUint32(p);return this.view.getBigUint64(p);}
  signed(n){const p=this.take(n);return n===2?this.view.getInt16(p):this.view.getInt32(p);}
  raw(n){return this.bytes.subarray(this.take(n),this.offset);}
}
export function decodePacket(bytes){const r=new Reader(bytes);if(r.uint(4)!==0)throw Error('Invalid TCP preamble');const length=r.uint(4);if(length<3||length+12!==bytes.length||bytes.length>1280)throw Error('Invalid frame length');const body=bytes.subarray(8,8+length);const crc=new DataView(bytes.buffer,bytes.byteOffset+8+length,4).getUint32(0);if(crc!==crc16(body))throw Error('CRC mismatch');const id=r.uint(1);if(![8,0x8e].includes(id))throw Error('Only Codec 8 and Codec 8E are supported');const width=id===8?1:2,count=r.uint(1);if(!count)throw Error('Empty AVL packet');const records=[];
  for(let i=0;i<count;i++){const ts=r.uint(8);if(ts>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Unsafe timestamp');const record={timestamp:Number(ts),priority:r.uint(1),gps:{longitude:r.signed(4)/1e7,latitude:r.signed(4)/1e7,altitude:r.signed(2),angle:r.uint(2),satellites:r.uint(1),speed:r.uint(2)},eventIoId:r.uint(width),io:[]};const total=r.uint(width),seen=new Set();
    const add=io=>{if(seen.has(io.id))throw Error('Duplicate IO ID');seen.add(io.id);record.io.push(io);};
    for(const size of [1,2,4,8]){const n=r.uint(width);for(let j=0;j<n;j++){const ioId=r.uint(width),value=r.uint(size);add({id:ioId,bytes:size,value:size===8?value.toString():value});}}
    if(id===0x8e){const n=r.uint(2);for(let j=0;j<n;j++){const ioId=r.uint(2),size=r.uint(2),value=Buffer.from(r.raw(size)).toString('hex');add({id:ioId,bytes:size,variable:true,value});}}
    if(total!==record.io.length)throw Error('IO count mismatch');if(record.priority>2||Math.abs(record.gps.longitude)>180||Math.abs(record.gps.latitude)>90||record.gps.angle>360)throw Error('Invalid AVL fields');records.push(record);
  }
  if(r.uint(1)!==count||r.offset!==8+length)throw Error('Record count or body size mismatch');return {codec:id===8?'8':'8e',records};
}
