import * as T from './vendor/three.module.js';
import {advanceCar} from './driving.js';
import {project,unproject,distance,roadWidths,pointInRing as inPoly,boundsOf,createCollisionTester} from './geometry.js';
export {project,unproject,distance} from './geometry.js';
export function nearestSegment(point,segments) {
  let nearest={distance:Infinity};
  for(const s of segments) {
    const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len2=dx*dx+dz*dz;
    const t=Math.max(0,Math.min(1,((point.x-s.a.x)*dx+(point.z-s.a.z)*dz)/len2));
    const p={x:s.a.x+dx*t,z:s.a.z+dz*t},d=distance(point,p);
    if(d<nearest.distance)nearest={...s,point:p,distance:d};
  }
  return nearest;
}
function merge(geos) {
  const ps=[],ns=[];
  for(const original of geos){const g=original.index?original.toNonIndexed():original;ps.push(...g.attributes.position.array);ns.push(...g.attributes.normal.array);if(g!==original)g.dispose();original.dispose();}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(ps,3));g.setAttribute('normal',new T.Float32BufferAttribute(ns,3));g.computeBoundingSphere();return g;
}
function strips(segments,widthExtra,y,color,scene,markings=false) {
  const vertices=[];
  function quad(a,b,width){const len=distance(a,b);if(len<.01)return;const dx=-(b.z-a.z)/len*width/2,dz=(b.x-a.x)/len*width/2;vertices.push(a.x+dx,y,a.z+dz,a.x-dx,y,a.z-dz,b.x+dx,y,b.z+dz,b.x+dx,y,b.z+dz,a.x-dx,y,a.z-dz,b.x-dx,y,b.z-dz);}
  for(const s of segments) {
    if(markings){if(s.width<11)continue;const len=distance(s.a,s.b);for(let at=2;at<len-4;at+=9){const t=at/len,u=Math.min(at+4,len)/len;quad({x:s.a.x+(s.b.x-s.a.x)*t,z:s.a.z+(s.b.z-s.a.z)*t},{x:s.a.x+(s.b.x-s.a.x)*u,z:s.a.z+(s.b.z-s.a.z)*u},.18);}}
    else quad(s.a,s.b,s.width+widthExtra);
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.computeVertexNormals();scene.add(new T.Mesh(g,new T.MeshLambertMaterial({color,side:T.DoubleSide})));
}
export function makeWorld(canvas,data) {
  const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0xcbd7cf);
  const scene=new T.Scene();scene.fog=new T.Fog(0xcbd7cf,170,470);
  const camera=new T.PerspectiveCamera(52,1,.1,2400);
  scene.add(new T.HemisphereLight(0xf9f3d9,0x828b77,1.8));
  const sun=new T.DirectionalLight(0xfff2d6,1.6);sun.position.set(-200,400,120);scene.add(sun);
  const ground=new T.Mesh(new T.PlaneGeometry(3600,3600),new T.MeshLambertMaterial({color:0xbfc5ae}));ground.rotation.x=-Math.PI/2;ground.position.y=-.2;scene.add(ground);
  const segments=[],walks=[],buildings=[],buildingGroups=Array.from({length:6},()=>[]),colors=[0xe0d7bd,0xb6bba6,0xc4bfac,0xd6c4b2,0xa6b3a4,0xdcd7c7];
  const min=project([data.bbox[1],data.bbox[2]]),max=project([data.bbox[3],data.bbox[0]]);
  const bounds={minX:min.x,maxX:max.x,minZ:min.z,maxZ:max.z};
  for(const way of data.ways) {
    const points=way.points.map(project),tags=way.tags;
    if(tags.highway) {
      const width=roadWidths[tags.highway]||3,drivable=!!roadWidths[tags.highway]&&tags.access!=='private'&&tags.motor_vehicle!=='no';
      for(let i=1;i<points.length;i++)if(distance(points[i-1],points[i])>.1)(drivable?segments:walks).push({a:points[i-1],b:points[i],width,name:tags['name:en']||tags.name||'Shibuya side street'});
    }
    if(tags.leisure==='park'||['grass','forest','recreation_ground'].includes(tags.landuse)) {
      if(points.length<4)continue;const shape=new T.Shape(points.map(p=>new T.Vector2(p.x,-p.z)));const mesh=new T.Mesh(new T.ShapeGeometry(shape),new T.MeshLambertMaterial({color:0x9cae8b,side:T.DoubleSide}));mesh.rotation.x=-Math.PI/2;mesh.position.y=.03;scene.add(mesh);
    }
  }
  for(const building of data.buildings) {
    const {rings,tags,id}=building,points=rings[0],box=boundsOf(points);
    const h=Math.max(3,Math.min(100,parseFloat(tags.height)||parseFloat(tags['building:levels'])*3.2||6+(id%8)*3));
    const shape=new T.Shape(points.map(p=>new T.Vector2(p.x,-p.z)));
    for(const hole of rings.slice(1))shape.holes.push(new T.Path(hole.map(p=>new T.Vector2(p.x,-p.z))));
    const geometry=new T.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,steps:1,curveSegments:1});geometry.rotateX(-Math.PI/2);buildingGroups[id%6].push(geometry);
    buildings.push({points,rings,...box});
  }
  strips(segments,3,.04,0xd8d4be,scene);strips(segments,0,.18,0x6e776d,scene);strips(walks,0,.10,0xd9d5c1,scene);strips(segments,0,.23,0xd8d1ab,scene,true);
  const joints=new Map();for(const s of segments)for(const p of [s.a,s.b]){const key=p.x.toFixed(2)+','+p.z.toFixed(2);if(!joints.has(key)||joints.get(key).width<s.width)joints.set(key,{...p,width:s.width});}
  for(const [extra,y,color]of [[3,.055,0xd8d4be],[0,.19,0x6e776d]]){const mesh=new T.InstancedMesh(new T.CircleGeometry(1,10),new T.MeshLambertMaterial({color}),joints.size),dummy=new T.Object3D();let index=0;for(const p of joints.values()){dummy.position.set(p.x,y,p.z);dummy.rotation.x=-Math.PI/2;dummy.scale.setScalar((p.width+extra)/2);dummy.updateMatrix();mesh.setMatrixAt(index++,dummy.matrix);}scene.add(mesh);}
  const trees=[];for(let i=0;i<segments.length;i+=13){const s=segments[i],len=distance(s.a,s.b);if(len<20)continue;const offset=s.width/2+3.5,p={x:(s.a.x+s.b.x)/2-(s.b.z-s.a.z)/len*offset,z:(s.a.z+s.b.z)/2+(s.b.x-s.a.x)/len*offset};if(p.x>bounds.minX&&p.x<bounds.maxX&&p.z>bounds.minZ&&p.z<bounds.maxZ&&!buildings.some(b=>p.x>b.minX&&p.x<b.maxX&&p.z>b.minZ&&p.z<b.maxZ&&inPoly(p,b.points)))trees.push(p);}
  if(trees.length){const tops=new T.InstancedMesh(new T.IcosahedronGeometry(2.2,0),new T.MeshLambertMaterial({color:0x80946b}),trees.length),trunks=new T.InstancedMesh(new T.CylinderGeometry(.2,.25,3.8,5),new T.MeshLambertMaterial({color:0x81715d}),trees.length),dummy=new T.Object3D();trees.forEach((p,i)=>{dummy.position.set(p.x,4.4,p.z);dummy.scale.set(1,1.3,1);dummy.updateMatrix();tops.setMatrixAt(i,dummy.matrix);dummy.position.y=1.9;dummy.scale.set(1,1,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);});scene.add(tops,trunks);}
  // A few merged meshes keep the whole neighborhood inexpensive to draw.
  for(let i=0;i<6;i++)if(buildingGroups[i].length) {
    const material=new T.MeshLambertMaterial({color:colors[i]});
    material.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 vBuildingPos; varying vec3 vBuildingNormal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBuildingPos = position; vBuildingNormal = normal;');
      shader.fragmentShader='varying vec3 vBuildingPos; varying vec3 vBuildingNormal;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat along = abs(vBuildingNormal.x) > 0.6 ? vBuildingPos.z : vBuildingPos.x;\nif(abs(vBuildingNormal.y) < 0.3 && mod(vBuildingPos.y, 3.5) > 1.6 && mod(vBuildingPos.y,3.5) < 2.7 && mod(along,3.2) > 0.8 && mod(along,3.2) < 2.4) diffuseColor.rgb *= 0.66;');
    };
    scene.add(new T.Mesh(merge(buildingGroups[i]),material));
  }
  // Start on an actual main road near the crossing, heading along its geometry.
  const spawn=nearestSegment({x:-35,z:65},segments.filter(s=>s.width>=12));
  const car=new T.Group();
  function box(w,h,d,color,x,y,z){const m=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshLambertMaterial({color}));m.position.set(x,y,z);car.add(m);return m;}
  box(1.85,.7,4,0xe66c3c,0,.85,0);box(1.58,.65,1.9,0xb7cec9,0,1.5,-.2);box(1.64,.12,1.6,0xe66c3c,0,1.88,-.15);box(1.75,.16,.15,0xf3e3bb,0,.95,-2.01);box(1.65,.13,.13,0xa33b29,0,1,2.01);
  const wheels=[];for(const x of [-.92,.92])for(const z of [-1.25,1.2]){const wheel=new T.Mesh(new T.CylinderGeometry(.37,.37,.25,8),new T.MeshLambertMaterial({color:0x354038}));wheel.rotation.z=Math.PI/2;wheel.position.set(x,.45,z);car.add(wheel);wheels.push(wheel);}
  scene.add(car);
  const shadow=new T.Mesh(new T.CircleGeometry(2.5,16),new T.MeshBasicMaterial({color:0x3a4430,transparent:true,opacity:.16,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.scale.x=.6;shadow.position.y=.22;scene.add(shadow);
  const checkpoint=new T.Group();const ring=new T.Mesh(new T.TorusGeometry(4,.4,6,32),new T.MeshBasicMaterial({color:0xe77740}));ring.rotation.x=Math.PI/2;ring.position.y=.35;checkpoint.add(ring);const marker=new T.Mesh(new T.OctahedronGeometry(1.3),new T.MeshLambertMaterial({color:0xee8852}));marker.position.y=7;checkpoint.add(marker);scene.add(checkpoint);
  const state={x:spawn.point.x,z:spawn.point.z,angle:Math.atan2(spawn.b.x-spawn.a.x,-(spawn.b.z-spawn.a.z)),speed:0,odometer:0,ignition:false,nitroCharge:1,nitroActive:false,acceleration:0,paused:false,cityView:false,road:spawn.name};
  const firstTarget=project([139.70045,35.6595]);
  if(Math.sin(state.angle)*(firstTarget.x-state.x)-Math.cos(state.angle)*(firstTarget.z-state.z)<0)state.angle+=Math.PI;
  const start={x:state.x,z:state.z,angle:state.angle};
  const goals=[['Shibuya Crossing',[139.70045,35.6595]],['Jinnan side streets',[139.7003,35.6631]],['The edge of Yoyogi',[139.6975,35.6663]]].map(([name,p])=>({name,...nearestSegment(project(p),segments).point}));
  let goal=0,uiTick=0,onGoal=()=>{},lastSurface=spawn;
  const resize=()=>{const {width,height}=canvas.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();};new ResizeObserver(resize).observe(canvas);resize();
  camera.position.set(state.x-Math.sin(state.angle)*18,11,state.z+Math.cos(state.angle)*18);
  const collision=createCollisionTester(buildings,bounds);
  let onDrivingEvent=()=>{},onImpact=()=>{},eventType=0,eventDuration=0,eventSent=false;
  function update(dt,keys) {
    const {clear,oldSpeed}=advanceCar(state,dt,keys,collision);
    if(!clear&&Math.abs(oldSpeed)>2)onImpact(oldSpeed);
    if(state.paused||!state.ignition){eventType=0;eventDuration=0;eventSent=false;return;}
    const type=clear&&Math.max(Math.abs(oldSpeed),Math.abs(state.speed))*3.6>=10?(state.acceleration>4?1:state.acceleration<-3?2:0):0;
    if(type!==eventType){eventType=type;eventDuration=0;eventSent=false;}
    eventDuration+=dt;
    if(type&&eventDuration>=.2&&!eventSent){eventSent=true;onDrivingEvent({type,acceleration:Math.abs(state.acceleration)});}
    uiTick++;if(uiTick%10===0){lastSurface=nearestSegment(state,segments);state.road=lastSurface.distance<lastSurface.width/2+3?lastSurface.name:'Off the road';}
    if(lastSurface.distance>lastSurface.width/2+3)state.speed*=.98;
    if(goal<goals.length&&distance(state,goals[goal])<18){goal++;onGoal(goal);}
  }
  function render() {
    car.position.set(state.x,.15,state.z);car.rotation.y=-state.angle;shadow.position.x=state.x;shadow.position.z=state.z;
    const target=state.cityView?new T.Vector3(state.x+65,135,state.z+110):new T.Vector3(state.x-Math.sin(state.angle)*18,11,state.z+Math.cos(state.angle)*18);
    camera.position.lerp(target,.07);camera.lookAt(state.x+Math.sin(state.angle)*12,1,state.z-Math.cos(state.angle)*12);
    scene.fog.near=state.cityView?300:170;scene.fog.far=state.cityView?1000:470;
    if(goals[goal]){checkpoint.visible=true;checkpoint.position.set(goals[goal].x,0,goals[goal].z);marker.rotation.y+=.012;}else checkpoint.visible=false;
    renderer.render(scene,camera);
  }
  return {state,segments,walks,buildings,bounds,goals,update,render,get goal(){return goal;},set onGoal(fn){onGoal=fn;},set onDrivingEvent(fn){onDrivingEvent=fn;},set onImpact(fn){onImpact=fn;},reset(){Object.assign(state,start,{speed:0,nitroActive:false});},renderer};
}
