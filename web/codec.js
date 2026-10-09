// Teltonika TCP Codec 8 / 8 Extended. Shared by the browser and Node bridge.
export function crc16(bytes) {
  let crc=0;
  for (const byte of bytes) { crc^=byte; for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xa001:crc>>>1; }
  return crc;
}
function integer(value,min,max,name) {
  if(!Number.isInteger(value)||value<min||value>max)throw Error(`Invalid ${name}`);
  return value;
}
export function validateRecord(r) {
  integer(r.timestamp,0,Number.MAX_SAFE_INTEGER,'timestamp');
  integer(r.priority,0,2,'priority');
  for(const [key,limit] of [['longitude',180],['latitude',90]])if(!Number.isFinite(r.gps?.[key])||Math.abs(r.gps[key])>limit)throw Error(`Invalid ${key}`);
  for(const [key,min,max] of [['altitude',-32768,32767],['angle',0,359],['satellites',0,255],['speed',0,65535]])integer(r.gps[key],min,max,key);
  integer(r.eventIoId,0,65535,'event IO');
  if(!Array.isArray(r.io)||r.io.length>255)throw Error('Invalid IO list');
  const ids=new Set();
  for(const io of r.io) {
    integer(io.id,0,65535,'IO ID');
    if(ids.has(io.id))throw Error('Duplicate IO ID');ids.add(io.id);
    if(![1,2,4,8].includes(io.bytes))throw Error('Invalid IO width');
    // Eight-byte values use decimal strings to preserve precision in JSON.
    if(typeof io.value==='number'&&!Number.isSafeInteger(io.value))throw Error('IO numbers must be safe integers; use decimal strings for 8-byte values');
    const value=BigInt(io.value);
    if(value<0n||value>((1n<<BigInt(io.bytes*8))-1n))throw Error('Invalid IO value');
  }
  return r;
}
class Writer {
  values=[];
  uint(value,size) { let n=BigInt(value);const b=Array(size);for(let i=size-1;i>=0;i--){b[i]=Number(n&255n);n>>=8n;}this.values.push(...b); }
  bytes(bytes){this.values.push(...bytes);}
  output(){return Uint8Array.from(this.values);}
}
export function encodeImei(imei) {
  if(!/^\d{15}$/.test(imei))throw Error('IMEI must contain exactly 15 digits');
  return Uint8Array.from([0,15,...new TextEncoder().encode(imei)]);
}
export function encodePacket(records,codec='8e') {
  if(!['8','8e'].includes(codec))throw Error('Unsupported codec');
  if(!Array.isArray(records)||!records.length||records.length>255)throw Error('Use 1–255 records');
  const ext=codec==='8e', width=ext?2:1,w=new Writer();
  w.uint(ext?0x8e:8,1);w.uint(records.length,1);
  for(const r of records) {
    validateRecord(r);w.uint(r.timestamp,8);w.uint(r.priority,1);
    w.uint(BigInt(Math.round(r.gps.longitude*1e7))&0xffffffffn,4);
    w.uint(BigInt(Math.round(r.gps.latitude*1e7))&0xffffffffn,4);
    w.uint(r.gps.altitude&0xffff,2);w.uint(r.gps.angle,2);w.uint(r.gps.satellites,1);w.uint(r.gps.speed,2);
    if(!ext && (r.eventIoId>255||r.io.some(io=>io.id>255)))throw Error('Codec 8 IO IDs must fit one byte');
    w.uint(r.eventIoId,width);w.uint(r.io.length,width);
    for(const size of [1,2,4,8]) {
      const group=r.io.filter(io=>io.bytes===size);w.uint(group.length,width);
      for(const io of group){w.uint(io.id,width);w.uint(io.value,size);}
    }
    if(ext)w.uint(0,2); // No variable-length IO values in this simulator profile.
  }
  w.uint(records.length,1);const body=w.output(),packet=new Writer();
  if(body.length+12>1280)throw Error('Packet exceeds the 1280-byte FMC profile limit; split the batch');
  packet.uint(0,4);packet.uint(body.length,4);packet.bytes(body);packet.uint(crc16(body),4);
  return packet.output();
}
export const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
