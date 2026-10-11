import {createHash} from 'node:crypto';
export const defaultRules={speedLimit:60,harshBraking:3,harshAcceleration:4,maxSampleGap:10};
export function validateRules(r){const result={...defaultRules,...r};for(const [key,min,max]of [['speedLimit',1,300],['harshBraking',.1,30],['harshAcceleration',.1,30],['maxSampleGap',.1,300]])if(!Number.isFinite(result[key])||result[key]<min||result[key]>max)throw Error(`Invalid ${key}: expected ${min}–${max}`);return Object.fromEntries(Object.keys(defaultRules).map(k=>[k,result[k]]));}
const io=(r,id)=>r.io.find(i=>i.id===id)?.value;
const gpsValid=r=>r.gps.satellites>0;
const haversine=(a,b)=>{const rad=Math.PI/180,dLat=(b.latitude-a.latitude)*rad,dLon=(b.longitude-a.longitude)*rad;const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(h)));};
export class History {
  constructor(){this.rules={...defaultRules};this.devices=new Map();this.revision=0;}
  apply(entry){if(entry.type==='rules'){this.rules=validateRules(entry.rules);this.revision++;return;}
    if(entry.type!=='records')throw Error('Unknown history entry');let device=this.devices.get(entry.imei);if(!device){device={imei:entry.imei,records:[],seen:new Set(),trips:[],events:[],receivedAt:0};this.devices.set(entry.imei,device);}
    let added=0;for(const record of entry.records){const key=createHash('sha256').update(JSON.stringify(record)).digest('hex');if(device.seen.has(key))continue;device.seen.add(key);device.records.push({...record,key,rules:{...this.rules}});added++;}
    device.receivedAt=entry.receivedAt;device.codec=entry.codec;device.records.sort((a,b)=>a.timestamp-b.timestamp);if(added)this.rebuild(device);this.revision++;
  }
  rebuild(device){const trips=[],events=[];let trip=null,lastIgnition,previousOffAt=null,previous,overspeed=false,harsh={braking:false,acceleration:false},lastHarsh={braking:-Infinity,acceleration:-Infinity};
    for(const r of device.records){const raw=io(r,239),ignition=raw===0||raw===1?raw:lastIgnition;
      if(ignition===1&&lastIgnition!==1){trip={id:device.imei+'-'+r.key.slice(0,16),imei:device.imei,startAt:r.timestamp,endAt:null,previousOffAt,incompleteStart:lastIgnition!==0,status:'active',points:[],events:[],distance:0,maxSpeed:0};trips.push(trip);previous=null;overspeed=false;harsh={braking:false,acceleration:false};lastHarsh={braking:-Infinity,acceleration:-Infinity};}
      if(trip){trip.maxSpeed=Math.max(trip.maxSpeed,r.gps.speed);const point={timestamp:r.timestamp,...r.gps,ignition:ignition??null};if(gpsValid(r)){const last=trip.points.at(-1);if(last&&r.timestamp-last.timestamp<=120000)trip.distance+=haversine(last,r.gps);trip.points.push(point);}
        const event=(type,measured,threshold,unit,source)=>{const e={id:trip.id+'-'+r.key.slice(0,12)+'-'+type,type,timestamp:r.timestamp,latitude:r.gps.latitude,longitude:r.gps.longitude,hasFix:gpsValid(r),speed:r.gps.speed,measured:measured===null?null:Number(measured.toFixed(2)),threshold,unit,source};trip.events.push(e);events.push(e);};
        if(ignition===1&&gpsValid(r)){
          if(r.gps.speed>r.rules.speedLimit&&!overspeed){event('speeding',r.gps.speed,r.rules.speedLimit,'km/h','GPS');overspeed=true;}else if(r.gps.speed<=Math.max(0,r.rules.speedLimit-3))overspeed=false;
          const dt=previous?(r.timestamp-previous.timestamp)/1000:0,delta=dt>0&&dt<=r.rules.maxSampleGap&&gpsValid(previous)?(r.gps.speed-previous.gps.speed)/3.6/dt:null;
          const reportType=r.eventIoId===253?Number(io(r,253)):0,reportValue=Number(io(r,254));
          for(const [name,type,threshold]of [['braking',2,r.rules.harshBraking],['acceleration',1,r.rules.harshAcceleration]]){
            const reported=reportType===type,estimate=delta===null?null:(name==='braking'?-delta:delta);const measured=reported?(Number.isFinite(reportValue)?reportValue/100*9.80665:null):estimate;const eligible=reported||Math.max(r.gps.speed,previous?.gps.speed||0)>=10;const exceeds=eligible&&((reported&&measured===null)||(measured!==null&&measured>=threshold));
            if(exceeds&&(reported||!harsh[name])&&r.timestamp-lastHarsh[name]>=2000){event('harsh_'+name,measured,threshold,'m/s²',reported?(Number.isFinite(reportValue)?'Device IO 253/254':'Device IO 253'):'GPS estimate');lastHarsh[name]=r.timestamp;}harsh[name]=exceeds||(harsh[name]&&measured!==null&&measured>=threshold*.8);
          }
          if(reportType===3)event('harsh_cornering',Number.isFinite(reportValue)?reportValue/100:null,0,'rad/s','Device IO 253/254');
        }
        if(ignition===0){trip.endAt=r.timestamp;trip.status='completed';trip=null;previous=null;overspeed=false;}else previous=r;
      }
      if(ignition===0)previousOffAt=r.timestamp;if(ignition!==undefined)lastIgnition=ignition;
    }
    device.trips=trips;device.events=events;device.latest=device.records.at(-1);
  }
  snapshot(){return {revision:this.revision,rules:this.rules,devices:[...this.devices.values()].map(d=>({imei:d.imei,codec:d.codec,receivedAt:d.receivedAt,recordCount:d.records.length,tripCount:d.trips.length,eventCount:d.events.length,latest:d.latest?{timestamp:d.latest.timestamp,gps:d.latest.gps,ignition:io(d.latest,239)??null}:null})),trips:[...this.devices.values()].flatMap(d=>d.trips.map(t=>({...t,points:undefined,events:undefined,pointCount:t.points.length,eventCount:t.events.length,lastAt:t.points.at(-1)?.timestamp??t.startAt}))).sort((a,b)=>b.startAt-a.startAt)};}
  trip(id){for(const d of this.devices.values()){const t=d.trips.find(t=>t.id===id);if(t)return t;}return null;}
}
