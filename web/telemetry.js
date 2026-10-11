// All deadlines are in simulated time. Physics uses the same clock.
export const timingPresets={
  live:{collectOn:2,sendOn:2,collectOff:300,sendOff:3600,scale:1},
  device:{collectOn:2,sendOn:300,collectOff:300,sendOff:3600,scale:1},
  fast:{collectOn:2,sendOn:300,collectOff:300,sendOff:3600,scale:12}
};
export function validateTiming(settings){
  const result={...settings};
  for(const name of ['collectOn','sendOn','collectOff','sendOff']){
    if(!Number.isInteger(result[name])||result[name]<1||result[name]>86400)throw Error('Collection and upload intervals must be 1–86,400 seconds.');
  }
  if(!Number.isInteger(result.scale)||result.scale<1||result.scale>30)throw Error('Simulation speed must be 1–30×.');
  return result;
}
export class DeviceClock{
  constructor(settings=timingPresets.device,start=Date.now()){
    this.settings=validateTiming(settings);this.start=start;this.elapsed=0;this.ignition=false;this.resetDeadlines();
  }
  get timestamp(){return Math.round(this.start+this.elapsed*1000);}
  get collectInterval(){return this.ignition?this.settings.collectOn:this.settings.collectOff;}
  get sendInterval(){return this.ignition?this.settings.sendOn:this.settings.sendOff;}
  resetDeadlines(){this.nextCollect=this.elapsed+this.collectInterval;this.nextSend=this.elapsed+this.sendInterval;}
  configure(settings){this.settings=validateTiming(settings);this.resetDeadlines();}
  setIgnition(value){if(this.ignition===value)return;this.ignition=value;this.resetDeadlines();}
  // UI ignition events can occur between physics steps. Preserve their ordering.
  eventTimestamp(){const time=this.timestamp;this.start+=1;return time+1;}
  step(dt){this.elapsed+=dt;}
  collectDue(){if(this.elapsed+1e-8<this.nextCollect)return false;do{this.nextCollect+=this.collectInterval;}while(this.nextCollect<=this.elapsed+1e-8);return true;}
  sendDue(){if(this.elapsed+1e-8<this.nextSend)return false;do{this.nextSend+=this.sendInterval;}while(this.nextSend<=this.elapsed+1e-8);return true;}
  sentNow(){this.nextSend=this.elapsed+this.sendInterval;}
}
export class RecordBuffer{
  constructor(limit=100000){this.records=[];this.limit=limit;}
  get length(){return this.records.length;}
  add(record){if(this.length>=this.limit)throw Error('Upload buffer is full. Connect and send pending records to continue.');this.records.push(record);}
  batch(count=10){return this.records.slice(0,count);}
  acknowledge(batch,count){
    if(count!==batch.length)throw Error('Receiver did not acknowledge the complete batch.');
    if(batch.some((r,i)=>this.records[i]!==r))throw Error('Upload buffer changed before acknowledgement.');
    this.records.splice(0,batch.length);
  }
}
