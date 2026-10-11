import {distance,sweptClear} from './geometry.js';

const heading=(a,b)=>Math.atan2(b.x-a.x,a.z-b.z);
export const angleDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
const eventNames={speeding:'Speeding',acceleration:'Harsh acceleration',braking:'Harsh braking'};

export function validateRun({distanceMetres,events=[],speedLimit=60}) {
  if(!Number.isFinite(distanceMetres)||distanceMetres<100||distanceMetres>100000)throw Error('Choose a distance between 0.1 and 100 km.');
  if(!Number.isFinite(speedLimit)||speedLimit<40||speedLimit>120)throw Error('Choose a test speed limit between 40 and 120 km/h.');
  if(!Array.isArray(events)||events.some(e=>!Object.hasOwn(eventNames,e))||new Set(events).size!==events.length)throw Error('Choose each supported event at most once.');
  const peak=(speedLimit+20)/3.6,cruise=Math.min(35,speedLimit-10)/3.6;
  const minimum=events.includes('speeding')?Math.max(500,Math.ceil((30+(peak**2-cruise**2)/3.6+peak*3+peak**2/3+(events.length-1)*50)/100)*100):events.length?500:100;
  if(distanceMetres<minimum)throw Error(`This event selection needs at least ${(minimum/1000).toFixed(1)} km to perform the events and stop gently.`);
  return {distanceMetres,events:[...events],speedLimit};
}

export function buildRoadGraph(segments) {
  const nodes=new Map(),key=p=>p.x.toFixed(2)+','+p.z.toFixed(2);
  const node=p=>{const k=key(p);if(!nodes.has(k))nodes.set(k,{...p,key:k,edges:[]});return nodes.get(k);};
  for(const segment of segments){if(segment.width<9)continue;const a=node(segment.a),b=node(segment.b),length=distance(a,b);if(length<.1)continue;
    if(!a.edges.some(e=>e.to===b)){a.edges.push({to:b,length,segment});b.edges.push({to:a,length,segment});}
  }
  // Remove dead-end branches: repeatable runs should never have to spin in place.
  const queue=[...nodes.values()].filter(n=>n.edges.length<2);
  for(let i=0;i<queue.length;i++){const n=queue[i];if(!nodes.has(n.key))continue;nodes.delete(n.key);for(const e of n.edges){e.to.edges=e.to.edges.filter(edge=>edge.to!==n);if(e.to.edges.length<2)queue.push(e.to);}}
  return nodes;
}

export function smoothRoadPath(raw) {
  const points=[];
  function add(p){const last=points.at(-1);if(last&&distance(last,p)<1e-5)return;points.push({...p});}
  function line(p){const from=points.at(-1);if(!from){add(p);return;}const steps=Math.max(1,Math.ceil(distance(from,p)/.5));for(let i=1;i<=steps;i++)add(lerp(from,p,i/steps));}
  add(raw[0]);
  for(let i=1;i<raw.length-1;i++){
    const a=raw[i-1],b=raw[i],c=raw[i+1],trim=Math.min(6,distance(a,b)*.35,distance(b,c)*.35);
    const incoming=lerp(b,a,trim/distance(a,b)),outgoing=lerp(b,c,trim/distance(b,c));line(incoming);
    const steps=Math.max(4,Math.ceil(trim*4));for(let j=1;j<=steps;j++){const t=j/steps,u=1-t;add({x:u*u*incoming.x+2*u*t*b.x+t*t*outgoing.x,z:u*u*incoming.z+2*u*t*b.z+t*t*outgoing.z});}
  }
  line(raw.at(-1));let total=0,angle;
  for(let i=0;i<points.length;i++){
    if(i)total+=distance(points[i-1],points[i]);
    const direction=heading(points[Math.max(0,i-1)],points[Math.min(points.length-1,i+1)]);
    angle=angle===undefined?direction:angle+angleDifference(direction,angle);
    Object.assign(points[i],{at:total,angle});
  }
  return {points,length:total};
}

export function routePose(route,at) {
  const points=route.points;at=Math.max(0,Math.min(route.length,at));let lo=0,hi=points.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(points[mid].at<=at)lo=mid;else hi=mid;}
  const a=points[lo],b=points[hi],t=(at-a.at)/(b.at-a.at||1);
  return {...lerp(a,b,t),angle:a.angle+(b.angle-a.angle)*t};
}

