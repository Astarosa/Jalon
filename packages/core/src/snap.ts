/**
 * Index spatial des points d'accrochage (extrémités et milieux des traits vectoriels du PDF),
 * en points PDF. Grille uniforme : recherche du plus proche voisin en O(1) en moyenne.
 */
export class SnapIndex {
  private cells = new Map<number, number[]>();
  private xs: number[] = [];
  private ys: number[] = [];
  constructor(private cell: number) {}

  get size() {
    return this.xs.length;
  }

  private key(cx: number, cy: number) {
    return cx * 100003 + cy;
  }

  add(x: number, y: number) {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    const k = this.key(cx, cy);
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, (arr = []));
    // Dédoublonnage grossier (points identiques à 0,01 pt près)
    for (const i of arr) if (Math.abs(this.xs[i] - x) < 0.01 && Math.abs(this.ys[i] - y) < 0.01) return;
    arr.push(this.xs.length);
    this.xs.push(x);
    this.ys.push(y);
  }

  /** Point le plus proche à moins de `maxDist` (points PDF), ou null. */
  nearest(x: number, y: number, maxDist: number): { x: number; y: number } | null {
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best = -1, bd = maxDist * maxDist;
    for (let i = cx - r; i <= cx + r; i++)
      for (let j = cy - r; j <= cy + r; j++) {
        const arr = this.cells.get(this.key(i, j));
        if (!arr) continue;
        for (const k of arr) {
          const dx = this.xs[k] - x, dy = this.ys[k] - y, d = dx * dx + dy * dy;
          if (d <= bd) {
            bd = d;
            best = k;
          }
        }
      }
    return best < 0 ? null : { x: this.xs[best], y: this.ys[best] };
  }
}
