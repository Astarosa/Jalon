/** Mesures (traits, longueurs, surfaces) dans les rapports : tracés sur les plans et tableaux. */
import {
  STATUTS, measure, formatArea, formatLength, ratioFromMpp, type MeasureType, type MeasureResult, type PlanVersion, type Plan,
  type Statut, type Ticket,
} from "@chantier/core";
import { listCalibrations, listMeasurements, type Calibration, type MeasurementP } from "../data/repo";
import { hdRenderer } from "../pdf/pdf";

export interface RMeasure extends MeasurementP {
  ref: string;
  result: MeasureResult;
}

export interface VersionMeasures {
  v: PlanVersion;
  plan: Plan;
  cals: Calibration[];
  list: RMeasure[];
}

const TYPE_LABEL: Record<string, string> = { distance: "Distance", polyligne: "Longueur", surface: "Surface" };

export function measureValue(m: RMeasure): string {
  if (m.result.valeur == null) return "non étalonné";
  return m.type === "surface" ? formatArea(m.result.valeur) : formatLength(m.result.valeur);
}

/** Mesures d'une version de plan, numérotées M1, M2… dans l'ordre de création. */
export async function loadVersionMeasures(v: PlanVersion, plan: Plan): Promise<VersionMeasures> {
  const cals = await listCalibrations(v.id);
  const dims = { w: v.largeur_pt, h: v.hauteur_pt };
  const list = (await listMeasurements(v.id)).map((m, i) => ({
    ...m, ref: `M${i + 1}`, result: measure(m.type as MeasureType, m.pts, dims, cals),
  }));
  return { v, plan, cals, list };
}

/**
 * Dessine les mesures sur un canevas. `toPx` convertit un point relatif en pixels ;
 * `u` est l'unité graphique (épaisseurs, textes) en pixels.
 */
export function drawMeasures(
  ctx: CanvasRenderingContext2D, toPx: (x: number, y: number) => [number, number], items: RMeasure[], u: number,
) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const m of items) {
    const color = m.couleur ?? "#e8590c";
    const pts = m.pts.map((p) => toPx(p.x, p.y));
    if (pts.length < 2) continue;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (m.type === "surface") {
      ctx.closePath();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 2.2 * u;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (m.type !== "surface")
      for (const [x, y] of [pts[0], pts[pts.length - 1]]) {
        ctx.beginPath();
        ctx.arc(x, y, 3 * u, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 1.8 * u;
        ctx.stroke();
      }
    // étiquette : référence + valeur, au centre de la forme
    let cx: number, cy: number;
    if (m.type === "surface") {
      cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    } else {
      const mid = Math.floor((pts.length - 1) / 2);
      cx = (pts[mid][0] + pts[mid + 1][0]) / 2;
      cy = (pts[mid][1] + pts[mid + 1][1]) / 2;
    }
    const text = `${m.ref} · ${measureValue(m)}`;
    ctx.font = `600 ${11 * u}px 'IBM Plex Mono', monospace`;
    const tw = ctx.measureText(text).width;
    const pad = 4 * u, th = 15 * u;
    ctx.fillStyle = "#17202a";
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.roundRect(cx - tw / 2 - pad, cy - th / 2, tw + pad * 2, th, 3 * u);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy + 0.5 * u);
  }
  ctx.restore();
}

/** Petite pastille numérotée d'un point (vue d'ensemble). */
function drawPinDot(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, color: string, u: number) {
  ctx.beginPath();
  ctx.arc(x, y, 9 * u, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${9 * u}px 'IBM Plex Mono', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), x, y + 0.5 * u);
}

/**
 * Vue d'ensemble nette d'un plan (rendu vectoriel pdf.js) avec mesures et points.
 * Recadrée sur l'emprise des mesures (avec marge) pour rester lisible sur une page A4.
 */
