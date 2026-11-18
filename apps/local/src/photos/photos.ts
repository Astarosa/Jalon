import exifr from "exifr";
import type { Shape } from "@chantier/core";
import { drawShapes } from "@chantier/ui";
import { fetchBytes, platform, putFile } from "../platform";
import { addPhoto, registerFile, updatePhoto } from "../data/repo";

const toJpeg = (c: HTMLCanvasElement, q = 0.85) =>
  new Promise<Uint8Array>((res, rej) => c.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error("encodage"))), "image/jpeg", q));

async function scaled(src: ImageBitmap | HTMLImageElement, max: number, shapes?: Shape[]): Promise<Uint8Array> {
  const w0 = "naturalWidth" in src ? src.naturalWidth : src.width;
  const h0 = "naturalHeight" in src ? src.naturalHeight : src.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement("canvas");
  c.width = Math.round(w0 * k);
  c.height = Math.round(h0 * k);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (shapes?.length) drawShapes(ctx, shapes, c.width, c.height);
  return toJpeg(c);
}

/** Import de photos : original + vignette + version « rapport » (1600 px). */
export async function importPhotos(ticketId: string, files: File[], visitId: string | null): Promise<number> {
  let n = 0;
  for (const f of files) {
    if (!f.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) continue;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
    } catch {
      throw new Error(`Format d'image non pris en charge : ${f.name} (utilisez JPEG ou PNG)`);
    }
    let date: string | null = null;
    try {
      const ex = await exifr.parse(bytes, ["DateTimeOriginal", "CreateDate"]);
      const d: Date | undefined = ex?.DateTimeOriginal ?? ex?.CreateDate;
      if (d instanceof Date && !isNaN(d.getTime())) date = d.toISOString();
    } catch { /* pas d'EXIF */ }
    const sha = await putFile(bytes);
    await registerFile(sha, f.name, f.type || "image/jpeg", bytes.length);
    const thumb = await putFile(await scaled(bmp, 360));
    const rendu = await putFile(await scaled(bmp, 1600));
    await addPhoto({
      ticket_id: ticketId, file_sha256: sha, thumb_sha256: thumb, rendu_sha256: rendu, largeur: bmp.width, hauteur: bmp.height,
      date_prise: date ?? new Date(f.lastModified || Date.now()).toISOString(), legende: null, annotations: null,
    }, visitId);
    bmp.close();
    n++;
  }
  return n;
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("image illisible"));
    i.src = url;
  });
}

/** Enregistre les annotations et régénère la version aplatie pour les rapports. */
export async function saveAnnotations(photoId: string, fileSha: string, shapes: Shape[]) {
  const img = await loadImg(platform.fileUrl(fileSha));
  const rendu = await putFile(await scaled(img, 1600, shapes));
  const thumb = await putFile(await scaled(img, 360, shapes));
  await updatePhoto(photoId, { annotations: shapes.length ? JSON.stringify(shapes) : null, rendu_sha256: rendu, thumb_sha256: thumb });
}

export async function photoDataUrl(sha: string): Promise<string> {
  const b = await fetchBytes(platform.fileUrl(sha));
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(s)}`;
}
