export type BackendType = 'webgpu' | 'webgl2';

/** Point attribute used for colouring. */
export enum Channel {
  Height = 0,
  Intensity = 1,
  Age = 2,
}

/** Points are stored as 4 float32 values (16 bytes): x, y, z, intensity. */
export const POINT_FLOATS = 4;
export const POINT_BYTES = POINT_FLOATS * 4;

export interface FrameUniforms {
  /** Column-major view-projection in WebGL clip space (z in -1..1). */
  viewProjection: Float32Array;
  cameraRight: [number, number, number];
  cameraUp: [number, number, number];
  /** World-space billboard radius in metres. */
  pointSize: number;
  currentTime: number;
  trailDuration: number;
  channel: Channel;
}

/** A contiguous run of points from one sweep, drawn as one instanced call. */
export interface DrawRange {
  first: number;
  count: number;
  time: number;
}

/** GPU storage and drawing for point data; implemented once per graphics API. */
export interface PointCloudBacking {
  readonly backendType: BackendType;
  readonly capacityPoints: number;
  allocate(maxPoints: number): void;
  uploadPoints(pointOffset: number, data: Float32Array): void;
  resize(width: number, height: number): void;
  /** Clears the target and draws the ranges in order, so later ranges blend on top. */
  render(uniforms: FrameUniforms, ranges: DrawRange[]): void;
  dispose(): void;
}
