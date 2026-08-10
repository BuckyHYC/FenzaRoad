import type { Aabb, CircleCollider } from '../core/types';

export interface AabbGrid {
  cellSize: number;
  buckets: Map<number, Aabb[]>;
}

export interface CircleGrid {
  cellSize: number;
  buckets: Map<number, CircleCollider[]>;
}

function cellKey(cx: number, cz: number): number {
  return (cx + 1000000) * 2000001 + (cz + 1000000);
}

function cellRange(min: number, max: number, cellSize: number): [number, number] {
  return [
    Math.floor(min / cellSize),
    Math.floor(max / cellSize),
  ];
}

export function buildAabbGrid(
  colliders: Aabb[],
  cellSize = 40,
): AabbGrid {
  const buckets = new Map<number, Aabb[]>();
  for (const box of colliders) {
    const [minX, maxX] = cellRange(box.minX, box.maxX, cellSize);
    const [minZ, maxZ] = cellRange(box.minZ, box.maxZ, cellSize);
    for (let cz = minZ; cz <= maxZ; cz += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const key = cellKey(cx, cz);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(box);
      }
    }
  }
  return { cellSize, buckets };
}

export function buildCircleGrid(
  colliders: CircleCollider[],
  cellSize = 32,
): CircleGrid {
  const buckets = new Map<number, CircleCollider[]>();
  for (const circle of colliders) {
    const [minX, maxX] = cellRange(
      circle.x - circle.radius,
      circle.x + circle.radius,
      cellSize,
    );
    const [minZ, maxZ] = cellRange(
      circle.z - circle.radius,
      circle.z + circle.radius,
      cellSize,
    );
    for (let cz = minZ; cz <= maxZ; cz += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const key = cellKey(cx, cz);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(circle);
      }
    }
  }
  return { cellSize, buckets };
}

export function queryAabbGrid(
  grid: AabbGrid,
  x: number,
  z: number,
  radius: number,
): Aabb[] {
  const [minX, maxX] = cellRange(x - radius, x + radius, grid.cellSize);
  const [minZ, maxZ] = cellRange(z - radius, z + radius, grid.cellSize);
  const result: Aabb[] = [];
  const seen = new Set<Aabb>();
  for (let cz = minZ; cz <= maxZ; cz += 1) {
    for (let cx = minX; cx <= maxX; cx += 1) {
      const bucket = grid.buckets.get(cellKey(cx, cz));
      if (!bucket) continue;
      for (const box of bucket) {
        if (seen.has(box)) continue;
        seen.add(box);
        result.push(box);
      }
    }
  }
  return result;
}

export function queryCircleGrid(
  grid: CircleGrid,
  x: number,
  z: number,
  radius: number,
): CircleCollider[] {
  const [minX, maxX] = cellRange(x - radius, x + radius, grid.cellSize);
  const [minZ, maxZ] = cellRange(z - radius, z + radius, grid.cellSize);
  const result: CircleCollider[] = [];
  const seen = new Set<CircleCollider>();
  for (let cz = minZ; cz <= maxZ; cz += 1) {
    for (let cx = minX; cx <= maxX; cx += 1) {
      const bucket = grid.buckets.get(cellKey(cx, cz));
      if (!bucket) continue;
      for (const circle of bucket) {
        if (seen.has(circle)) continue;
        seen.add(circle);
        result.push(circle);
      }
    }
  }
  return result;
}
