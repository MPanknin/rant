import { WebGL2TextureBacking } from './webgl2';
import { WebGPUSSBOBacking } from './webgpu';
import type { BackendType, BackingOptions, PointCloudBacking } from './types';

export interface RenderSurface {
  canvas: HTMLCanvasElement;
  backing: PointCloudBacking;
}

/**
 * Creates a canvas with the preferred backend, falling back to WebGL2.
 * Each attempt gets a fresh canvas because a canvas can only ever hold one context type.
 */
export async function createSurface(preferred: BackendType, options: BackingOptions): Promise<RenderSurface> {
  if (preferred === 'webgpu' && navigator.gpu) {
    const canvas = document.createElement('canvas');
    try {
      return { canvas, backing: await WebGPUSSBOBacking.create(canvas, options) };
    } catch (error) {
      console.warn('WebGPU unavailable, falling back to WebGL2:', error);
    }
  }
  const canvas = document.createElement('canvas');
  return { canvas, backing: WebGL2TextureBacking.create(canvas, options) };
}
