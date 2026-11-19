/**
 * Traitement des plans PDF : lecture, découpage en tuiles, échelle intégrée (/VP /Measure),
 * points d'accrochage vectoriels.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString } from "pdf-lib";
import { mppFromNumberFormats, SnapIndex, type Rect } from "@chantier/core";
import { fetchBytes, platform, putTile, tilesComplete, tilesStatus } from "../platform";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const asset = (p: string) => new URL(p, window.location.href).href;
const STANDARD_FONTS = asset("/pdfjs/standard_fonts/");
const CMAPS = asset("/pdfjs/cmaps/");
const WASM = asset("/pdfjs/wasm/");

export type PdfDoc = pdfjs.PDFDocumentProxy;

export function loadPdf(bytes: Uint8Array): Promise<PdfDoc> {
  return pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    wasmUrl: WASM,
  }).promise;
}

/** Cache des documents ouverts (par empreinte). */
const docCache = new Map<string, Promise<PdfDoc>>();
export function openPdfBySha(sha: string): Promise<PdfDoc> {
  let p = docCache.get(sha);
  if (!p) {
    p = fetchBytes(platform.fileUrl(sha)).then(loadPdf);
    docCache.set(sha, p);
    p.catch(() => docCache.delete(sha));
  }
  return p;
}

export interface PageInfo {
  index: number;
  w: number;
  h: number;
  /** Format papier approximatif (A0…A4) ou dimensions en mm */
  format: string;
  thumb: string;
}

const FORMATS: [string, number, number][] = [
  ["A0", 841, 1189], ["A1", 594, 841], ["A2", 420, 594], ["A3", 297, 420], ["A4", 210, 297],
];
export function paperFormat(wPt: number, hPt: number): string {
  const w = (wPt * 25.4) / 72, h = (hPt * 25.4) / 72;
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  for (const [n, fw, fh] of FORMATS) if (Math.abs(a - fw) < 6 && Math.abs(b - fh) < 6) return `${n} ${w > h ? "paysage" : "portrait"}`;
  return `${Math.round(w)} × ${Math.round(h)} mm`;
}

export async function describePages(doc: PdfDoc, thumbSize = 220): Promise<PageInfo[]> {
  const out: PageInfo[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const scale = thumbSize / Math.max(vp.width, vp.height);
    const tv = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.ceil(tv.width);
    c.height = Math.ceil(tv.height);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, canvas: c, viewport: tv }).promise;
    out.push({ index: i, w: vp.width, h: vp.height, format: paperFormat(vp.width, vp.height), thumb: c.toDataURL("image/jpeg", 0.8) });
  }
  return out;
}

// ------------------------------------------------------------------- tuiles

export const TILE = 512;
export interface TileMeta {
  zMin: number;
  zMax: number;
  tile: number;
  w: number;
  h: number;
  /** Révision du jeu de tuiles (contourne le cache du navigateur après régénération) */
  rev?: number;
}

/** Niveaux de zoom : au plus fin, 4 px par point (≈ 11 px/mm papier), limité à 16 384 px. */
export function tileLevels(w: number, h: number): { zMin: number; zMax: number } {
  const L = Math.max(w, h);
  const zMax = Math.min(2, Math.floor(Math.log2(16384 / L)));
  const zMin = Math.floor(Math.log2(TILE / L));
  return { zMin, zMax };
}

const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encodage tuile"))), "image/webp", 0.92));

/**
 * Génère toutes les tuiles d'une page. Rendu par bandes horizontales (peu de passes de rendu),
 * puis découpage en tuiles de 512 px encodées en WebP.
 */
