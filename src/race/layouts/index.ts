import type { RaceLayoutDefinition } from '../../core/types';
import { cityTourLayout } from './cityTour';
import { hillLoopLayout } from './hillLoop';
import { perimeterLayout } from './perimeter';

export const RACE_LAYOUT_DEFINITIONS: RaceLayoutDefinition[] = [
  perimeterLayout,
  cityTourLayout,
  hillLoopLayout,
];
