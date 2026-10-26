import type { StreamSource, StreamWindow } from './data/stream';

declare global {
  interface Window {
    /** Optional override, defined by a host page before the app script runs. */
    RANT_STREAM?: Partial<StreamSource>;
  }
}

/**
 * Default sequence: 154 consecutive HDL-64 sweeps (binary PCD, 10 Hz, KITTI-derived) from Udacity's
 * SFND course repo at a pinned commit, served by GitHub with CORS.
 */
export const SOURCE: StreamSource = {
  base: 'https://raw.githubusercontent.com/udacity/SFND_Lidar_Obstacle_Detection/ef15da2bc172359e7d6edfdd156a2a243d10977e/src/sensors/data/pcd/data_2/',
  count: 154,
  period: 0.1,
  ...window.RANT_STREAM,
};

/** ~2 s of prefetch and 1 s of trail at 10 Hz: at most 31 sweeps (~60 MB) on the CPU and GPU. */
export const WINDOW: StreamWindow = { ahead: 20, maxBehind: 10, parallel: 4 };

/** Initial GPU slot size; HDL-64 sweeps stay under ~128k points, larger ones grow the slots. */
export const SLOT_POINTS = 131072;

/** World-space point radius in metres. */
export const POINT_RADIUS = 0.035;