export async function renderTiles(
  doc: PdfDoc, pageIndex: number, pvid: string, onProgress?: (done: number, total: number) => void,
): Promise<TileMeta> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const { zMin, zMax } = tileLevels(base.width, base.height);
  const levels: { z: number; cols: number; rows: number }[] = [];
  for (let z = zMin; z <= zMax; z++) {
    const s = 2 ** z;
    levels.push({ z, cols: Math.ceil((base.width * s) / TILE), rows: Math.ceil((base.height * s) / TILE) });
  }
  const total = levels.reduce((a, l) => a + l.cols * l.rows, 0);
  let done = 0;
  const strip = document.createElement("canvas");
  const tile = document.createElement("canvas");
  tile.width = tile.height = TILE;
  const tctx = tile.getContext("2d")!;
  for (const { z, cols, rows } of levels) {
    const s = 2 ** z;
    const viewport = page.getViewport({ scale: s });
    const k = Math.max(1, Math.floor((32 * 1024 * 1024) / (cols * TILE * TILE)));
    for (let r0 = 0; r0 < rows; r0 += k) {
      const nr = Math.min(k, rows - r0);
      strip.width = cols * TILE;
      strip.height = nr * TILE;
      const ctx = strip.getContext("2d")!;
      // fond blanc limité à la page : au-delà, la tuile reste transparente
      ctx.clearRect(0, 0, strip.width, strip.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, Math.ceil(base.width * s), Math.ceil(base.height * s) - r0 * TILE);
      await page.render({ canvasContext: ctx, canvas: strip, viewport, transform: [1, 0, 0, 1, 0, -r0 * TILE] }).promise;
      // pdf.js peint tout le canevas en blanc : on rend transparent ce qui dépasse de la page
      const pw = Math.ceil(base.width * s), ph = Math.ceil(base.height * s) - r0 * TILE;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (pw < strip.width) ctx.clearRect(pw, 0, strip.width - pw, strip.height);
      if (ph < strip.height) ctx.clearRect(0, Math.max(0, ph), strip.width, strip.height - Math.max(0, ph));
      const uploads: Promise<unknown>[] = [];
      for (let r = 0; r < nr; r++)
        for (let c = 0; c < cols; c++) {
          tctx.clearRect(0, 0, TILE, TILE);
          tctx.drawImage(strip, c * TILE, r * TILE, TILE, TILE, 0, 0, TILE, TILE);
          const blob = await toBlob(tile);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          uploads.push(putTile(`${pvid}/${z}/${c}/${r0 + r}`, bytes));
          done++;
          if (uploads.length >= 16) await Promise.all(uploads.splice(0));
        }
      await Promise.all(uploads);
      onProgress?.(done, total);
    }
  }
  strip.width = strip.height = 0;
  const meta: TileMeta = { zMin, zMax, tile: TILE, w: base.width, h: base.height, rev: Date.now() };
  await tilesComplete(pvid, meta);
  page.cleanup();
  return meta;
}

/** Retourne les tuiles existantes ou les (re)génère (ex. après une restauration). */
export async function ensureTiles(
  pvid: string, sha: string, pageIndex: number, onProgress?: (done: number, total: number) => void,
): Promise<TileMeta> {
  const st = await tilesStatus<TileMeta>(pvid);
  if (st && typeof st.zMax === "number") return st;
  const doc = await openPdfBySha(sha);
  return renderTiles(doc, pageIndex, pvid, onProgress);
}

// ---------------------------------------------------------- échelle intégrée

export interface PdfScale {
  /** Zone en coordonnées relatives ; null si le cadre couvre presque toute la page */
  zone: Rect | null;
  nom: string;
  metres_par_point: number;
}

const text = (o: unknown): string | undefined =>
  o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : undefined;

/**
 * Lit les cadres de mesure (/VP → /Measure /RL) d'une page. ArchiCAD, Revit, AutoCAD… peuvent
 * les écrire à l'export : chaque vue placée sur la mise en page porte alors sa propre échelle.
 */
