import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import {
  STATUTS, isEnRetard, measure, formatMeasure, safeFileName, todayIso, type MeasureType, type Ticket, type Statut,
} from "@chantier/core";
import {
  getIdentity, getProject, getVisit, listAssignments, listCalibrations, listChecklists, listEvents, listLots, listMeasurementsForTicket,
  listPhotosForTickets, listPlans, listTickets, ticketsTouchedInVisit,
} from "../data/repo";
import { ensureTiles, planExtract, type TileMeta } from "../pdf/pdf";
import { photoDataUrl } from "../photos/photos";
import { writeReport } from "../platform";
import { CompanyReport, GlobalReport, VisitReport, type Identity, type ProjectInfo, type RTicket, type RChecklist } from "./docs";

export interface ReportOptions {
  planExtracts: boolean;
  photos: boolean;
  maxPhotos: number;
}
const DEFAULT_OPTS: ReportOptions = { planExtracts: true, photos: true, maxPhotos: 3 };

async function context(projectId: string) {
  const [project, lots, assignments, plans, identity] = await Promise.all([
    getProject(projectId), listLots(projectId), listAssignments(projectId), listPlans(projectId), getIdentity(),
  ]);
  if (!project) throw new Error("Chantier introuvable");
  const versions = new Map(plans.flatMap((p) => p.versions.map((v) => [v.id, { v, plan: p.plan }] as const)));
  const id: Identity = { ...identity, logo: identity.logo_sha256 ? await photoDataUrl(identity.logo_sha256).catch(() => null) : null };
  const info: ProjectInfo = { nom: project.nom, reference: project.reference, adresse: project.adresse, moa: project.moa };
  return { project, lots, assignments, versions, id, info };
}

type Ctx = Awaited<ReturnType<typeof context>>;

async function buildTickets(c: Ctx, tickets: Ticket[], o: ReportOptions): Promise<RTicket[]> {
  const lotBy = Object.fromEntries(c.lots.map((l) => [l.id, l]));
  const compBy = Object.fromEntries(c.assignments.map((a) => [a.company.id, a.company]));
  const photos = o.photos ? await listPhotosForTickets(tickets.map((t) => t.id)) : [];
  const metaCache = new Map<string, TileMeta>();
  const calCache = new Map<string, Awaited<ReturnType<typeof listCalibrations>>>();
  const out: RTicket[] = [];
  for (const t of tickets) {
    const pv = t.plan_version_id ? c.versions.get(t.plan_version_id) : undefined;
    let planImg: string | null = null;
    if (o.planExtracts && pv && t.x != null && t.y != null) {
      let meta = metaCache.get(pv.v.id);
      if (!meta) {
        meta = await ensureTiles(pv.v.id, pv.v.file_sha256, pv.v.page_index);
        metaCache.set(pv.v.id, meta);
      }
      const color = STATUTS[t.statut as Statut]?.couleur ?? "#e8590c";
      planImg = await planExtract(pv.v.id, meta, { x: t.x, y: t.y }, Math.max(meta.w, meta.h) * 0.16, 640, 400, (ctx, toPx) => {
        const [px, py] = toPx(t.x!, t.y!);
        // épingle + cercle de repérage
        ctx.beginPath();
        ctx.arc(px, py, 40, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py - 40, 24, 0, Math.PI * 2);
        ctx.moveTo(px - 15, py - 22);
        ctx.lineTo(px, py);
        ctx.lineTo(px + 15, py - 22);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "600 22px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(t.numero), px, py - 40);
      });
    }
    const ph = photos.filter((p) => p.ticket_id === t.id).slice(0, o.maxPhotos);
    const photoSrcs = [];
    for (const p of ph) photoSrcs.push({ src: await photoDataUrl(p.rendu_sha256 ?? p.file_sha256), legende: p.legende });
    const mesures: string[] = [];
    if (pv) {
      const ms = (await listMeasurementsForTicket(t.id)).filter((m) => m.plan_version_id === t.plan_version_id);
      if (ms.length) {
        let cals = calCache.get(pv.v.id);
        if (!cals) calCache.set(pv.v.id, (cals = await listCalibrations(pv.v.id)));
        for (const m of ms) {
          const dims = { w: pv.v.largeur_pt, h: pv.v.hauteur_pt };
          mesures.push(`${m.libelle ? m.libelle + " " : ""}${formatMeasure(m.type as MeasureType, measure(m.type as MeasureType, m.pts, dims, cals))}`);
        }
      }
    }
    const comments = (await listEvents(t.id)).filter((e) => e.type === "commentaire").slice(0, 2).map((e) => e.texte ?? "");
    out.push({
      numero: t.numero, titre: t.titre, type: t.type, statut: t.statut, priorite: t.priorite, description: t.description, localisation: t.localisation,
      lot: lotBy[t.lot_id ?? ""]?.nom ?? null, lotColor: lotBy[t.lot_id ?? ""]?.couleur ?? null, entreprise: compBy[t.company_id ?? ""]?.nom ?? null,
      echeance: t.echeance, retard: isEnRetard(t), plan: pv ? `${pv.plan.nom} (ind. ${pv.v.indice})` : null, planImg, photos: photoSrcs, mesures,
      derniersCommentaires: comments, created_at: t.created_at,
    });
  }
  return out;
}

