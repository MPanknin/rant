import { POINT_FLOATS } from '../render/types';

/**
 * Parses a binary PCD file into interleaved x, y, z, intensity float32 values.
 * Requires float32 x/y/z fields; intensity is optional and defaults to 0.
 */
export function parsePCD(buffer: ArrayBuffer): Float32Array {
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096)));
  const dataAt = head.indexOf('\nDATA ');
  if (dataAt < 0) throw new Error('Not a PCD file');

  const lines = head.slice(0, dataAt).split('\n');
  const field = (key: string) => lines.find((l) => l.startsWith(key + ' '))?.trim().split(/\s+/).slice(1) ?? [];
  const eol = head.indexOf('\n', dataAt + 1);
  const mode = head.slice(dataAt + 6, eol).trim();
  if (mode !== 'binary') throw new Error('Unsupported PCD data: ' + mode);

  const fields = field('FIELDS');
  const size = field('SIZE').map(Number);
  const type = field('TYPE');
  const count = field('COUNT').map(Number);
  const points = Number(field('POINTS')[0]);

  let stride = 0;
  const offset: Record<string, number> = {};
  fields.forEach((name, i) => {
    offset[name] = stride;
    stride += size[i] * (count[i] || 1);
  });
  const isFloat32 = (name: string) => {
    const i = fields.indexOf(name);
    return i >= 0 && type[i] === 'F' && size[i] === 4;
  };
  if (!isFloat32('x') || !isFloat32('y') || !isFloat32('z')) throw new Error('PCD needs float32 x, y, z');

  const hasIntensity = isFloat32('intensity');
  const view = new DataView(buffer, eol + 1);
  if (view.byteLength < points * stride) throw new Error('PCD file is truncated');

  const out = new Float32Array(points * POINT_FLOATS);
  for (let p = 0, b = 0; p < points; p++, b += stride) {
    const o = p * POINT_FLOATS;
    out[o] = view.getFloat32(b + offset.x, true);
    out[o + 1] = view.getFloat32(b + offset.y, true);
    out[o + 2] = view.getFloat32(b + offset.z, true);
    out[o + 3] = hasIntensity ? view.getFloat32(b + offset.intensity, true) : 0;
  }
  return out;
}
