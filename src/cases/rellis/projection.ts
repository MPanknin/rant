// Both matrices map column vectors from the named source into the destination.
export interface Rig {
  cameraFromOuster: number[];
  ousterFromVelodyne: number[];
  intrinsics: number[];
  distortion: number[];
  width: number;
  height: number;
}
export type Mode = 'reported' | 'corrected';

function transform(matrix: number[], x: number, y: number, z: number) {
  return [
    matrix[0]*x + matrix[1]*y + matrix[2]*z + matrix[3],
    matrix[4]*x + matrix[5]*y + matrix[6]*z + matrix[7],
    matrix[8]*x + matrix[9]*y + matrix[10]*z + matrix[11],
  ];
}

export function projectScan(xyz: Float32Array, rig: Rig, mode: Mode) {
  const [fx, fy, cx, cy] = rig.intrinsics;
  const [k1, k2, p1, p2, k3] = rig.distortion;
  const limitX = Math.tan(Math.atan2(rig.width, 2*fx) + Math.PI/36);
  const limitY = Math.tan(Math.atan2(rig.height, 2*fy) + Math.PI/36);
  const pixels: {u:number; v:number; range:number}[] = [];
  for (let i = 0; i < xyz.length; i += 3) {
    let x = xyz[i], y = xyz[i+1], z = xyz[i+2];
    const range = Math.hypot(x, y, z);
    if (mode === 'corrected') [x,y,z] = transform(rig.ousterFromVelodyne, x, y, z);
    const [X,Y,Z] = transform(rig.cameraFromOuster, x, y, z);
    if (Z <= 0) continue;
    const a = X/Z, b = Y/Z, r2 = a*a + b*b;
    if (Math.abs(a) >= limitX || Math.abs(b) >= limitY) continue;
    const radial = 1 + r2*(k1 + r2*(k2 + r2*k3));
    const u = fx*(a*radial + 2*p1*a*b + p2*(r2 + 2*a*a)) + cx;
    const v = fy*(b*radial + p1*(r2 + 2*b*b) + 2*p2*a*b) + cy;
    if (u >= 0 && u < rig.width && v >= 0 && v < rig.height) pixels.push({u,v,range});
  }
  return pixels;
}
