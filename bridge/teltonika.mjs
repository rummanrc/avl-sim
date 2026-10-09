import net from 'node:net';
import { encodeImei,encodePacket } from '../web/codec.js';
export class TeltonikaClient {
  constructor({host,port,imei,codec='8e',timeout=5000}) {
    if(typeof host!=='string'||!host.trim()||host.length>253||/[\s/]/.test(host))throw Error('Enter a hostname or IP address');
    if(!Number.isInteger(port)||port<1||port>65535)throw Error('Port must be 1–65535');
    encodeImei(imei);if(!['8','8e'].includes(codec))throw Error('Unsupported codec');
    Object.assign(this,{host,port,imei,codec,timeout});this.buffer=Buffer.alloc(0);this.pending=null;this.closed=false;
  }
  async connect() {
    this.socket=net.createConnection({host:this.host,port:this.port});
    this.socket.on('data',chunk=>{this.buffer=Buffer.concat([this.buffer,chunk]);this.flush();});
    this.socket.on('error',error=>this.fail(error));
    this.socket.on('close',()=>this.fail(Error('Receiver disconnected')));
    await new Promise((resolve,reject)=> {
      const timer=setTimeout(()=>{reject(Error('TCP connection timed out'));this.close();},this.timeout);
      const cleanup=()=>{clearTimeout(timer);this.socket.off('error',onError);};
      const onError=e=>{cleanup();reject(e);};this.socket.once('error',onError);
      this.socket.once('connect',()=>{cleanup();resolve();});
    });
    const reply=this.read(1);this.socket.write(encodeImei(this.imei));
    if((await reply)[0]!==1){this.close();throw Error('Receiver rejected IMEI');}
    this.ready=true;
  }
  read(size) {
    if(this.closed)return Promise.reject(Error('Connection closed'));
    if(this.pending)return Promise.reject(Error('Only one request may be in flight'));
    return new Promise((resolve,reject)=> {
      const timer=setTimeout(()=>{this.pending=null;reject(Error('Receiver acknowledgement timed out'));this.close();},this.timeout);
      this.pending={size,resolve,reject,timer};this.flush();
    });
  }
  flush(){if(this.pending && this.buffer.length>=this.pending.size){const p=this.pending;this.pending=null;clearTimeout(p.timer);const reply=this.buffer.subarray(0,p.size);this.buffer=this.buffer.subarray(p.size);p.resolve(reply);}}
  fail(error){this.closed=true;this.ready=false;if(this.pending){const p=this.pending;this.pending=null;clearTimeout(p.timer);p.reject(error);}}
  close(){this.fail(Error('Connection closed'));this.socket?.destroy();}
  async send(records) {
    if(!this.ready)throw Error('Connect to the receiver first');
    if(this.busy)throw Error('A packet is already awaiting acknowledgement');
    const packet=encodePacket(records,this.codec);this.busy=true;
    try {
      for(let attempt=0;attempt<3;attempt++) {
        const reply=this.read(4);this.socket.write(packet);const accepted=(await reply).readUInt32BE(0);
        if(accepted===records.length)return {accepted,bytes:packet.length,attempts:attempt+1};
      }
      this.close();throw Error('Receiver did not acknowledge all records after 3 attempts');
    }finally{this.busy=false;}
  }
}
