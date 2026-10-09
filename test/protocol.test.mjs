import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {encodePacket,encodeImei,crc16,hex} from '../web/codec.js';
import {TeltonikaClient} from '../bridge/teltonika.mjs';
const record={timestamp:Number(0x0000016b40d9ad80n),priority:1,gps:{longitude:0,latitude:0,altitude:0,angle:0,satellites:0,speed:0},eventIoId:1,io:[{id:21,bytes:1,value:3},{id:1,bytes:1,value:1},{id:66,bytes:2,value:24080}]};
test('Codec 8 encoder matches Teltonika published second example byte for byte',()=>{
  const expected='000000000000002808010000016b40d9ad80010000000000000000000000000000000103021503010101425e100000010000f22a';
  assert.equal(hex(encodePacket([record],'8')),expected);
});
test('CRC-16/IBM standard check vector',()=>assert.equal(crc16(new TextEncoder().encode('123456789')),0xbb3d));
test('IMEI handshake matches the published example',()=>assert.equal(hex(encodeImei('356307042441013')),'000f333536333037303432343431303133'));
test('Codec 8E encodes signed GPS and two-byte IO IDs/counts',()=>{
  const r={...record,gps:{longitude:-139.7,latitude:-35.6,altitude:-10,angle:359,satellites:12,speed:48},eventIoId:300,io:[{id:300,bytes:1,value:1},{id:16,bytes:4,value:12345},{id:500,bytes:8,value:'18446744073709551615'}]};
  const frame=Buffer.from(encodePacket([r],'8e'));assert.equal(frame[8],0x8e);assert.equal(frame[9],1);
  assert.equal(frame.readInt32BE(19),-1397000000);assert.equal(frame.readInt32BE(23),-356000000);assert.equal(frame.readInt16BE(27),-10);assert.equal(frame.readUInt16BE(29),359);assert.equal(frame.readUInt16BE(32),48);
  assert.equal(frame.readUInt16BE(34),300);assert.equal(frame.readUInt16BE(36),3);assert.equal(frame.readUInt16BE(38),1);assert.equal(frame.readUInt16BE(40),300);assert.equal(frame[42],1);
  assert.equal(frame.readUInt16BE(frame.length-7),0); // NX count
  assert.equal(frame[frame.length-5],1);assert.equal(crc16(frame.subarray(8,-4)),frame.readUInt32BE(frame.length-4));
});
test('Rejects invalid IMEI, unsupported codec, unsafe GPS and IO values',()=>{
  assert.throws(()=>encodeImei('123'));assert.throws(()=>encodePacket([record],'9'));
  assert.throws(()=>encodePacket([{...record,gps:{...record.gps,longitude:181}}]));
  assert.throws(()=>encodePacket([{...record,io:[{id:239,bytes:1,value:256}]}]));
  assert.throws(()=>encodePacket([{...record,eventIoId:300}],'8'));
});
async function receiver(t,handler) {
  const sockets=new Set(),server=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0),authenticated=false;
    socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length){if(!authenticated){if(buffer.length<17)return;assert.equal(buffer.readUInt16BE(0),15);assert.equal(buffer.subarray(2,17).toString(),'356307042441013');buffer=buffer.subarray(17);authenticated=true;handler({socket,handshake:true});}else{if(buffer.length<8)return;const size=buffer.readUInt32BE(4)+12;if(buffer.length<size)return;const packet=buffer.subarray(0,size);buffer=buffer.subarray(size);handler({socket,packet});}}});
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{for(const s of sockets)s.destroy();server.close();});return server.address().port;
}
test('TCP sends the IMEI and AVL frame and accepts a fragmented four-byte ACK',async t=>{
  const port=await receiver(t,({socket,handshake,packet})=>{if(handshake)return socket.write(Buffer.from([1]));assert.equal(hex(packet),hex(encodePacket([record],'8')));socket.write(Buffer.from([0,0]));setTimeout(()=>socket.write(Buffer.from([0,1])),15);});
  const client=new TeltonikaClient({host:'127.0.0.1',port,imei:'356307042441013',codec:'8'});t.after(()=>client.close());await client.connect();assert.deepEqual(await client.send([record]),{accepted:1,bytes:52,attempts:1});
});
test('Mismatched record count retransmits the identical frame',async t=>{
  const packets=[];const port=await receiver(t,({socket,handshake,packet})=>{if(handshake)return socket.write(Buffer.from([1]));packets.push(Buffer.from(packet));socket.write(Buffer.from([0,0,0,packets.length===1?0:1]));});
  const client=new TeltonikaClient({host:'127.0.0.1',port,imei:'356307042441013',codec:'8e'});t.after(()=>client.close());await client.connect();const result=await client.send([record]);assert.equal(result.attempts,2);assert.deepEqual(packets[0],packets[1]);
});
test('IMEI rejection is reported and closes the connection',async t=>{
  const port=await receiver(t,({socket})=>socket.write(Buffer.from([0])));const client=new TeltonikaClient({host:'127.0.0.1',port,imei:'356307042441013'});t.after(()=>client.close());await assert.rejects(client.connect(),/rejected IMEI/);assert.equal(client.closed,true);
});
test('Missing ACK times out instead of claiming successful delivery',async t=>{
  const port=await receiver(t,({socket,handshake})=>{if(handshake)socket.write(Buffer.from([1]));});const client=new TeltonikaClient({host:'127.0.0.1',port,imei:'356307042441013',timeout:80});t.after(()=>client.close());await client.connect();await assert.rejects(client.send([record]),/acknowledgement timed out/);assert.equal(client.closed,true);
});
test('Permanent ACK mismatch fails after three attempts',async t=>{
  let count=0;const port=await receiver(t,({socket,handshake})=>{if(handshake)return socket.write(Buffer.from([1]));count++;socket.write(Buffer.alloc(4));});const client=new TeltonikaClient({host:'127.0.0.1',port,imei:'356307042441013'});t.after(()=>client.close());await client.connect();await assert.rejects(client.send([record]),/3 attempts/);assert.equal(count,3);
});
