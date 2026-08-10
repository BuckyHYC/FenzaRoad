import type { RaceLayoutDefinition } from '../../core/types';

export const cityTourLayout: RaceLayoutDefinition = {
  id: 'cityTour',
  name: '城市巡回',
  checkpointRadius: 18,
  corridorWidth: 20,
  barrierWidth: 1.05,
  barrierOffset: 15,
  barrierExtra: 2.8,
  flagOffset: 12.5,
  startGridOffset: 3.5,
  startGridSpacing: 11,
  startGridRowOffset: 7,
  path: [
    [1, 6], [2, 6], [2, 5], [3, 5], [3, 4], [4, 4], [4, 3], [5, 3],
    [5, 2], [6, 2], [6, 1], [5, 1], [4, 1], [4, 2], [3, 2], [3, 3],
    [2, 3], [2, 4], [1, 4], [1, 5],
  ],
};
