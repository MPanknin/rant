type Vec3 = [number, number, number];

const FOV = (58 * Math.PI) / 180;
const NEAR = 0.1;
const FAR = 1200;
const MAX_PITCH = 1.55; // just short of straight up/down, where the basis degenerates
/** Fraction of the pending input applied per frame; the rest carries over, which gives easing. */
const EASE = 0.25;
const ROTATE_SPEED = 0.005; // radians per pixel
const ZOOM_SPEED = 0.0015; // log-distance per wheel delta unit

/**
 * Z-up orbit camera (KITTI Velodyne frame: X forward, Y left, Z up) driven by pointer input on `element`.
 * Left drag orbits, right or shift drag pans, the wheel zooms; with two touches, pinch zooms and drag pans.
 */
export class OrbitCamera {
  readonly viewProjection = new Float32Array(16);
  readonly right: Vec3 = [1, 0, 0];
  readonly up: Vec3 = [0, 0, 1];

  private target: Vec3 = [12, 0, 0];
  private yaw = Math.atan2(-30, 12);
  private pitch = Math.asin(19 / Math.hypot(12, 30, 19));
  private distance = Math.hypot(12, 30, 19);
  private aspect = 1;

  // Input not yet applied; drained a fraction at a time in update()
  private pending = { yaw: 0, pitch: 0, zoom: 0, panX: 0, panY: 0 };
  private readonly pointers = new Map<number, { x: number; y: number; pan: boolean }>();

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  /** Applies eased input and refreshes the view-projection matrix and billboard axes. */
  update(): void {
    const p = this.pending;
    this.yaw += p.yaw * EASE;
    this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, this.pitch + p.pitch * EASE));
    this.distance = Math.min(500, Math.max(1, this.distance * Math.exp(p.zoom * EASE)));
    this.applyPan(p.panX * EASE, p.panY * EASE);
    for (const key of Object.keys(p) as (keyof typeof p)[]) p[key] *= 1 - EASE;
    this.writeMatrices();
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.element.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey });
  };

  private onPointerMove = (e: PointerEvent): void => {
    const pointer = this.pointers.get(e.pointerId);
    if (!pointer) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;

    if (this.pointers.size === 2) {
      // Each finger contributes half of the midpoint motion; the spread change drives zoom
      const [a, b] = [...this.pointers.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      if (before > 0 && after > 0) this.pending.zoom += Math.log(before / after);
      this.pending.panX += dx / 2;
      this.pending.panY += dy / 2;
      return;
    }

    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (pointer.pan) {
      this.pending.panX += dx;
      this.pending.panY += dy;
    } else {
      this.pending.yaw -= dx * ROTATE_SPEED;
      this.pending.pitch += dy * ROTATE_SPEED;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.pending.zoom += e.deltaY * ZOOM_SPEED;
  };

  /** Moves the target in the view plane so that the scene follows the pointer at the target's depth. */
  private applyPan(dx: number, dy: number): void {
    const worldPerPixel = (2 * this.distance * Math.tan(FOV / 2)) / Math.max(1, this.element.clientHeight);
    for (let i = 0; i < 3; i++) this.target[i] += (-dx * this.right[i] + dy * this.up[i]) * worldPerPixel;
  }

  private writeMatrices(): void {
    const [tx, ty, tz] = this.target;
    const cp = Math.cos(this.pitch);
    const eye: Vec3 = [
      tx + this.distance * cp * Math.cos(this.yaw),
      ty + this.distance * cp * Math.sin(this.yaw),
      tz + this.distance * Math.sin(this.pitch),
    ];

    // Basis: forward towards the target, right = forward × world up (Z), up = right × forward
    const f = normalize([tx - eye[0], ty - eye[1], tz - eye[2]]);
    const r = normalize([f[1], -f[0], 0]);
    const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    this.right.splice(0, 3, ...r);
    this.up.splice(0, 3, ...u);

    // Column-major view matrix (lookAt) and WebGL-style perspective (z in -1..1)
    const dot = (a: Vec3) => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
    const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r), -dot(u), dot(f), 1];
    const s = 1 / Math.tan(FOV / 2);
    const nf = 1 / (NEAR - FAR);
    const proj = [s / this.aspect, 0, 0, 0, 0, s, 0, 0, 0, 0, (FAR + NEAR) * nf, -1, 0, 0, 2 * FAR * NEAR * nf, 0];

    for (let c = 0; c < 4; c++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += proj[k * 4 + row] * view[c * 4 + k];
        this.viewProjection[c * 4 + row] = sum;
      }
    }
  }
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
