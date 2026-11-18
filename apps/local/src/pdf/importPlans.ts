import { putFile } from "../platform";
import { addPlanVersion, copyCalibrations, createPlan, listCalibrations, registerFile, saveCalibration } from "../data/repo";
import { loadPdf, readPdfScales, renderTiles, type PageInfo, type PdfDoc } from "./pdf";

export interface PageChoice {
  page: PageInfo;
  nom: string;
  niveau: string;
  indice: string;
}

export interface LoadedPdf {
  bytes: Uint8Array;
  name: string;
  doc: PdfDoc;
}

export async function openLocalPdf(file: File): Promise<LoadedPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await loadPdf(bytes);
  return { bytes, name: file.name, doc };
}

async function storePdf(pdf: LoadedPdf): Promise<string> {
  const sha = await putFile(pdf.bytes);
  await registerFile(sha, pdf.name, "application/pdf", pdf.bytes.length);
  return sha;
}

async function applyPdfScales(pdf: LoadedPdf, pageIndex: number, pvid: string): Promise<number> {
  const scales = await readPdfScales(pdf.bytes, pdf.doc, pageIndex);
  for (const s of scales)
    await saveCalibration({ plan_version_id: pvid, methode: "pdf", nom: s.zone ? s.nom : "Échelle du PDF", zone: s.zone, metres_par_point: s.metres_par_point });
  return scales.length;
}

/** Import de nouvelles pages comme nouveaux plans. */
export async function importNewPlans(
  projectId: string, pdf: LoadedPdf, choices: PageChoice[], progress: (msg: string, frac: number) => void,
): Promise<{ planId: string; versionId: string; scales: number }[]> {
  const sha = await storePdf(pdf);
  const out = [];
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    const { planId, versionId } = await createPlan(projectId, c.nom, c.niveau || null, {
      indice: c.indice || "A", file_sha256: sha, nom_fichier: pdf.name, page_index: c.page.index, largeur_pt: c.page.w, hauteur_pt: c.page.h,
    });
    await renderTiles(pdf.doc, c.page.index, versionId, (d, t) => progress(`Préparation de « ${c.nom} » (${i + 1}/${choices.length})`, (i + d / t) / choices.length));
    const scales = await applyPdfScales(pdf, c.page.index, versionId);
    out.push({ planId, versionId, scales });
  }
  return out;
}

/** Import d'un nouvel indice pour un plan existant. */
export async function importNewIndice(
  planId: string, prevVersion: { id: string; largeur_pt: number; hauteur_pt: number } | undefined, pdf: LoadedPdf, page: PageInfo, indice: string,
  progress: (msg: string, frac: number) => void,
): Promise<{ versionId: string; scales: number; copied: number; sameSize: boolean }> {
  const sha = await storePdf(pdf);
  const versionId = await addPlanVersion(planId, {
    indice, file_sha256: sha, nom_fichier: pdf.name, page_index: page.index, largeur_pt: page.w, hauteur_pt: page.h,
  });
  await renderTiles(pdf.doc, page.index, versionId, (d, t) => progress(`Préparation de l'indice ${indice}`, d / t));
  const scales = await applyPdfScales(pdf, page.index, versionId);
  const sameSize = !!prevVersion && Math.abs(prevVersion.largeur_pt - page.w) < 1 && Math.abs(prevVersion.hauteur_pt - page.h) < 1;
  let copied = 0;
  if (!scales && sameSize && prevVersion && (await listCalibrations(prevVersion.id)).length) copied = await copyCalibrations(prevVersion.id, versionId);
  return { versionId, scales, copied, sameSize };
}
