import {distance,sweptClear} from './geometry.js';
export function advanceCar(state,dt,keys,collides){state.nitroActive=false;if(state.paused||!state.ignition){state.speed=0;state.acceleration=0;return {clear:true,oldSpeed:0};}
  const oldSpeed=state.speed,boostHeld=keys.has('ShiftLeft')||keys.has('ShiftRight');
  if(!boostHeld&&state.nitroCharge>=.15)state.nitroDepleted=false;
  const nitro=boostHeld&&!state.nitroDepleted&&state.nitroCharge>0&&state.speed>=0;
  const accel=keys.has('ArrowUp')||keys.has('KeyW')||nitro,reverse=keys.has('ArrowDown')||keys.has('KeyS');
  if(keys.has('Space'))state.speed=Math.sign(state.speed)*Math.max(0,Math.abs(state.speed)-22*dt);
  else if(accel){state.speed+=((state.speed<0)?8:nitro?14:2.5)*dt;state.nitroActive=nitro;}
  else if(reverse)state.speed-=((state.speed>0)?8:3)*dt;
  else{const drag=(.8+Math.abs(state.speed)*.05)*dt;state.speed=Math.sign(state.speed)*Math.max(0,Math.abs(state.speed)-drag);}
  state.nitroCharge=Math.max(0,Math.min(1,state.nitroCharge+(state.nitroActive?-.2:.08)*dt));if(state.nitroCharge===0)state.nitroDepleted=true;
  const cap=nitro?44.44:Math.max(22.22,oldSpeed-(.8+Math.abs(oldSpeed)*.05)*dt);state.speed=Math.max(-5,Math.min(cap,state.speed));
  const input=Number(keys.has('ArrowRight')||keys.has('KeyD'))-Number(keys.has('ArrowLeft')||keys.has('KeyA'));
  // Ease key presses and releases rather than instantly reversing the wheel.
  const steer=(state.steering??0)+(input-(state.steering??0))*(1-Math.exp(-dt/.10));state.steering=steer;
  const angle=state.angle+steer*state.speed/2.8*Math.tan(.43)*dt/(1+Math.abs(state.speed)*.09),next={x:state.x+Math.sin(angle)*state.speed*dt,z:state.z-Math.cos(angle)*state.speed*dt,angle};
  const clear=sweptClear(state,next,collides);if(clear){state.odometer+=distance(state,next);Object.assign(state,next);}else{state.speed=0;state.nitroActive=false;}
  state.acceleration=(Math.abs(state.speed)-Math.abs(oldSpeed))/dt;return {clear,oldSpeed};
}