export async function overviewImage(vm: VersionMeasures, items: RMeasure[], tickets: Ticket[], outW = 1800): Promise<{ src: string; ratio: number }> {
  const W = vm.v.largeur_pt, H = vm.v.hauteur_pt;
  const xs = items.flatMap((m) => m.pts.map((p) => p.x)), ys = items.flatMap((m) => m.pts.map((p) => p.y));
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // marge de 15 % et cadre minimal de 25 % de la page
  const mx = Math.max((x1 - x0) * 0.15, 0.02), my = Math.max((y1 - y0) * 0.15, 0.02);
  x0 -= mx; x1 += mx; y0 -= my; y1 += my;
  const minW = 0.25;
  if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
  if ((y1 - y0) * H < minW * W * 0.5) { const c = (y0 + y1) / 2, hh = (minW * W * 0.5) / H; y0 = c - hh / 2; y1 = c + hh / 2; }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1, x1); y1 = Math.min(1, y1);
  const wPt = (x1 - x0) * W, hPt = (y1 - y0) * H;
  const k = outW / wPt;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(wPt * k);
  canvas.height = Math.round(hPt * k);
  await hdRenderer(vm.v.file_sha256, vm.v.page_index)(canvas, k, x0 * W * k, y0 * H * k).promise;
  const ctx = canvas.getContext("2d")!;
  const toPx = (x: number, y: number): [number, number] => [(x - x0) * W * k, (y - y0) * H * k];
  const u = canvas.width / 900;
  drawMeasures(ctx, toPx, items, u);
  for (const t of tickets)
    if (t.x != null && t.y != null && t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1) {
      const [px, py] = toPx(t.x, t.y);
      drawPinDot(ctx, px, py, t.numero, STATUTS[t.statut as Statut]?.couleur ?? "#666", u);
    }
  return { src: canvas.toDataURL("image/jpeg", 0.86), ratio: canvas.height / canvas.width };
}

export interface RMeasureRow {
  ref: string;
  libelle: string;
  type: string;
  valeur: string;
  perimetre: string;
  echelle: string;
  point: string;
  notes: string;
}

export function measureRows(items: RMeasure[], tickets: Ticket[]): RMeasureRow[] {
  return items.map((m) => {
    const t = m.ticket_id ? tickets.find((x) => x.id === m.ticket_id) : undefined;
    const cal = m.result.calibration;
    return {
      ref: m.ref,
      libelle: m.libelle ?? "",
      type: TYPE_LABEL[m.type] ?? m.type,
      valeur: measureValue(m) + (m.result.zonesMelangees ? " *" : ""),
      perimetre: m.type === "surface" ? formatLength(m.result.perimetre) : "",
      echelle: cal ? `1/${Math.round(ratioFromMpp(cal.metres_par_point))}` : "—",
      point: t ? `#${t.numero}` : "",
      notes: m.notes ?? "",
    };
  });
}

export interface RMeasureSection {
  titre: string;
  images: { legende: string; src: string; ratio: number }[];
  rows: RMeasureRow[];
}

/** Sections « Mesures » : une par version de plan ayant des mesures retenues par `keep`. */
export async function measureSections(
  versions: { v: PlanVersion; plan: Plan }[], tickets: Ticket[], keep: (m: RMeasure) => boolean = () => true,
): Promise<RMeasureSection[]> {
  const out: RMeasureSection[] = [];
  for (const { v, plan } of versions) {
    const vm = await loadVersionMeasures(v, plan);
    const items = vm.list.filter(keep);
    if (!items.length) continue;
    const ts = tickets.filter((t) => t.plan_version_id === v.id);
    // une image par zone d'échelle (plan principal, détail au 1/20…) pour garder chaque vue lisible
    const groups = new Map<string, { legende: string; items: RMeasure[] }>();
    for (const m of items) {
      const cal = m.result.calibration as Calibration | undefined;
      const key = cal?.zone ? cal.id : "page";
      const legende = cal?.zone ? `${cal.nom ?? "Zone"} (1/${Math.round(ratioFromMpp(cal.metres_par_point))})` : "Plan";
      if (!groups.has(key)) groups.set(key, { legende, items: [] });
      groups.get(key)!.items.push(m);
    }
    const images = [];
    for (const g of groups.values()) {
      const img = await overviewImage(vm, g.items, ts);
      images.push({ legende: g.legende, src: img.src, ratio: img.ratio });
    }
    out.push({ titre: `${plan.nom}${plan.niveau ? ` · ${plan.niveau}` : ""} — indice ${v.indice}`, images, rows: measureRows(items, tickets) });
  }
  return out;
}
