import type { RaceLayoutDefinition } from '../../core/types';

export const perimeterLayout: RaceLayoutDefinition = {
  id: 'perimeter',
  name: '城市环路',
  checkpointRadius: 22,
  corridorWidth: 26,
  barrierWidth: 1.1,
  barrierOffset: 16.5,
  barrierExtra: 2.5,
  flagOffset: 13.5,
  startGridOffset: 3.5,
  startGridSpacing: 11,
  startGridRowOffset: 4,
  path: (() => {
    const N = 8;
    const startI = Math.floor(N / 2);
    const path: [number, number][] = [];
    for (let i = startI; i <= N; i += 1) path.push([i, N]);
    for (let j = N - 1; j >= 0; j -= 1) path.push([N, j]);
    for (let i = N - 1; i >= 0; i -= 1) path.push([i, 0]);
    for (let j = 1; j < N; j += 1) path.push([0, j]);
    for (let i = 0; i < startI; i += 1) path.push([i, N]);
    return path;
  })(),
};
