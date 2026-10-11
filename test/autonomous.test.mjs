import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AutonomousRun,planRoute,smoothRoadPath,routePose,validateRun,buildRoadGraph} from '../web/autonomous.js';
import {project,roadWidths,createCollisionTester,boundsOf,distance,unproject} from '../web/geometry.js';
import {nearestSegment} from '../web/world.js';
import {History} from '../receiver/history.mjs';

const data=JSON.parse(await readFile(new URL('../web/data/world.json',import.meta.url))),segments=[];
for(const way of data.ways){if(!roadWidths[way.tags.highway]||way.tags.access==='private'||way.tags.motor_vehicle==='no')continue;const points=way.points.map(project);for(let i=1;i<points.length;i++)segments.push({a:points[i-1],b:points[i],width:roadWidths[way.tags.highway]});}
const min=project([data.bbox[1],data.bbox[2]]),max=project([data.bbox[3],data.bbox[0]]);
const collides=createCollisionTester(data.buildings.map(b=>({...b,...boundsOf(b.rings[0])})),{minX:min.x,maxX:max.x,minZ:min.z,maxZ:max.z});
const spawn=nearestSegment({x:-35,z:65},segments.filter(s=>s.width>=12)),start={...spawn.point,angle:Math.atan2(spawn.b.x-spawn.a.x,-(spawn.b.z-spawn.a.z))+Math.PI};
const route=planRoute(segments,start,1000,collides,7);
function simulate(options){const run=new AutonomousRun(route,options),state={...route.points[0],speed:0,odometer:0,ignition:true},events=[];run.onEvent=e=>events.push(e);let peak=0,maxAccel=0,maxBrake=0,ticks=0;
  for(;ticks<30000&&!run.done&&!run.blocked;ticks++){run.advance(state,1/30,collides);peak=Math.max(peak,state.speed*3.6);maxAccel=Math.max(maxAccel,state.acceleration);maxBrake=Math.max(maxBrake,-state.acceleration);}
  assert.equal(run.blocked,false);assert.equal(run.done,true);assert.equal(run.travelled,options.distanceMetres);assert.ok(Math.abs(state.odometer-options.distanceMetres)<1e-7);assert.equal(state.speed,0);
  return {run,state,events,peak,maxAccel,maxBrake,ticks};
}
test('Calm autonomous trips finish the requested distance without harsh speed changes or speeding',()=>{
  for(const distanceMetres of [100,500,1000]){const result=simulate({distanceMetres,events:[],speedLimit:60});assert.equal(result.events.length,0);assert.ok(result.peak<=35.01);assert.ok(result.maxAccel<=1.81);assert.ok(result.maxBrake<=1.51);}
});
test('Each selected event is performed once, and unselected events remain absent',()=>{
  for(const events of [['speeding'],['acceleration'],['braking'],['acceleration','speeding','braking']]){
    const result=simulate({distanceMetres:500,events,speedLimit:60});assert.deepEqual(result.run.completedEvents,events);assert.deepEqual(result.events.map(e=>e.type),events);
    assert.ok(events.includes('speeding')?result.peak>79:result.peak<60);
    assert.ok(events.includes('acceleration')?result.maxAccel>5.9:result.maxAccel<4);
    assert.ok(events.includes('braking')?result.maxBrake>7.9:result.maxBrake<3);
  }
});
test('A different test limit controls cruise and the selected overspeed peak',()=>{const calm=simulate({distanceMetres:500,events:[],speedLimit:40});assert.ok(calm.peak<=30.01);assert.throws(()=>validateRun({distanceMetres:500,events:['speeding'],speedLimit:90}),/at least 0.7 km/);const fast=simulate({distanceMetres:1000,events:['speeding'],speedLimit:90});assert.ok(fast.peak>=109.9);assert.deepEqual(fast.run.completedEvents,['speeding']);});
test('Pause preserves progress and speed; resume continues on the same route',()=>{
  const run=new AutonomousRun(route,{distanceMetres:500}),state={...route.points[0],speed:0,odometer:0,ignition:true};for(let i=0;i<120;i++)run.advance(state,1/60,collides);
  const before={...state},progress=run.travelled;state.paused=true;for(let i=0;i<60;i++)run.advance(state,1/60,collides);assert.equal(run.travelled,progress);assert.equal(state.x,before.x);assert.equal(state.speed,before.speed);
  state.paused=false;run.advance(state,1/60,collides);assert.ok(run.travelled>progress);
});
test('A new obstacle blocks the run without moving through it',()=>{
  const run=new AutonomousRun(route,{distanceMetres:500}),state={...route.points[0],speed:5,odometer:0,ignition:true},before={...state};run.advance(state,1/60,()=>true);assert.equal(run.blocked,true);assert.equal(state.x,before.x);assert.equal(state.z,before.z);assert.equal(run.travelled,0);assert.equal(state.speed,0);
});
test('Long trips reuse connected road loops and remain clear on the actual map',()=>{
  const long=planRoute(segments,start,100000,collides,2);assert.ok(long.length>=100000);for(let at=0;at<=100000;at+=10)assert.equal(collides(routePose(long,at)),false);
});
test('Road graph excludes narrow roads and prunes dead ends',()=>{
  const p=[{x:0,z:0},{x:20,z:0},{x:20,z:20},{x:0,z:20}],roads=p.map((a,i)=>({a,b:p[(i+1)%4],width:9}));roads.push({a:p[0],b:{x:-20,z:0},width:9},{a:p[0],b:{x:-20,z:20},width:7});const graph=buildRoadGraph(roads);assert.equal(graph.size,4);assert.ok([...graph.values()].every(n=>n.edges.length===2));
});
test('Rounded route changes heading continuously across north, and rejects invalid run settings',()=>{
  const curve=smoothRoadPath([{x:-1,z:20},{x:0,z:0},{x:1,z:-20}]);for(let i=1;i<curve.points.length;i++)assert.ok(Math.abs(curve.points[i].angle-curve.points[i-1].angle)<.2);
  for(const options of [{distanceMetres:0},{distanceMetres:100001},{distanceMetres:100,events:['braking']},{distanceMetres:500,events:['unknown']},{distanceMetres:500,events:['braking','braking']},{distanceMetres:500,speedLimit:NaN}])assert.throws(()=>validateRun(options));
  assert.throws(()=>planRoute([{a:{x:0,z:0},b:{x:10,z:0},width:9}],start,500,()=>false),/connected road loop/);
});
test('Autonomous calm GPS stream forms a completed receiver trip with no events',()=>{
  const run=new AutonomousRun(route,{distanceMetres:500}),state={...route.points[0],speed:0,odometer:0,ignition:false},records=[];let now=1700000000000;
  const record=()=>({timestamp:now,priority:0,gps:{...unproject(state),altitude:32,angle:0,satellites:12,speed:Math.round(state.speed*3.6)},eventIoId:0,io:[{id:239,bytes:1,value:Number(state.ignition)}]});
  records.push(record());state.ignition=true;now+=100;records.push(record());
  for(let i=0;i<30000&&!run.done;i++){run.advance(state,1/30,collides);now+=1000/30;if(i%30===0)records.push(record());}
  state.ignition=false;records.push(record());const history=new History();history.apply({type:'records',imei:'356307042441013',codec:'8',receivedAt:now,records});const trip=history.devices.get('356307042441013').trips[0];assert.equal(trip.status,'completed');assert.equal(trip.incompleteStart,false);assert.equal(trip.events.length,0);assert.ok(trip.distance>480&&trip.distance<505);assert.ok(distance(state,routePose(route,500))<.001);
});
