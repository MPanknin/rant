// Shading shared by both backends, written once per shading language.
// Intensity saturates at 0.6: most returns are dim, only retroreflectors (signs, plates) approach 1.
// The helpers take the point (xyz + intensity), its normalised age (1 = newest) and the channel.

export const CLEAR_COLOR: [number, number, number] = [0x0a / 255, 0x11 / 255, 0x1c / 255];

export const SHADING_GLSL = /* glsl */ `
vec3 heightColor(float z) {
  float h = clamp((z + 3.0) / 8.0, 0.0, 1.0);
  return vec3(0.12 + 0.65 * h, 0.7 - 0.23 * h, 0.95 - 0.25 * h);
}
vec3 intensityColor(float i) {
  float t = clamp(i / 0.6, 0.0, 1.0);
  return mix(vec3(0.18, 0.32, 0.7), vec3(1.0, 0.86, 0.45), t);
}
vec3 ageColor(float a) {
  return mix(vec3(1.0, 0.2, 0.4), vec3(0.0, 1.0, 0.75), a);
}
vec3 shade(vec4 pt, float age, int channel) {
  if (channel == 1) return intensityColor(pt.w);
  if (channel == 2) return ageColor(age);
  return heightColor(pt.z);
}`;

export const SHADING_WGSL = /* wgsl */ `
fn heightColor(z: f32) -> vec3<f32> {
  let h = clamp((z + 3.0) / 8.0, 0.0, 1.0);
  return vec3<f32>(0.12 + 0.65 * h, 0.7 - 0.23 * h, 0.95 - 0.25 * h);
}
fn intensityColor(i: f32) -> vec3<f32> {
  let t = clamp(i / 0.6, 0.0, 1.0);
  return mix(vec3<f32>(0.18, 0.32, 0.7), vec3<f32>(1.0, 0.86, 0.45), t);
}
fn ageColor(a: f32) -> vec3<f32> {
  return mix(vec3<f32>(1.0, 0.2, 0.4), vec3<f32>(0.0, 1.0, 0.75), a);
}
fn shade(pt: vec4<f32>, age: f32, channel: i32) -> vec3<f32> {
  if (channel == 1) { return intensityColor(pt.w); }
  if (channel == 2) { return ageColor(age); }
  return heightColor(pt.z);
}`;