export function planRoute(segments,start,distanceMetres,collides,seed=1) {
  const graph=buildRoadGraph(segments);if(!graph.size)throw Error('No connected road loop is available.');
  const choices=[];
  for(const node of graph.values())for(const edge of node.edges){const dx=edge.to.x-node.x,dz=edge.to.z-node.z,t=Math.max(.05,Math.min(.95,((start.x-node.x)*dx+(start.z-node.z)*dz)/(edge.length**2))),point=lerp(node,edge.to,t);
    choices.push({node,edge,point,score:distance(start,point)+Math.abs(angleDifference(heading(node,edge.to),start.angle))*3});}
  choices.sort((a,b)=>a.score-b.score);
  for(let attempt=0;attempt<30;attempt++){
    let randomState=(seed+attempt*7919)>>>0;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
    const entry=choices[Math.min(Math.floor(attempt/6),choices.length-1)],raw=[entry.point,{...entry.edge.to}],visits=new Map();
    let previous=entry.node,current=entry.edge.to,total=distance(entry.point,current),failed=false;
    const seen=new Map([[previous.key+'>'+current.key,1]]),required=distanceMetres*1.5+150;
    for(let count=0;total<distanceMetres*1.5+150&&count<20000;count++){
      const angle=heading(previous,current),options=current.edges.filter(e=>e.to!==previous&&Math.abs(angleDifference(heading(current,e.to),angle))<2.35);
      if(!options.length){failed=true;break;}
      const ranks=options.map(edge=>({edge,score:(visits.get(current.key+'>'+edge.to.key)||0)*5+Math.abs(angleDifference(heading(current,edge.to),angle))*.6+random()*2})).sort((a,b)=>a.score-b.score);
      const edge=ranks[0].edge,k=current.key+'>'+edge.to.key;visits.set(k,(visits.get(k)||0)+1);previous=current;current=edge.to;raw.push({...current});total+=edge.length;
      const transition=previous.key+'>'+current.key;
      if(seen.has(transition)){
        // Reuse a connected loop for long distances within this small map.
        const cycle=raw.slice(seen.get(transition)+1);
        while(total<required){for(const point of cycle){total+=distance(raw.at(-1),point);raw.push({...point});}}
        break;
      }
      seen.set(transition,raw.length-1);
    }
    if(failed||total<distanceMetres+50)continue;
    const route=smoothRoadPath(raw);if(route.length<distanceMetres+20)continue;
    let last=route.points[0];if(collides(last))continue;
    let safe=true;for(const point of route.points){if(point.at>distanceMetres+5)break;if(!sweptClear(last,point,collides)){safe=false;break;}last=point;}
    if(safe)return route;
  }
  throw Error('Could not find a clear route of that length. Try a shorter trip.');
}

export class AutonomousRun {
  constructor(route,options) {
    Object.assign(this,validateRun(options));this.route=route;this.travelled=0;this.done=false;this.blocked=false;this.phase=null;this.nextEvent=0;this.completedEvents=[];this.controls=new Set();this.onEvent=()=>{};
    if(route.length<this.distanceMetres)throw Error('The route is shorter than the requested trip.');
    this.cruise=Math.min(35,this.speedLimit-10)/3.6;
    this.schedule=this.events.map((type,i)=>({type,at:30+i*Math.min(90,this.distanceMetres*.45/Math.max(1,this.events.length))}));
  }
  get status() {
    if(this.blocked)return 'Stopped · route blocked';if(this.done)return 'Complete · engine off';
    return this.phase?eventNames[this.phase.type]+(this.phase.stage==='recover'?' · returning to cruise':''):'Following Shibuya roads';
  }
  advance(state,dt,collides) {
    const oldSpeed=state.speed;this.controls.clear();state.nitroActive=false;
    if(this.done||this.blocked||state.paused||!state.ignition){state.acceleration=0;return {clear:!this.blocked,oldSpeed};}
    if(!this.phase&&this.nextEvent<this.schedule.length&&this.travelled>=this.schedule[this.nextEvent].at){this.phase={...this.schedule[this.nextEvent++],stage:'perform',hold:0,reported:false};}
    const remaining=this.distanceMetres-this.travelled,phase=this.phase,performing=phase?.stage==='perform';
    let target=this.cruise,acceleration=1.8,deceleration=1.5;
    // Read the curvature ahead so calm trips approach junctions gently.
    for(let ahead=5;ahead<=35;ahead+=5){const a=routePose(this.route,this.travelled+ahead),b=routePose(this.route,this.travelled+ahead+2),curve=Math.abs(angleDifference(b.angle,a.angle))/2;
      const bend=curve>.001?Math.sqrt(1.8/curve):this.cruise;target=Math.min(target,Math.sqrt(bend*bend+2*1.5*Math.max(0,ahead-3)));}
    if(performing){
      if(phase.type==='speeding'){target=(this.speedLimit+20)/3.6;}
      if(phase.type==='acceleration'){target=Math.min(this.cruise*3.6+20,this.speedLimit-3)/3.6;acceleration=6;}
      if(phase.type==='braking'){target=5/3.6;deceleration=8;}
    }
    // Predict the next-frame stopping envelope to avoid overshoot or a final snap.
    target=Math.min(target,Math.max(0,Math.sqrt((1.5*dt)**2+2*1.5*remaining)-1.5*dt));
    const speed=Math.max(0,oldSpeed+Math.max(-deceleration*dt,Math.min(acceleration*dt,target-oldSpeed)));
    const move=Math.min(remaining,(oldSpeed+speed)*dt/2),next=routePose(this.route,this.travelled+move);
    if(!sweptClear(state,next,collides)){this.blocked=true;state.speed=0;state.acceleration=0;return {clear:false,oldSpeed};}
    Object.assign(state,next,{speed,acceleration:(speed-oldSpeed)/dt});state.odometer+=move;this.travelled+=move;
    if(state.acceleration>.2)this.controls.add('KeyW');if(state.acceleration<-.2)this.controls.add('KeyS');
    if(performing){
      const reached=phase.type==='braking'?speed<=5/3.6+.02:phase.type==='speeding'?speed>=(this.speedLimit+20)/3.6-.02:speed>=target-.02;
      if(reached){if(!phase.reported){phase.reported=true;this.onEvent({type:phase.type,label:eventNames[phase.type],speed:speed*3.6});}phase.hold+=dt;}
      if(phase.hold>=(phase.type==='speeding'?3:.35)){phase.stage='recover';this.completedEvents.push(phase.type);}
    }
    if(phase?.stage==='recover'&&!performing&&Math.abs(speed-target)<.15)this.phase=null;
    if(remaining-move<.001&&speed<.05){state.odometer+=this.distanceMetres-this.travelled;this.travelled=this.distanceMetres;Object.assign(state,routePose(this.route,this.travelled),{speed:0,acceleration:0});this.done=true;}
    return {clear:true,oldSpeed};
  }
}
