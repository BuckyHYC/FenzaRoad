import type { RaceLayoutDefinition } from '../../core/types';

export const hillLoopLayout: RaceLayoutDefinition = {
  id: 'hillLoop',
  name: '山地纵贯',
  checkpointRadius: 26,
  corridorWidth: 30,
  barrierWidth: 1.15,
  barrierOffset: 18,
  barrierExtra: 3.2,
  flagOffset: 15,
  startGridOffset: 3.5,
  startGridSpacing: 11,
  startGridRowOffset: 4,
  path: [
    [4, 5], [5, 5], [5, 6], [6, 6], [6, 7], [7, 7], [7, 5], [6, 5],
    [6, 4], [7, 4], [7, 3], [6, 3], [6, 2], [7, 2], [7, 1], [6, 1],
    [5, 1], [5, 2], [4, 2], [4, 3], [3, 3], [3, 4], [2, 4], [2, 5],
    [3, 5],
  ],
};
