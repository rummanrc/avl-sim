import * as T from './vendor/three.module.js';

// Original low-poly coupe, built in metres and contained by the driving collider.
export function makeSportsCar() {
  const car=new T.Group(),wheels=[];
  const paint=new T.MeshPhongMaterial({color:0xe96932,shininess:70});
  const dark=new T.MeshLambertMaterial({color:0x202b2d});
  const glass=new T.MeshPhongMaterial({color:0x354e54,shininess:110,side:T.DoubleSide});
  const alloy=new T.MeshPhongMaterial({color:0xb6bcb7,shininess:90});
  const headlight=new T.MeshBasicMaterial({color:0xffefc8});
  const taillight=new T.MeshBasicMaterial({color:0xf04432});
  function box(w,h,d,material,x,y,z) {
    const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);car.add(mesh);return mesh;
  }
  function panel(points,material) {
    const vertices=[];for(let i=1;i<points.length-1;i++)vertices.push(...points[0],...points[i],...points[i+1]);
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
    const mesh=new T.Mesh(geometry,material);car.add(mesh);return mesh;
  }
  // Chamfered fenders, a long sloping bonnet and a short rear deck.
  const stations=[[-2.13,.83,.46,.55],[-1.65,1.01,.55,.75],[-.65,1.02,.57,.8],[.8,1.04,.55,.78],[1.64,1.02,.51,.7],[2.13,.9,.45,.56]];
  const rings=stations.map(([z,w,shoulder,top])=>[
    [-w*.84,.27,z],[w*.84,.27,z],[w,.38,z],[w,shoulder,z],
    [w*.82,top,z],[-w*.82,top,z],[-w,shoulder,z],[-w,.38,z]
  ]);
  for(let i=1;i<rings.length;i++)for(let j=0;j<8;j++)panel([rings[i-1][j],rings[i-1][(j+1)%8],rings[i][(j+1)%8],rings[i][j]],paint);
  panel([...rings[0]].reverse(),paint);panel(rings.at(-1),paint);
  // Wraparound glass and a low roof with pronounced front/rear slopes.
  panel([[-.79,.81,-.88],[.79,.81,-.88],[.65,1.26,-.26],[-.65,1.26,-.26]],glass);
  panel([[-.65,1.26,-.26],[.65,1.26,-.26],[.67,1.23,.5],[-.67,1.23,.5]],paint);
  panel([[-.67,1.23,.5],[.67,1.23,.5],[.82,.8,1.2],[-.82,.8,1.2]],glass);
  for(const side of [-1,1]) {
    panel([[side*.8,.8,-.87],[side*.65,1.25,-.25],[side*.67,1.22,.5],[side*.83,.79,1.18]],glass);
    box(.05,.39,.07,dark,side*.72,1.01,.24).rotation.z=side*.38;
    box(.13,.1,.23,paint,side*.95,.94,-.55); // Mirrors.
    box(.07,.15,3.1,dark,side*1.015,.33,.08); // Side skirts.
    box(.42,.065,.065,headlight,side*.56,.52,-2.14);
    box(.58,.065,.055,taillight,side*.52,.5,2.145);
    box(.22,.025,.58,dark,side*.46,.771,-1.25); // Bonnet vents.
    box(.12,.15,.12,dark,side*.67,.79,1.8); // Rear wing uprights.
    const pipe=new T.Mesh(new T.CylinderGeometry(.075,.075,.16,8),alloy);pipe.rotation.x=Math.PI/2;pipe.position.set(side*.55,.34,2.12);car.add(pipe);
  }
  box(1.83,.08,.22,dark,0,.28,-2.04); // Front splitter.
  box(1.04,.13,.05,dark,0,.4,-2.155); // Grille.
  box(1.53,.15,.08,dark,0,.34,2.13); // Rear diffuser.
  box(1.88,.06,.32,dark,0,.9,1.81); // Slim rear wing.
  for(const x of [-.87,.87])for(const z of [-1.36,1.36]) {
    const steering=new T.Group();steering.position.set(x,.37,z);car.add(steering);
    const roll=new T.Group();steering.add(roll);
    const tyre=new T.Mesh(new T.CylinderGeometry(.33,.33,.28,12),dark);tyre.rotation.z=Math.PI/2;roll.add(tyre);
    const rim=new T.Mesh(new T.CylinderGeometry(.23,.23,.292,10),alloy);rim.rotation.z=Math.PI/2;roll.add(rim);
    const hub=new T.Mesh(new T.CylinderGeometry(.095,.095,.302,8),dark);hub.rotation.z=Math.PI/2;roll.add(hub);
    for(let i=0;i<5;i++){
      const spoke=new T.Mesh(new T.BoxGeometry(.31,.045,.4),dark);spoke.rotation.x=i*Math.PI/5;roll.add(spoke);
    }
    wheels.push({steering,roll,front:z<0});
  }
  return {car,wheels};
}
