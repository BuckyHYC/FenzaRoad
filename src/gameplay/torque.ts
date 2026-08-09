import type { VehicleSpec } from '../core/types';

export function sampleTorqueNm(spec: VehicleSpec, rpmRatio: number): number {
  const curve = spec.torqueCurveNm;
  const clamped = Math.max(0, Math.min(1, rpmRatio));
  const pos = clamped * (curve.length - 1);
  const i0 = Math.floor(pos);
  const i1 = Math.min(i0 + 1, curve.length - 1);
  const t = pos - i0;
  return curve[i0] + (curve[i1] - curve[i0]) * t;
}