export async function readPdfScales(bytes: Uint8Array, doc: PdfDoc, pageIndex: number): Promise<PdfScale[]> {
  try {
    const lib = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const node = lib.getPage(pageIndex).node;
    const vps = node.lookup(PDFName.of("VP"));
    if (!(vps instanceof PDFArray)) return [];
    const page = await doc.getPage(pageIndex + 1);
    const vp = page.getViewport({ scale: 1 });
    const out: PdfScale[] = [];
    for (let i = 0; i < vps.size(); i++) {
      const d = vps.lookup(i);
      if (!(d instanceof PDFDict)) continue;
      const measure = d.lookup(PDFName.of("Measure"));
      if (!(measure instanceof PDFDict)) continue;
      const xs = measure.lookup(PDFName.of("X"));
      if (!(xs instanceof PDFArray)) continue;
      const formats: { U?: string; C?: number }[] = [];
      for (let j = 0; j < xs.size(); j++) {
        const nfd = xs.lookup(j);
        if (!(nfd instanceof PDFDict)) continue;
        const c = nfd.lookup(PDFName.of("C"));
        formats.push({ U: text(nfd.lookup(PDFName.of("U"))), C: c instanceof PDFNumber ? c.asNumber() : undefined });
      }
      const mpp = mppFromNumberFormats(formats);
      if (!mpp) continue;
      const bb = d.lookup(PDFName.of("BBox"));
      let zone: Rect | null = null;
      if (bb instanceof PDFArray && bb.size() === 4) {
        const nums = [0, 1, 2, 3].map((k) => (bb.lookup(k) as PDFNumber).asNumber());
        const [x0, y0] = vp.convertToViewportPoint(nums[0], nums[1]) as number[];
        const [x1, y1] = vp.convertToViewportPoint(nums[2], nums[3]) as number[];
        zone = {
          x0: Math.min(x0, x1) / vp.width, y0: Math.min(y0, y1) / vp.height,
          x1: Math.max(x0, x1) / vp.width, y1: Math.max(y0, y1) / vp.height,
        };
        if ((zone.x1 - zone.x0) * (zone.y1 - zone.y0) > 0.9) zone = null;
      }
      out.push({ zone, nom: text(d.lookup(PDFName.of("Name"))) ?? `Vue ${i + 1}`, metres_par_point: mpp });
    }
    return out;
  } catch (e) {
    console.warn("lecture /VP impossible", e);
    return [];
  }
}

// ------------------------------------------------------- rendu net (vectoriel)

/**
 * Rendu direct d'une portion de page par pdf.js, à la résolution exacte demandée :
 * utilisé par la visionneuse pour la zone visible et pour la loupe (les tuiles ne servent
 * qu'à l'affichage immédiat pendant les déplacements).
 */
export function hdRenderer(sha: string, pageIndex: number) {
  const pageP = openPdfBySha(sha).then((d) => d.getPage(pageIndex + 1));
  return (canvas: HTMLCanvasElement, scale: number, ox: number, oy: number) => {
    let cancelled = false;
    let task: ReturnType<pdfjs.PDFPageProxy["render"]> | null = null;
    const promise = pageP.then(async (page) => {
      if (cancelled) throw new Error("annulé");
      const viewport = page.getViewport({ scale });
      task = page.render({ canvasContext: canvas.getContext("2d")!, canvas, viewport, transform: [1, 0, 0, 1, -ox, -oy] });
      await task.promise;
    });
    return {
      promise,
      cancel: () => {
        cancelled = true;
        task?.cancel();
      },
    };
  };
}

// ------------------------------------------------------------- accrochage

const snapCache = new Map<string, Promise<SnapIndex>>();

type M = number[];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/**
 * Index des extrémités et milieux de segments du dessin vectoriel, en points (repère de la page affichée).
 * Plafonné pour les plans très chargés (hachures).
 */
