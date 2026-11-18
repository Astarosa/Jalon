/**
 * Géométrie des plans : étalonnage, zones, mesures, recalage entre indices.
 *
 * Conventions :
 * - Points stockés en coordonnées RELATIVES (0..1) à la page affichée (rotation incluse), origine en haut à gauche.
 * - Les calculs se font en points PDF (1 pt = 1/72 pouce), en multipliant x par la largeur et y par la hauteur
 *   séparément : la page n'est pas carrée.
 * - Un étalonnage donne un facteur « mètres réels par point PDF ».
 */

export type Pt = { x: number; y: number };
export type Dims = { w: number; h: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Mètres sur le papier pour 1 point PDF. */
export const METRES_PAR_POINT_PAPIER = 0.0254 / 72;

export interface CalibrationLike {
  id: string;
  nom?: string | null;
  /** Zone en coordonnées relatives ; null = page entière */
  zone: Rect | null;
  metres_par_point: number;
}

export const toPt = (p: Pt, d: Dims): Pt => ({ x: p.x * d.w, y: p.y * d.h });
export const toRel = (p: Pt, d: Dims): Pt => ({ x: p.x / d.w, y: p.y / d.h });

export function distPt(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Distance en points PDF entre deux points relatifs. */
export function distRel(a: Pt, b: Pt, d: Dims): number {
  return distPt(toPt(a, d), toPt(b, d));
}

export function normRect(r: Rect): Rect {
  return { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
}

export function rectContains(r: Rect, p: Pt): boolean {
  const n = normRect(r);
  return p.x >= n.x0 && p.x <= n.x1 && p.y >= n.y0 && p.y <= n.y1;
}

const rectArea = (r: Rect) => {
  const n = normRect(r);
  return (n.x1 - n.x0) * (n.y1 - n.y0);
};

/** Étalonnage applicable en un point : la plus petite zone qui le contient, sinon l'étalonnage de page. */
export function calibrationAt<C extends CalibrationLike>(p: Pt, cals: C[]): C | undefined {
  let best: C | undefined;
  let bestArea = Infinity;
  for (const c of cals) {
    if (c.zone && rectContains(c.zone, p)) {
      const a = rectArea(c.zone);
      if (a < bestArea) {
        best = c;
        bestArea = a;
      }
    }
  }
  return best ?? cals.find((c) => !c.zone);
}

/** Étalonnage sur deux points : longueur réelle connue entre a et b (relatifs). */
export function calibrateTwoPoints(a: Pt, b: Pt, d: Dims, longueurReelleM: number): number {
  const pts = distRel(a, b, d);
  if (!(pts > 0) || !(longueurReelleM > 0)) throw new Error("Étalonnage impossible : distance nulle");
  return longueurReelleM / pts;
}

/** Étalonnage par échelle (« 1/100 ») : valable si le PDF est au format papier réel. */
export function calibrateRatio(denominateur: number): number {
  if (!(denominateur > 0)) throw new Error("Échelle invalide");
  return denominateur * METRES_PAR_POINT_PAPIER;
}

/** Lit « 1/100 », « 1:50 », « 100 », « 1/2,5 ». Retourne le dénominateur ou null. */
export function parseRatio(s: string): number | null {
  const t = s.trim().replace(",", ".").replace(/\s/g, "");
  const m = t.match(/^(?:(\d+(?:\.\d+)?)[/:])?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const num = m[1] ? parseFloat(m[1]) : 1;
  const den = parseFloat(m[2]);
  if (!(num > 0) || !(den > 0)) return null;
  return den / num;
}

/** Échelle équivalente au facteur (pour affichage « ≈ 1/100 »). */
export function ratioFromMpp(mpp: number): number {
  return mpp / METRES_PAR_POINT_PAPIER;
}

/** Écart relatif (%) entre une mesure de contrôle et la valeur attendue. */
export function controlErrorPct(mesureM: number, attenduM: number): number {
  return ((mesureM - attenduM) / attenduM) * 100;
}

export type MeasureType = "distance" | "polyligne" | "surface";

export interface MeasureResult {
  /** Longueur (m) pour distance/polyligne ; surface (m²) pour surface */
  valeur: number | null;
  /** Périmètre (m) pour surface */
  perimetre: number | null;
  calibration: CalibrationLike | undefined;
  /** Points répartis sur plusieurs zones d'étalonnage différentes */
  zonesMelangees: boolean;
}

export function polylineLengthPt(points: Pt[], d: Dims, closed = false): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += distRel(points[i - 1], points[i], d);
  if (closed && points.length > 2) s += distRel(points[points.length - 1], points[0], d);
  return s;
}

/** Aire d'un polygone (formule du lacet) en points PDF². */
export function polygonAreaPt(points: Pt[], d: Dims): number {
  let s = 0;
  const p = points.map((q) => toPt(q, d));
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function measure(type: MeasureType, points: Pt[], d: Dims, cals: CalibrationLike[]): MeasureResult {
  const cal = points.length ? calibrationAt(points[0], cals) : undefined;
  const ids = new Set(points.map((p) => calibrationAt(p, cals)?.id ?? "-"));
  const zonesMelangees = ids.size > 1;
  if (!cal) return { valeur: null, perimetre: null, calibration: undefined, zonesMelangees };
  const k = cal.metres_par_point;
  if (type === "surface") {
    if (points.length < 3) return { valeur: null, perimetre: null, calibration: cal, zonesMelangees };
    return {
      valeur: polygonAreaPt(points, d) * k * k,
      perimetre: polylineLengthPt(points, d, true) * k,
      calibration: cal,
      zonesMelangees,
    };
  }
  if (points.length < 2) return { valeur: null, perimetre: null, calibration: cal, zonesMelangees };
  return { valeur: polylineLengthPt(points, d) * k, perimetre: null, calibration: cal, zonesMelangees };
}

const nf = (digits: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatLength(m: number | null | undefined): string {
  if (m == null || !isFinite(m)) return "—";
  if (Math.abs(m) < 1) return `${nf(1).format(m * 100)} cm`;
  return `${nf(2).format(m)} m`;
}

export function formatArea(m2: number | null | undefined): string {
  if (m2 == null || !isFinite(m2)) return "—";
  return `${nf(2).format(m2)} m²`;
}

export function formatMeasure(type: MeasureType, r: MeasureResult): string {
  if (type === "surface") return r.valeur == null ? "—" : `${formatArea(r.valeur)} (périm. ${formatLength(r.perimetre)})`;
  return formatLength(r.valeur);
}

/**
 * Longueur « ronde » pour une barre d'échelle : 1, 2, 5 × 10^n mètres
 * dont la représentation fait au plus `maxPx` pixels.
 */
export function niceScaleBar(metresParPixel: number, maxPx = 140): { metres: number; px: number } {
  const maxM = metresParPixel * maxPx;
  const p = Math.pow(10, Math.floor(Math.log10(maxM)));
  const m = [5, 2, 1].map((k) => k * p).find((v) => v <= maxM) ?? p;
  return { metres: m, px: m / metresParPixel };
}

// ---------------------------------------------------------------- recalage

export interface Similarity {
  /** a, b : rotation+échelle ; tx, ty : translation (en points PDF) */
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/**
 * Similitude (échelle + rotation + translation) envoyant (s1, s2) sur (d1, d2).
 * Points en points PDF. Utilisée pour reporter les épingles d'un indice de plan sur le suivant.
 */
export function similarityFromPairs(s1: Pt, s2: Pt, d1: Pt, d2: Pt): Similarity {
  const sx = s2.x - s1.x, sy = s2.y - s1.y;
  const dx = d2.x - d1.x, dy = d2.y - d1.y;
  const den = sx * sx + sy * sy;
  if (den === 0) throw new Error("Points de recalage confondus");
  const a = (dx * sx + dy * sy) / den;
  const b = (dy * sx - dx * sy) / den;
  return { a, b, tx: d1.x - (a * s1.x - b * s1.y), ty: d1.y - (b * s1.x + a * s1.y) };
}

export function applySimilarity(t: Similarity, p: Pt): Pt {
  return { x: t.a * p.x - t.b * p.y + t.tx, y: t.b * p.x + t.a * p.y + t.ty };
}

/** Report d'un point relatif d'une page (dims src) vers une autre (dims dst), avec recalage optionnel. */
export function transferPoint(p: Pt, src: Dims, dst: Dims, t?: Similarity): Pt {
  if (!t) return { x: p.x, y: p.y };
  return toRel(applySimilarity(t, toPt(p, src)), dst);
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// --------------------------------------------------------- échelle PDF (/Measure)

/** Conversion d'unités rencontrées dans les dictionnaires /Measure. */
const UNIT_M: Record<string, number> = {
  m: 1, mm: 0.001, cm: 0.01, dm: 0.1, km: 1000,
  in: 0.0254, "\"": 0.0254, ft: 0.3048, "'": 0.3048, yd: 0.9144, mi: 1609.344,
  pt: METRES_PAR_POINT_PAPIER,
};

/**
 * Facteur mètres/point d'après le tableau /X d'un dictionnaire /Measure /RL :
 * chaque entrée {U, C} convertit l'unité précédente (le point PDF pour la première) en U.
 * Retourne null si l'unité finale est inconnue.
 */
export function mppFromNumberFormats(formats: { U?: string; C?: number }[]): number | null {
  if (!formats.length || typeof formats[0].C !== "number" || !(formats[0].C > 0)) return null;
  // Seule la première entrée convertit depuis le point PDF ; les suivantes sont des sous-divisions (ex. ft puis in).
  const unit = (formats[0].U ?? "").trim().toLowerCase();
  const um = UNIT_M[unit];
  if (um == null) return null;
  return formats[0].C! * um;
}