async function save(c: Ctx, name: string, doc: Parameters<typeof pdf>[0]): Promise<{ path: string; bytes: Uint8Array; name: string }> {
  const blob = await pdf(doc).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const fname = safeFileName(name) + ".pdf";
  const path = await writeReport(safeFileName(c.project.nom), fname, bytes);
  return { path, bytes, name: fname };
}

/** Un rapport par entreprise : points de l'entreprise aux statuts choisis. */
export async function generateCompanyReports(
  projectId: string, companyIds: string[], statuts: string[], o: ReportOptions = DEFAULT_OPTS, progress?: (msg: string) => void,
) {
  const c = await context(projectId);
  const out = [];
  for (const cid of companyIds) {
    const comp = c.assignments.find((a) => a.company.id === cid)?.company;
    if (!comp) continue;
    progress?.(comp.nom);
    const tickets = await listTickets({ projectId, companyId: cid, statuts });
    if (!tickets.length) continue;
    const rt = await buildTickets(c, tickets, o);
    out.push(await save(c, `Points_${comp.nom}_${todayIso()}`,
      createElement(CompanyReport, { id: c.id, project: c.info, entreprise: comp.nom, contact: [comp.contact, comp.email, comp.telephone].filter(Boolean).join(" · "), tickets: rt }) as never));
  }
  return out;
}

export async function generateVisitReport(visitId: string, o: ReportOptions = DEFAULT_OPTS): Promise<string> {
  const v = await getVisit(visitId);
  if (!v) throw new Error("Visite introuvable");
  const c = await context(v.project_id);
  const touched = await ticketsTouchedInVisit(visitId);
  const all = await listTickets({ projectId: v.project_id });
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  const crees = await buildTickets(c, touched.crees.map((id) => byId[id]).filter(Boolean), o);
  const modifies = await buildTickets(c, touched.modifies.map((id) => byId[id]).filter(Boolean), o);
  const ouverts = await buildTickets(c, all.filter((t) => t.statut !== "clos"), { ...o, planExtracts: false, photos: false });
  const cls: RChecklist[] = (await listChecklists({ projectId: v.project_id, visitId })).map((cl) => ({
    nom: cl.nom, items: cl.items.map((i) => ({ libelle: i.libelle, etat: i.etat, note: i.note })),
  }));
  const r = await save(c, `Compte-rendu_visite_${v.date}`, createElement(VisitReport, { id: c.id, project: c.info, visite: v, crees, modifies, ouverts, checklists: cls }) as never);
  return r.path;
}

export async function generateGlobalReport(projectId: string) {
  const c = await context(projectId);
  const tickets = await listTickets({ projectId });
  const rt = await buildTickets(c, tickets, { planExtracts: false, photos: false, maxPhotos: 0 });
  const count = (list: Ticket[]) => Object.fromEntries(Object.keys(STATUTS).map((s) => [s, list.filter((t) => t.statut === s).length]));
  const parLot = [...c.lots.map((l) => ({ nom: l.nom, counts: count(tickets.filter((t) => t.lot_id === l.id)) })),
    { nom: "Sans lot", counts: count(tickets.filter((t) => !t.lot_id)) }].filter((r) => Object.values(r.counts).some(Boolean));
  const parEntreprise = [...c.assignments.map((a) => {
    const l = tickets.filter((t) => t.company_id === a.company.id);
    return { nom: a.company.nom, counts: count(l), retard: l.filter((t) => isEnRetard(t)).length };
  }), (() => {
    const l = tickets.filter((t) => !t.company_id);
    return { nom: "Non affecté", counts: count(l), retard: l.filter((t) => isEnRetard(t)).length };
  })()].filter((r, i, arr) => arr.findIndex((x) => x.nom === r.nom) === i && Object.values(r.counts).some(Boolean));
  return save(c, `Etat_chantier_${todayIso()}`, createElement(GlobalReport, { id: c.id, project: c.info, tickets: rt, parLot, parEntreprise }) as never);
}