export function snapIndexFor(sha: string, pageIndex: number, limit = 600_000): Promise<SnapIndex> {
  const key = `${sha}#${pageIndex}`;
  let p = snapCache.get(key);
  if (!p) {
    p = (async () => {
      const doc = await openPdfBySha(sha);
      const page = await doc.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      const O = pdfjs.OPS;
      const idx = new SnapIndex(8);
      let ctm: M = vp.transform.slice();
      const stack: M[] = [];
      const add = (x: number, y: number) => {
        const px = ctm[0] * x + ctm[2] * y + ctm[4];
        const py = ctm[1] * x + ctm[3] * y + ctm[5];
        if (px >= 0 && py >= 0 && px <= vp.width && py <= vp.height) idx.add(px, py);
      };
      for (let i = 0; i < ops.fnArray.length && idx.size < limit; i++) {
        const fn = ops.fnArray[i];
        const a = ops.argsArray[i];
        if (fn === O.save) stack.push(ctm);
        else if (fn === O.restore) ctm = stack.pop() ?? ctm;
        else if (fn === O.transform) ctm = mul(ctm, a as M);
        else if (fn === O.paintFormXObjectBegin) {
          stack.push(ctm);
          if (Array.isArray(a?.[0]) || ArrayBuffer.isView(a?.[0])) ctm = mul(ctm, Array.from(a[0] as ArrayLike<number>));
        } else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
        else if (fn === O.constructPath) {
          const data = a?.[1]?.[0] as ArrayLike<number> | undefined;
          if (!data) continue;
          let cx = 0, cy = 0, sx = 0, sy = 0;
          for (let k = 0; k < data.length; ) {
            const op = data[k++];
            if (op === 0) {
              cx = sx = data[k++];
              cy = sy = data[k++];
              add(cx, cy);
            } else if (op === 1) {
              const nx = data[k++], ny = data[k++];
              add(nx, ny);
              add((cx + nx) / 2, (cy + ny) / 2);
              cx = nx;
              cy = ny;
            } else if (op === 2) {
              k += 4;
              cx = data[k++];
              cy = data[k++];
              add(cx, cy);
            } else if (op === 3) {
              k += 2;
              cx = data[k++];
              cy = data[k++];
              add(cx, cy);
            } else if (op === 4) {
              add((cx + sx) / 2, (cy + sy) / 2);
              cx = sx;
              cy = sy;
            } else break;
          }
        }
      }
      return idx;
    })();
    snapCache.set(key, p);
    p.catch(() => snapCache.delete(key));
  }
  return p;
}

// ------------------------------------------------------- extrait de plan

/**
 * Image d'un extrait de plan centré sur un point (pour les rapports), composée à partir des tuiles.
 * `spanPt` : largeur de l'extrait en points PDF.
 */
export async function planExtract(
  pvid: string, meta: TileMeta, center: { x: number; y: number }, spanPt: number, outW = 640, outH = 400,
  draw?: (ctx: CanvasRenderingContext2D, toPx: (relX: number, relY: number) => [number, number]) => void,
): Promise<string> {
  const z = Math.max(meta.zMin, Math.min(meta.zMax, Math.ceil(Math.log2(outW / spanPt))));
  const s = 2 ** z;
  const cxPx = center.x * meta.w * s, cyPx = center.y * meta.h * s;
  const k = outW / (spanPt * s);
  const wPx = outW / k, hPx = outH / k;
  const left = cxPx - wPx / 2, top = cyPx - hPx / 2;
  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, outW, outH);
  const maxC = Math.ceil((meta.w * s) / meta.tile) - 1, maxR = Math.ceil((meta.h * s) / meta.tile) - 1;
  const jobs: Promise<void>[] = [];
  for (let tx = Math.max(0, Math.floor(left / meta.tile)); tx <= Math.min(maxC, Math.floor((left + wPx) / meta.tile)); tx++)
    for (let ty = Math.max(0, Math.floor(top / meta.tile)); ty <= Math.min(maxR, Math.floor((top + hPx) / meta.tile)); ty++)
      jobs.push(
        new Promise((res) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            ctx.drawImage(img, (tx * meta.tile - left) * k, (ty * meta.tile - top) * k, meta.tile * k, meta.tile * k);
            res();
          };
          img.onerror = () => res();
          img.src = platform.tileUrl(pvid, z, tx, ty, meta.rev);
        }),
      );
  await Promise.all(jobs);
  draw?.(ctx, (rx, ry) => [(rx * meta.w * s - left) * k, (ry * meta.h * s - top) * k]);
  return c.toDataURL("image/jpeg", 0.88);
}
