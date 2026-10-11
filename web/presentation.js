export const damping=(dt,seconds)=>1-Math.exp(-dt/seconds);
export function smoothHeading(current,target,dt,seconds){
  const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));
  return current+delta*damping(dt,seconds);
}
