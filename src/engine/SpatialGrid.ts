export interface Positioned {
  x: number;
  y: number;
}

/**
 * Uniform 2D spatial hash over a bounded square world. Buckets are reused across
 * rebuilds so per-tick `clear()` + `insert()` does not allocate.
 */
export class SpatialGrid<T extends Positioned> {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  private readonly cells: T[][];

  constructor(worldWidth: number, worldHeight: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(worldWidth / cellSize));
    this.rows = Math.max(1, Math.ceil(worldHeight / cellSize));
    this.cells = Array.from({ length: this.cols * this.rows }, () => [] as T[]);
  }

  clear(): void {
    for (let i = 0; i < this.cells.length; i++) this.cells[i].length = 0;
  }

  private cellCoord(v: number, max: number): number {
    const c = Math.floor(v / this.cellSize);
    return c < 0 ? 0 : c >= max ? max - 1 : c;
  }

  insert(item: T): void {
    const cx = this.cellCoord(item.x, this.cols);
    const cy = this.cellCoord(item.y, this.rows);
    this.cells[cy * this.cols + cx].push(item);
  }

  /**
   * Visit every item within `radius` of (x, y). Return `true` from the visitor to stop early.
   * Distances passed to the visitor are squared to avoid needless square roots.
   */
  query(x: number, y: number, radius: number, visit: (item: T, distSq: number) => boolean | void): void {
    const r2 = radius * radius;
    const minX = this.cellCoord(x - radius, this.cols);
    const maxX = this.cellCoord(x + radius, this.cols);
    const minY = this.cellCoord(y - radius, this.rows);
    const maxY = this.cellCoord(y + radius, this.rows);
    for (let cy = minY; cy <= maxY; cy++) {
      const rowOffset = cy * this.cols;
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.cells[rowOffset + cx];
        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i];
          const dx = item.x - x;
          const dy = item.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && visit(item, d2) === true) return;
        }
      }
    }
  }

  /** Nearest item within `radius` that satisfies `accept`, or null. */
  nearest(x: number, y: number, radius: number, accept: (item: T) => boolean): T | null {
    let best: T | null = null;
    let bestD2 = Infinity;
    this.query(x, y, radius, (item, d2) => {
      if (d2 < bestD2 && accept(item)) {
        best = item;
        bestD2 = d2;
      }
    });
    return best;
  }
}
