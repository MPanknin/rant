import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Z-up orbit camera (KITTI Velodyne frame: X forward, Y left, Z up) driven by mouse/touch on `element`. */
export class OrbitCamera {
  readonly viewProjection = new Float32Array(16);
  readonly right: [number, number, number] = [1, 0, 0];
  readonly up: [number, number, number] = [0, 0, 1];
  private readonly camera = new PerspectiveCamera(58, 1, 0.1, 1200);
  private readonly controls: OrbitControls;
  private readonly matrix = new Matrix4();
  private readonly axis = new Vector3();

  constructor(element: HTMLElement) {
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(24, -30, 19);
    this.controls = new OrbitControls(this.camera, element);
    this.controls.target.set(12, 0, 0);
    this.controls.enableDamping = true;
    this.controls.update();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Applies damping and refreshes the matrices and billboard axes. */
  update(): void {
    const c = this.camera;
    this.controls.update();
    c.updateMatrixWorld();
    this.viewProjection.set(this.matrix.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse).elements);
    this.axis.setFromMatrixColumn(c.matrixWorld, 0).toArray(this.right);
    this.axis.setFromMatrixColumn(c.matrixWorld, 1).toArray(this.up);
  }
}
