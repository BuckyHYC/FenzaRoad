import { WORLD } from '../core/Constants';

interface MinimapDot {
  x: number;
  z: number;
  isPlayer: boolean;
}

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size = 168;
  private readonly margin = 10;
  private readonly scale: number;
  private readonly minX: number;
  private readonly minZ: number;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = this.size;
    canvas.height = this.size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Minimap canvas context unavailable');
    this.ctx = context;
    const N = WORLD.GRID_SIZE;
    this.minX = 0;
    this.minZ = 0;
    const range = N * WORLD.BLOCK_LENGTH;
    this.scale = (this.size - this.margin * 2) / range;
  }

  render(playerX: number, playerZ: number, heading: number, dots: MinimapDot[] = []): void {
    const ctx = this.ctx;
    const size = this.size;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(16,20,26,0.86)';
    ctx.fillRect(0, 0, size, size);

    const mapMax = WORLD.GRID_SIZE * WORLD.BLOCK_LENGTH;
    const cityMaxX = WORLD.CITY_MAX_X;
    const villageMaxX = WORLD.VILLAGE_MAX_X;
    ctx.fillStyle = 'rgba(90,150,200,0.18)';
    ctx.fillRect(
      this.margin,
      this.margin,
      this.toCanvasX(cityMaxX) - this.margin,
      size - this.margin * 2,
    );
    ctx.fillStyle = 'rgba(170,160,80,0.18)';
    ctx.fillRect(
      this.toCanvasX(cityMaxX),
      this.margin,
      this.toCanvasX(villageMaxX) - this.toCanvasX(cityMaxX),
      size - this.margin * 2,
    );
    ctx.fillStyle = 'rgba(100,130,80,0.2)';
    ctx.fillRect(
      this.toCanvasX(villageMaxX),
      this.margin,
      this.toCanvasX(mapMax) - this.toCanvasX(villageMaxX),
      size - this.margin * 2,
    );

    ctx.strokeStyle = 'rgba(160,170,185,0.28)';
    ctx.lineWidth = 1;
    const N = WORLD.GRID_SIZE;
    const B = WORLD.BLOCK_LENGTH;
    for (let i = 0; i <= N; i += 1) {
      const x = this.toCanvasX(i * B);
      ctx.beginPath();
      ctx.moveTo(x, this.margin);
      ctx.lineTo(x, size - this.margin);
      ctx.stroke();
      const z = this.toCanvasZ(i * B);
      ctx.beginPath();
      ctx.moveTo(this.margin, z);
      ctx.lineTo(size - this.margin, z);
      ctx.stroke();
    }

    for (const dot of dots) {
      ctx.fillStyle = dot.isPlayer ? '#ff4d4d' : '#ffd84d';
      ctx.beginPath();
      ctx.arc(this.toCanvasX(dot.x), this.toCanvasZ(dot.z), dot.isPlayer ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const px = this.toCanvasX(playerX);
    const pz = this.toCanvasZ(playerZ);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(Math.atan2(Math.sin(heading), -Math.cos(heading)));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111418';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }

  private toCanvasX(worldX: number): number {
    return this.margin + (worldX - this.minX) * this.scale;
  }

  private toCanvasZ(worldZ: number): number {
    return this.margin + (worldZ - this.minZ) * this.scale;
  }
}
