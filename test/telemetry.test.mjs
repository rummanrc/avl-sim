import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DeviceClock,RecordBuffer,timingPresets,validateTiming} from '../web/telemetry.js';
import {advanceCar} from '../web/driving.js';
import {smoothHeading} from '../web/presentation.js';
import {encodePacket} from '../web/codec.js';
import {decodePacket} from '../receiver/decoder.mjs';
import {History} from '../receiver/history.mjs';

test('Driving acquires every 2 simulated seconds but uploads only after 5 minutes',()=>{
  const clock=new DeviceClock(timingPresets.fast,1700000000000);clock.setIgnition(true);let acquired=0,uploaded=0;
  for(let frame=0;frame<25*60;frame++)for(let i=0;i<clock.settings.scale;i++){clock.step(1/60);if(clock.collectDue())acquired++;if(clock.sendDue())uploaded++;if(frame<25*60-1)assert.equal(uploaded,0);}
  assert.equal(acquired,150);assert.equal(uploaded,1);assert.equal(clock.timestamp,1700000300000);
});
test('Engine off acquires every 5 minutes and uploads once per simulated hour',()=>{
  const clock=new DeviceClock(timingPresets.fast,1700000000000);let acquired=0,uploaded=0;
  for(let frame=0;frame<5*60*60;frame++)for(let i=0;i<12;i++){clock.step(1/60);if(clock.collectDue())acquired++;if(clock.sendDue())uploaded++;}
  assert.equal(acquired,12);assert.equal(uploaded,1);assert.equal(clock.timestamp,1700003600000);
});
test('Five minutes at 12× or ten at 6× generates a consistent hour of driving',()=>{
  for(const scale of [6,12]){
    const clock=new DeviceClock({...timingPresets.fast,scale},1700000000000);clock.setIgnition(true);
    const state={x:0,z:0,angle:0,speed:0,ignition:true,odometer:0,nitroCharge:1},keys=new Set(['KeyW']);let collected=0,uploaded=0;
    for(let frame=0;frame<3600/scale*60;frame++)for(let i=0;i<scale;i++){clock.step(1/60);advanceCar(state,1/60,keys,()=>false);if(clock.collectDue())collected++;if(clock.sendDue())uploaded++;}
    assert.equal(clock.timestamp,1700003600000);assert.equal(collected,1800);assert.equal(uploaded,12);assert.ok(state.odometer>79800&&state.odometer<80000);assert.ok(Math.abs(state.odometer+state.z)<1e-6);assert.ok(state.speed*3.6<80.01);
  }
});
test('Profile changes and manual sends reset their deadlines without changing the clock',()=>{
  const clock=new DeviceClock();clock.step(10);clock.setIgnition(true);assert.equal(clock.nextCollect,12);assert.equal(clock.nextSend,310);clock.step(20);clock.sentNow();assert.equal(clock.nextSend,330);
  clock.setIgnition(false);assert.equal(clock.nextCollect,330);assert.equal(clock.nextSend,3630);const now=clock.timestamp;clock.configure({...timingPresets.fast,scale:6});assert.equal(clock.timestamp,now);assert.equal(clock.settings.scale,6);
  const first=clock.eventTimestamp(),second=clock.eventTimestamp();assert.ok(second>first);assert.equal(clock.timestamp,second);
});
test('A delayed, split Codec 8/8E backlog retains capture timestamps and complete trips',()=>{
  for(const codec of ['8','8e']){
    const clock=new DeviceClock(timingPresets.fast,1700000000000),buffer=new RecordBuffer(),state={x:0,z:0,angle:0,speed:0,ignition:false,odometer:0,nitroCharge:1};
    const capture=event=>{const record={timestamp:event?clock.eventTimestamp():clock.timestamp,priority:event?1:0,gps:{longitude:139.7,latitude:35.66-state.z/111320,altitude:32,angle:0,satellites:12,speed:Math.round(state.speed*3.6)},eventIoId:event?239:0,io:[{id:239,bytes:1,value:Number(state.ignition)},{id:16,bytes:4,value:Math.round(state.odometer)}]};buffer.add(record);return record;};
    capture(true);state.ignition=true;clock.setIgnition(true);capture(true);const samples=[];
    for(let frame=0;frame<10*60;frame++)for(let i=0;i<12;i++){clock.step(1/60);advanceCar(state,1/60,new Set(['KeyW']),()=>false);if(clock.collectDue())samples.push(capture(false));assert.equal(clock.sendDue(),false);}
    state.ignition=false;state.speed=0;clock.setIgnition(false);capture(true);
    assert.equal(samples.length,60);assert.ok(state.odometer>2400);assert.equal(samples[1].timestamp-samples[0].timestamp,2000);assert.ok(Math.abs((samples[1].gps.speed-samples[0].gps.speed)/3.6/2-2.5)<.3);
    const history=new History();let delivered=0;while(buffer.length){const batch=buffer.batch(),packet=encodePacket(batch,codec);assert.ok(packet.length<=1280);const decoded=decodePacket(packet);history.apply({type:'records',imei:'356307042441013',codec,receivedAt:1700004000000,records:decoded.records});buffer.acknowledge(batch,decoded.records.length);delivered+=decoded.records.length;}
    assert.equal(delivered,63);const trip=history.devices.get('356307042441013').trips[0];assert.equal(trip.status,'completed');assert.equal(trip.incompleteStart,false);assert.ok(trip.endAt-trip.startAt>=120000);assert.ok(trip.distance>2300);
  }
});
test('Unacknowledged records survive failure, and new records do not alter an in-flight batch',()=>{
  const buffer=new RecordBuffer(3),a={timestamp:1},b={timestamp:2},c={timestamp:3};buffer.add(a);buffer.add(b);const batch=buffer.batch();buffer.add(c);assert.throws(()=>buffer.acknowledge(batch,1),/complete batch/);assert.equal(buffer.length,3);assert.deepEqual(buffer.batch(),[a,b,c]);assert.throws(()=>buffer.add({timestamp:4}),/full/);buffer.acknowledge(batch,2);assert.deepEqual(buffer.batch(),[c]);
});
test('Steering eases reversal and frame-independent heading smoothing follows the shortest turn',()=>{
  const state={x:0,z:0,angle:0,speed:10,ignition:true,odometer:0,nitroCharge:1};advanceCar(state,1/60,new Set(['KeyD']),()=>false);assert.ok(state.steering>0&&state.steering<.2);for(let i=0;i<20;i++)advanceCar(state,1/60,new Set(['KeyD']),()=>false);const before=state.steering;advanceCar(state,1/60,new Set(['KeyA']),()=>false);assert.ok(state.steering<before&&state.steering>0);
  const initial=Math.PI-.01,target=-Math.PI+.01;assert.ok(smoothHeading(initial,target,1/60,.2)>initial);
  let sixty=0,thirty=0;for(let i=0;i<60;i++)sixty=smoothHeading(sixty,1,1/60,.2);for(let i=0;i<30;i++)thirty=smoothHeading(thirty,1,1/30,.2);assert.ok(Math.abs(sixty-thirty)<1e-12);
});
test('Invalid timing values are rejected before changing the active settings',()=>{
  for(const bad of [{scale:0},{scale:31},{scale:1.5},{collectOn:0},{collectOff:NaN},{sendOn:86401},{sendOff:1.5}])assert.throws(()=>validateTiming({...timingPresets.fast,...bad}));
});
