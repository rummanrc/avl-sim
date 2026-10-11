import {GameLoop} from './vendor/kontra.mjs';
import {makeWorld,unproject,distance} from './world.js';
import {encodePacket,hex} from './codec.js';
import {DrivingAudio} from './audio.js';
import {DeviceClock,RecordBuffer,timingPresets} from './telemetry.js';
const $=id=>document.getElementById(id),keys=new Set();
const sound=new DrivingAudio(()=>{
  $('sound').textContent=sound.unavailable?'Sound unavailable':sound.enabled?'♫ Sound on':'♫ Sound off';
  $('sound').setAttribute('aria-pressed',String(sound.enabled));$('sound').disabled=!!sound.unavailable;
  $('sound').title=sound.enabled?'Mute driving sounds (M)':'Enable driving sounds (M)';
  $('sound').dataset.audioState=sound.context?.state||'locked';
});
sound.onChange();
let world,autoRun=null,autoSummary=null,visibilityPaused=false,session=null,connecting=false,deliveryFailed=false,inFlight=false,acknowledged=0,recorded=[],previewTick=0,lastRecord,toastTimer,flushRequested=false,bufferImei=null;
const clock=new DeviceClock(),deliveryQueue=new RecordBuffer();
const local=['localhost','127.0.0.1'].includes(location.hostname);
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4000);}
function setStatus(title,sub,kind=''){ $('status-title').textContent=title;$('status-sub').textContent=sub;$('status-dot').className='status-dot '+kind;}
function activity(message,ok=true,bytes=''){const holder=$('activity');holder.querySelector('.empty-activity')?.remove();const entry=document.createElement('div');entry.className='activity-entry'+(ok?'':' failed');const time=document.createElement('time');time.textContent=new Date().toLocaleTimeString('en-GB',{hour12:false});const detail=document.createElement('span');detail.textContent=message;const status=document.createElement('b');status.textContent=bytes||(ok?'ACK':'FAIL');entry.append(time,detail,status);holder.prepend(entry);while(holder.children.length>40)holder.lastChild.remove();}
function record(eventIoId=0,green=null){const s=world.state;return {timestamp:clock.timestamp,priority:0,gps:{...Object.fromEntries(Object.entries(unproject(s)).map(([k,v])=>[k,Number(v.toFixed(7))])),altitude:32,angle:Math.round(((s.angle*180/Math.PI)%360+360)%360)%360,satellites:12,speed:Math.round(Math.abs(s.speed)*3.6)},eventIoId,io:[{id:239,bytes:1,value:Number(s.ignition)},{id:240,bytes:1,value:Number(Math.abs(s.speed)>.3)},{id:16,bytes:4,value:Math.round(s.odometer)},...(green?[{id:253,bytes:1,value:green.type},{id:254,bytes:1,value:Math.min(255,Math.round(green.acceleration/9.80665*100))}]:[])]};}
async function api(path,data){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),22000);try{const response=await fetch(`/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{throw Error('Run npm start and open http://localhost:8787 to use native TCP');}if(!response.ok)throw Error(body.error||`Bridge returned HTTP ${response.status}`);return body;}finally{clearTimeout(timeout);}}
function updateForm(){const connected=!!session;if(!connected&&!deliveryQueue.length)bufferImei=null;for(const id of ['imei','host','port','codec'])$(id).disabled=connected||connecting;$('imei').disabled||=!!bufferImei&&!!deliveryQueue.length;$('connect').disabled=connecting||inFlight&&!connected;$('connect').classList.toggle('disconnect',connected);$('connect').innerHTML=connected?'■ Disconnect receiver':'<span>↗</span> Connect & send AVL';}
function sample(eventIoId=0,green=null){if(!world)return;
  clock.setIgnition(world.state.ignition);const r=record(eventIoId,green);if(eventIoId){r.priority=1;r.timestamp=clock.eventTimestamp();}lastRecord=r;recorded.push(r);if(recorded.length>100000){recorded.shift();if(!sample.warned){toast('Recording limit reached; keeping the latest 100,000 points.');sample.warned=true;}}$('record-count').textContent=`${recorded.length.toLocaleString()} locally recorded points`;
  try{deliveryQueue.add(r);}catch(e){world.state.paused=true;keys.clear();$('pause').textContent='▶ Resume';setStatus('Buffer full',e.message,'error');toast(e.message);}
  updateTiming();updateForm();
}
async function drain(){if(inFlight){flushRequested=true;return;}if(!session||deliveryFailed||!deliveryQueue.length)return;
  inFlight=true;flushRequested=false;const currentSession=session;let remaining=deliveryQueue.length;updateTiming();updateForm();
  try{while(session===currentSession&&remaining>0&&!deliveryFailed){const batch=deliveryQueue.batch(Math.min(10,remaining)),result=await api('send',{session:currentSession,records:batch});
      // Remove records only after a complete ACK, including an ACK that arrives during disconnect.
      deliveryQueue.acknowledge(batch,result.accepted);remaining-=batch.length;acknowledged+=result.accepted;$('packet-total').textContent=`${acknowledged} ACKNOWLEDGED`;activity(`Codec ${$('codec').value.toUpperCase()} · ${batch.length} record${batch.length>1?'s':''}`,true,`${result.bytes} B`);
      if(session===currentSession)setStatus('Connected · collecting AVL',`${$('host').value}:${$('port').value} · last batch acknowledged`,'connected');
    }}
  catch(e){if(session===currentSession){deliveryFailed=true;activity(e.message,false);setStatus('Delivery stopped · records retained',e.message,'error');toast('Disconnect and reconnect to retry pending records.');}}
  finally{inFlight=false;updateTiming();updateForm();if(flushRequested&&session===currentSession&&!deliveryFailed)void drain();}
}
function duration(seconds){seconds=Math.max(0,Math.ceil(seconds-1e-7));return seconds>=3600?`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`:seconds>=60?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${seconds}s`;}
function updateTiming(){
  $('sim-clock').textContent=new Date(clock.timestamp).toLocaleString('en-GB',{hour12:false});$('sim-elapsed').textContent=`${duration(clock.elapsed)} simulated · ${clock.settings.scale}×`;
  $('time-summary').textContent=`5 real minutes = ${duration(300*clock.settings.scale)} simulated. Movement, timestamps and schedules advance together.`;
  $('timing-profile').textContent=clock.ignition?'ENGINE ON':'ENGINE OFF';$('pending-count').textContent=`${deliveryQueue.length.toLocaleString()} pending`;
  $('next-collect').textContent=duration(clock.nextCollect-clock.elapsed);$('next-upload').textContent=inFlight?'Sending…':duration(clock.nextSend-clock.elapsed);
  $('real-upload').textContent=world?.state.paused||document.hidden?'Clock held while paused or hidden':`≈ ${duration((clock.nextSend-clock.elapsed)/clock.settings.scale)} real time until upload`;
  $('send-now').disabled=!session||deliveryFailed||inFlight||!deliveryQueue.length;
}
function timingValues(){return Object.fromEntries(['collectOn','sendOn','collectOff','sendOff','scale'].map(name=>[name,Number($(name).value)]));}
function configureTiming(settings){clock.configure(settings);for(const [name,value]of Object.entries(clock.settings))$(name).value=value;updateTiming();}
$('timing-form').addEventListener('submit',e=>{e.preventDefault();try{configureTiming(timingValues());toast('Device timing applied. The next collection and upload use these intervals.');}catch(e){toast(e.message);}});
$('timing-preset').addEventListener('change',()=>{const preset=timingPresets[$('timing-preset').value];if(preset)configureTiming(preset);});
$('timing-form').addEventListener('input',()=>{$('timing-preset').value='custom';});
$('send-now').addEventListener('click',()=>{clock.sentNow();void drain();});
// HTTP heartbeat preserves the bridge session without sending an AVL record.
setInterval(async()=>{if(!session||deliveryFailed)return;const currentSession=session;try{await api('heartbeat',{session:currentSession});}catch(e){if(session===currentSession){deliveryFailed=true;setStatus('Delivery stopped · records retained',e.message,'error');updateTiming();}}},30000);
window.addEventListener('pagehide',e=>{if(session&&!e.persisted)void fetch('/api/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session}),keepalive:true}).catch(()=>{});});
$('connection-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!world)return;
  if(session){const id=session;session=null;deliveryFailed=false;updateForm();updateTiming();try{await api('disconnect',{session:id});}catch{}setStatus('Disconnected','Pending records retained. Reconnect to send.');activity('Session closed',true,'OFF');return;}
  if(!local){toast('For native TCP, run npm start in the project and open localhost:8787.');setStatus('Local bridge required','Run npm start · open localhost:8787');return;}
  connecting=true;updateForm();setStatus('Connecting…','Opening TCP connection and sending IMEI');
  try{const result=await api('connect',{host:$('host').value.trim(),port:Number($('port').value),imei:$('imei').value,codec:$('codec').value});session=result.session;bufferImei=$('imei').value;deliveryFailed=false;setStatus('Receiver accepted IMEI','Sending pending records…','connected');activity('IMEI accepted',true,'01');sample();clock.sentNow();await drain();}
  catch(e){setStatus('Connection failed',e.message,'error');activity(e.message,false);}
  finally{connecting=false;updateForm();}
});
function toggleIgnition(){if(!world)return;if(autoRun){finishAuto('Stopped by driver');return;}world.state.ignition=!world.state.ignition;world.state.speed=0;keys.clear();sound.ignition(world.state.ignition);sample(239);updateHud();}
function togglePause(){if(!world)return;world.state.paused=!world.state.paused;visibilityPaused=false;if(!autoRun)world.state.speed=0;keys.clear();$('pause').textContent=world.state.paused?'▶ Resume':'Ⅱ Pause';updateTiming();toast(world.state.paused?'Simulation paused. Clock, driving and collection are held.':'Back on the road.');}
function toggleCamera(){if(!world)return;world.state.cityView=!world.state.cityView;$('camera').innerHTML=`◈ <span>${world.state.cityView?'Chase view':'City view'}</span>`;}
$('ignition').addEventListener('click',toggleIgnition);$('pause').addEventListener('click',togglePause);$('camera').addEventListener('click',toggleCamera);$('reset').addEventListener('click',resetCar);
function resetCar(){if(autoRun)finishAuto('Stopped · car reset');world?.reset();toast('Car returned to the starting point.');}
function updateAuto(){
  const active=!!autoRun,run=autoRun||autoSummary;
  for(const input of $('auto-form').querySelectorAll('input'))input.disabled=active;
  $('auto-start').disabled=active||!world;$('auto-stop').hidden=!active;
  $('auto-status').textContent=run?(active?(world.state.paused?'Paused · resume to continue':run.status):run.status):'Choose a distance. Leave events unchecked for a calm drive.';
  $('auto-progress').max=run?.distanceMetres||100;$('auto-progress').value=run?.travelled||0;
  $('auto-distance-label').textContent=run?`${(run.travelled/1000).toFixed(3)} / ${(run.distanceMetres/1000).toFixed(3)} km`:'Ready for a new trip';
  $('auto-events-done').textContent=run?.completedEvents?.length?`${run.completedEvents.length} / ${run.events.length} selected events performed`:active&&run.events.length?`0 / ${run.events.length} selected events performed`:'';
}
function finishAuto(status='Complete · engine off'){
  if(!autoRun)return;autoSummary={distanceMetres:autoRun.distanceMetres,travelled:autoRun.travelled,events:autoRun.events,completedEvents:[...autoRun.completedEvents],status};autoRun=null;
  world.state.speed=0;world.state.acceleration=0;world.state.nitroActive=false;world.state.ignition=false;world.state.paused=false;visibilityPaused=false;keys.clear();$('pause').textContent='Ⅱ Pause';sound.ignition(false);sample(239);updateAuto();updateHud();toast(`${status}. ${(autoSummary.travelled/1000).toFixed(3)} km driven.`);
}
function takeManualControl(){if(!autoRun)return;autoSummary={distanceMetres:autoRun.distanceMetres,travelled:autoRun.travelled,events:autoRun.events,completedEvents:[...autoRun.completedEvents],status:'Manual control · autonomous mode stopped'};autoRun=null;world.state.paused=false;visibilityPaused=false;$('pause').textContent='Ⅱ Pause';updateAuto();toast('Manual control. Turn the engine off to finish this trip.');}
$('auto-stop').addEventListener('click',()=>finishAuto('Stopped by driver'));
$('auto-form').addEventListener('submit',e=>{
  e.preventDefault();if(!world||autoRun)return;
  try{
    const options={distanceMetres:Number($('auto-distance').value)*1000,speedLimit:Number($('auto-limit').value),events:[...$('auto-form').querySelectorAll('[name="auto-event"]:checked')].map(input=>input.value)};
    const run=world.createRun(options);if(world.state.ignition){world.state.ignition=false;world.state.speed=0;sample(239);}
    world.reset();Object.assign(world.state,run.route.points[0],{speed:0,ignition:false,paused:false});sample(239);
    autoRun=run;autoSummary=null;keys.clear();visibilityPaused=false;world.state.ignition=true;$('pause').textContent='Ⅱ Pause';sample(239);sound.setBackground(false);void sound.unlock();sound.ignition(true);
    run.onEvent=event=>{sample();toast(`${event.label} · autonomous test event`);};updateAuto();updateHud();toast(session?'Autonomous trip started. Collecting AVL for scheduled uploads.':'Autonomous trip started. Connect a receiver to upload buffered AVL.');
  }catch(error){$('auto-status').textContent=error.message;toast(error.message);}
});
$('sound').addEventListener('click',()=>sound.toggle());
// Audio is unlocked synchronously within a user gesture, never at page load.
document.addEventListener('pointerdown',e=>{if(e.target.closest('#game-frame,#ignition,#pause,#sound,#auto-start')){sound.setBackground(false);void sound.unlock();}},true);
$('help').addEventListener('click',()=>$('help-dialog').showModal());$('close-help').addEventListener('click',()=>$('help-dialog').close());
$('export').addEventListener('click',()=>{if(!recorded.length){toast('Drive for a moment to record some points.');return;}const data={schema:'tokyo-drive-avl-v2',imei:$('imei').value,codec:$('codec').value,timing:{...clock.settings,intervalUnits:'simulated seconds',startTimestamp:clock.start,elapsedSeconds:clock.elapsed},exportedAt:new Date().toISOString(),records:recorded};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`tokyo-drive-${$('imei').value}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`Exported ${recorded.length} AVL records.`);});
const drivingKeys=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight']);
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||$('help-dialog').open)return;if(drivingKeys.has(e.code)||e.code==='KeyI'||e.code==='KeyM'){sound.setBackground(false);void sound.unlock();}if(drivingKeys.has(e.code)){e.preventDefault();takeManualControl();keys.add(e.code);}if(e.repeat)return;if(e.code==='KeyC')toggleCamera();if(e.code==='KeyI')toggleIgnition();if(e.code==='KeyP')togglePause();if(e.code==='KeyR')resetCar();if(e.code==='KeyM')sound.toggle();});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();if(world&&!autoRun)world.state.speed=0;sound.setBackground(true);});window.addEventListener('focus',()=>sound.setBackground(false));document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();if(autoRun&&!world.state.paused){world.state.paused=true;visibilityPaused=true;$('pause').textContent='▶ Resume';updateAuto();}else if(world&&!autoRun)world.state.speed=0;sound.setBackground(true);}else{sound.setBackground(false);if(autoRun&&visibilityPaused){world.state.paused=false;visibilityPaused=false;$('pause').textContent='Ⅱ Pause';updateAuto();}}});
for(const button of document.querySelectorAll('[data-key]')){button.addEventListener('pointerdown',e=>{e.preventDefault();takeManualControl();button.setPointerCapture(e.pointerId);keys.add(button.dataset.key);});for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>keys.delete(button.dataset.key));}
function updateHud(){if(!world)return;$('sound').dataset.outputLevel=sound.outputLevel.toFixed(5);const s=world.state,r=record(),speed=s.paused&&autoRun?0:r.gps.speed;$('speed').textContent=speed;$('gear').textContent=s.paused&&autoRun?'N':s.speed<-.1?'R':speed>0?'D':'N';$('distance').innerHTML=`${(s.odometer/1000).toFixed(2)} <small>KM</small>`;$('latitude').textContent=r.gps.latitude.toFixed(6);$('longitude').textContent=r.gps.longitude.toFixed(6);$('heading').textContent=String(r.gps.angle).padStart(3,'0')+'°';$('movement').textContent=speed>0?'Moving':'Stationary';$('io-ignition').textContent=Number(s.ignition);$('ignition-label').textContent=s.ignition?'ENGINE ON':'ENGINE OFF';$('ignition-dot').style.background=s.ignition?'#a3c799':'#a88c77';$('ignition').textContent=s.ignition?'⏻ Engine on':'⏻ Engine off';$('road-name').textContent=s.road;$('nitro').classList.toggle('active',s.nitroActive);$('nitro-meter').style.width=(s.nitroCharge*100)+'%';$('nitro-charge').textContent=Math.round(s.nitroCharge*100)+'%';
  const current=world.goals[world.goal];$('mission-title').textContent=current?current.name:'Neighborhood explored!';$('mission-distance').textContent=current?`${Math.round(distance(s,current))} m away · find the orange marker`:'All three checkpoints found. Keep driving.';$('mission-count').textContent=`${String(Math.min(world.goal+1,3)).padStart(2,'0')} / 03`;
  if($('record-preview').parentElement.open){const preview=lastRecord||r;$('record-preview').textContent=JSON.stringify(preview,null,2);$('hex-preview').textContent=hex(encodePacket([preview],$('codec').value));}if(autoRun)updateAuto();updateTiming();drawMinimap();
}
let mapImage;
function setupMinimap(){mapImage=document.createElement('canvas');mapImage.width=540;mapImage.height=540;const ctx=mapImage.getContext('2d'),b=world.bounds,w=b.maxX-b.minX,h=b.maxZ-b.minZ;ctx.fillStyle='#dde0ce';ctx.fillRect(0,0,540,540);const p=a=>[(a.x-b.minX)/w*540,(a.z-b.minZ)/h*540];ctx.fillStyle='#c3c9b7';for(const building of world.buildings){ctx.beginPath();building.points.forEach((a,i)=>{const[x,y]=p(a);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.fill();}ctx.strokeStyle='#f6f4e9';for(const s of world.segments){ctx.lineWidth=Math.max(1,s.width/w*540);ctx.beginPath();ctx.moveTo(...p(s.a));ctx.lineTo(...p(s.b));ctx.stroke();}}
function drawMinimap(){const canvas=$('minimap'),ctx=canvas.getContext('2d'),b=world.bounds;ctx.clearRect(0,0,180,150);ctx.fillStyle='#dde0ce';ctx.fillRect(0,0,180,150);const size=520,scale=150/size,s=world.state;const sourceX=(s.x-b.minX)/(b.maxX-b.minX)*540,sourceY=(s.z-b.minZ)/(b.maxZ-b.minZ)*540;const sw=size/(b.maxX-b.minX)*540,sh=size/(b.maxZ-b.minZ)*540;ctx.drawImage(mapImage,sourceX-sw/2,sourceY-sh/2,sw,sh,15,0,150,150);const goal=world.goals[world.goal];if(goal){ctx.fillStyle='#e77740';ctx.beginPath();ctx.arc(Math.max(8,Math.min(172,90+(goal.x-s.x)*scale)),Math.max(8,Math.min(142,75+(goal.z-s.z)*scale)),4,0,Math.PI*2);ctx.fill();}ctx.save();ctx.translate(90,75);ctx.rotate(s.angle);ctx.fillStyle='#263931';ctx.strokeStyle='#f9f5e8';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,5);ctx.lineTo(0,3);ctx.lineTo(-5,5);ctx.closePath();ctx.stroke();ctx.fill();ctx.restore();}
if(local){$('receiver-link').href='http://localhost:8788';}else{$('receiver-link').href='receiver/';}
if(!local)$('bridge-note').innerHTML='Hosted driving preview. For native TCP, run <code>npm start</code> and open <a href="http://localhost:8787">localhost:8787</a>.';
try {
  const response=await fetch('data/world.json');if(!response.ok)throw Error('Map extract could not be loaded');const data=await response.json();world=makeWorld($('game'),data);setupMinimap();world.onDrivingEvent=green=>{sample(253,green);toast(green.type===2?'Harsh braking · event recorded':'Harsh acceleration · event recorded');};world.onImpact=speed=>sound.impact(speed);world.onGoal=n=>{sound.checkpoint();toast(n===3?'All checkpoints found. Tokyo is yours.':`Checkpoint ${n} found. On to the next!`);};
  const loop=GameLoop({clearCanvas:false,context:document.createElement('canvas').getContext('2d'),update(dt){
    if(!world.state.paused&&!document.hidden){
      // Substep accelerated physics at 60 Hz simulated time; never jump through collisions or event thresholds.
      const steps=clock.settings.scale,step=dt;for(let i=0;i<steps&&!world.state.paused;i++){
        clock.step(step);world.update(step,keys,autoRun);
        if(autoRun?.done)finishAuto();else if(autoRun?.blocked)finishAuto('Stopped · route blocked');
        if(clock.collectDue())sample();if(clock.sendDue())void drain();
      }
    }
    sound.update(world.state,autoRun?autoRun.controls:keys,dt);if(++previewTick%6===0)updateHud();
  },render(){world.render(clock.settings.scale);}});loop.start();$('loading').classList.add('hidden');updateHud();updateAuto();sample();
  // Read-only diagnostics help inspect simulation behavior in browser tools.
  window.tokyoDrive={get state(){return {...world.state};},get record(){return record();},get recordCount(){return recorded.length;},get acknowledged(){return acknowledged;},get renderStats(){return world.renderer.info.render;}};
}catch(e){$('loading').textContent=`Unable to start: ${e.message}. A browser with WebGL 2 is required.`;setStatus('Game unavailable',e.message,'error');console.error(e);}
