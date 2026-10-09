// Development receiver: verifies framing and CRC, accepts IMEI, ACKs each packet.
import net from 'node:net';
import {crc16} from '../web/codec.js';
const port=Number(process.env.RECEIVER_PORT||5027);
net.createServer(socket=>{
  let buffer=Buffer.alloc(0),imei;
  socket.on('error',e=>console.error('Receiver socket:',e.message));
  socket.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length) {
      if(!imei){if(buffer.length<2)return;const len=buffer.readUInt16BE(0);if(len!==15){socket.destroy();return;}if(buffer.length<2+len)return;imei=buffer.subarray(2,2+len).toString();if(!/^\d{15}$/.test(imei)){socket.end(Buffer.from([0]));return;}buffer=buffer.subarray(2+len);console.log('IMEI accepted:',imei);socket.write(Buffer.from([1]));}
      else {if(buffer.length<8)return;const length=buffer.readUInt32BE(4);if(length>1280||length<3||buffer.readUInt32BE(0)!==0){socket.destroy();return;}if(buffer.length<length+12)return;const packet=buffer.subarray(0,length+12),body=packet.subarray(8,8+length);buffer=buffer.subarray(length+12);if(crc16(body)!==packet.readUInt32BE(8+length)||body[1]!==body.at(-1)){socket.destroy();return;}const ack=Buffer.alloc(4);ack.writeUInt32BE(body[1]);socket.write(ack);console.log(JSON.stringify({imei,codec:body[0].toString(16),records:body[1],bytes:packet.length,timestamp:Number(body.readBigUInt64BE(2)),longitude:body.readInt32BE(11)/1e7,latitude:body.readInt32BE(15)/1e7,speed:body.readUInt16BE(24)}));}
    }
  });
}).listen(port,'127.0.0.1',()=>console.log(`Test Teltonika receiver listening on localhost:${port}`));
