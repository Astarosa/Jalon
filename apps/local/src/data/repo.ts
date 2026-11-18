/** Accès aux données (toutes les écritures passent ici et déclenchent `bump()`). */
import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import {
  schema as s, uuid, nowIso, todayIso, LOT_COLORS,
  type Project, type Lot, type Company, type Plan, type PlanVersion, type PlanCalibration, type Measurement,
  type Ticket, type TicketEvent, type TicketPhoto, type Visit, type ChecklistTemplate, type Checklist,
  type ChecklistItem, type Rect, type Pt, type Dims, type Similarity, transferPoint, clamp01, STATUTS,
  type Statut, type CalibrationLike,
} from "@chantier/core";
import { db, bump } from "./db";

const stamp = () => {
  const t = nowIso();
  return { created_at: t, updated_at: t };
};
const touched = () => ({ updated_at: nowIso() });
const del = () => ({ deleted_at: nowIso(), updated_at: nowIso() });

// ================================================================ chantiers

export const listProjects = () =>
  db.select().from(s.projects).where(isNull(s.projects.deleted_at)).orderBy(asc(s.projects.archive), desc(s.projects.updated_at));

export async function getProject(id: string): Promise<Project | undefined> {
  return (await db.select().from(s.projects).where(eq(s.projects.id, id)))[0];
}

export async function createProject(data: Partial<Project> & { nom: string }, lotNames: string[]): Promise<string> {
  const id = uuid();
  const q = [
    db.insert(s.projects).values({ ...data, id, ...stamp(), archive: false, deleted_at: null }),
    ...lotNames.map((nom, i) =>
      db.insert(s.lots).values({ id: uuid(), project_id: id, nom, code: String(i + 1).padStart(2, "0"), couleur: LOT_COLORS[i % LOT_COLORS.length], ordre: i, ...stamp() }),
    ),
  ];
  await db.batch(q as never);
  bump();
  return id;
}

export async function updateProject(id: string, patch: Partial<Project>) {
  await db.update(s.projects).set({ ...patch, ...touched() }).where(eq(s.projects.id, id));
  bump();
}
export async function deleteProject(id: string) {
  await db.update(s.projects).set(del()).where(eq(s.projects.id, id));
  bump();
}

/** Statistiques par chantier pour l'accueil. */
export async function projectStats(): Promise<Record<string, { total: number; ouverts: number; retard: number }>> {
  const today = todayIso();
  const rows = await db
    .select({
      pid: s.tickets.project_id,
      total: sql<number>`count(*)`,
      ouverts: sql<number>`sum(case when ${s.tickets.statut} != 'clos' then 1 else 0 end)`,
      retard: sql<number>`sum(case when ${s.tickets.statut} in ('ouvert','transmis') and ${s.tickets.echeance} < ${today} then 1 else 0 end)`,
    })
    .from(s.tickets)
    .where(isNull(s.tickets.deleted_at))
    .groupBy(s.tickets.project_id);
  return Object.fromEntries(rows.map((r) => [r.pid, { total: Number(r.total), ouverts: Number(r.ouverts ?? 0), retard: Number(r.retard ?? 0) }]));
}

// ===================================================================== lots

export const listLots = (projectId: string) =>
  db.select().from(s.lots).where(and(eq(s.lots.project_id, projectId), isNull(s.lots.deleted_at))).orderBy(asc(s.lots.ordre), asc(s.lots.nom));

export async function saveLot(l: Partial<Lot> & { project_id: string; nom: string }) {
  if (l.id) await db.update(s.lots).set({ ...l, ...touched() }).where(eq(s.lots.id, l.id));
  else {
    const n = (await listLots(l.project_id)).length;
    await db.insert(s.lots).values({ couleur: LOT_COLORS[n % LOT_COLORS.length], ordre: n, ...l, id: uuid(), ...stamp() });
  }
  bump();
}
export async function deleteLot(id: string) {
  await db.update(s.lots).set(del()).where(eq(s.lots.id, id));
  bump();
}

// =============================================================== entreprises

export const listCompanies = () =>
  db.select().from(s.companies).where(isNull(s.companies.deleted_at)).orderBy(asc(s.companies.nom));

export async function saveCompany(c: Partial<Company> & { nom: string }): Promise<string> {
  let id = c.id;
  if (id) await db.update(s.companies).set({ ...c, ...touched() }).where(eq(s.companies.id, id));
  else {
    id = uuid();
    await db.insert(s.companies).values({ ...c, id, ...stamp() });
  }
  bump();
  return id;
}
export async function deleteCompany(id: string) {
  await db.update(s.companies).set(del()).where(eq(s.companies.id, id));
  bump();
}

export interface Assignment {
  id: string;
  company: Company;
  lot_id: string | null;
}
export async function listAssignments(projectId: string): Promise<Assignment[]> {
  const rows = await db
    .select({ pc: s.projectCompanies, c: s.companies })
    .from(s.projectCompanies)
    .innerJoin(s.companies, eq(s.companies.id, s.projectCompanies.company_id))
    .where(and(eq(s.projectCompanies.project_id, projectId), isNull(s.projectCompanies.deleted_at)))
    .orderBy(asc(s.companies.nom));
  return rows.map((r) => ({ id: r.pc.id, company: r.c, lot_id: r.pc.lot_id }));
}
export async function assignCompany(projectId: string, companyId: string, lotId: string | null) {
  await db.insert(s.projectCompanies).values({ id: uuid(), project_id: projectId, company_id: companyId, lot_id: lotId, ...stamp() });
  bump();
}
export async function updateAssignment(id: string, lotId: string | null) {
  await db.update(s.projectCompanies).set({ lot_id: lotId, ...touched() }).where(eq(s.projectCompanies.id, id));
  bump();
}
export async function removeAssignment(id: string) {
  await db.update(s.projectCompanies).set(del()).where(eq(s.projectCompanies.id, id));
  bump();
}

// ==================================================================== plans

export interface PlanWithVersions {
  plan: Plan;
  versions: PlanVersion[];
  current: PlanVersion | undefined;
}

export async function listPlans(projectId: string): Promise<PlanWithVersions[]> {
  const plans = await db.select().from(s.plans).where(and(eq(s.plans.project_id, projectId), isNull(s.plans.deleted_at))).orderBy(asc(s.plans.ordre), asc(s.plans.nom));
  if (!plans.length) return [];
  const versions = await db
    .select()
    .from(s.planVersions)
    .where(and(inArray(s.planVersions.plan_id, plans.map((p) => p.id)), isNull(s.planVersions.deleted_at)))
    .orderBy(asc(s.planVersions.created_at));
  return plans.map((plan) => {
    const vs = versions.filter((v) => v.plan_id === plan.id);
    return { plan, versions: vs, current: vs.find((v) => v.courant) ?? vs[vs.length - 1] };
  });
}

export async function getPlanVersion(id: string): Promise<PlanVersion | undefined> {
  return (await db.select().from(s.planVersions).where(eq(s.planVersions.id, id)))[0];
}
export async function getPlan(id: string): Promise<Plan | undefined> {
  return (await db.select().from(s.plans).where(eq(s.plans.id, id)))[0];
}

export interface NewVersion {
  indice: string;
  file_sha256: string;
  nom_fichier: string;
  page_index: number;
  largeur_pt: number;
  hauteur_pt: number;
}

export async function createPlan(projectId: string, nom: string, niveau: string | null, v: NewVersion): Promise<{ planId: string; versionId: string }> {
  const planId = uuid(), versionId = uuid();
  const ordre = Number((await db.select({ m: max(s.plans.ordre) }).from(s.plans).where(eq(s.plans.project_id, projectId)))[0]?.m ?? -1) + 1;
  await db.batch([
    db.insert(s.plans).values({ id: planId, project_id: projectId, nom, niveau, ordre, ...stamp() }),
    db.insert(s.planVersions).values({ ...v, id: versionId, plan_id: planId, courant: true, ...stamp() }),
  ]);
  bump();
  return { planId, versionId };
}

export async function addPlanVersion(planId: string, v: NewVersion): Promise<string> {
  const versionId = uuid();
  await db.batch([
    db.update(s.planVersions).set({ courant: false, ...touched() }).where(eq(s.planVersions.plan_id, planId)),
    db.insert(s.planVersions).values({ ...v, id: versionId, plan_id: planId, courant: true, ...stamp() }),
  ]);
  bump();
  return versionId;
}

export async function setCurrentVersion(planId: string, versionId: string) {
  await db.batch([
    db.update(s.planVersions).set({ courant: false, ...touched() }).where(eq(s.planVersions.plan_id, planId)),
    db.update(s.planVersions).set({ courant: true, ...touched() }).where(eq(s.planVersions.id, versionId)),
  ]);
  bump();
}

export async function updatePlan(id: string, patch: Partial<Plan>) {
  await db.update(s.plans).set({ ...patch, ...touched() }).where(eq(s.plans.id, id));
  bump();
}
export async function updatePlanVersion(id: string, patch: Partial<PlanVersion>) {
  await db.update(s.planVersions).set({ ...patch, ...touched() }).where(eq(s.planVersions.id, id));
  bump();
}
export async function deletePlan(id: string) {
  await db.update(s.plans).set(del()).where(eq(s.plans.id, id));
  bump();
}

// ============================================================ étalonnages

export type Calibration = PlanCalibration & CalibrationLike & { zone: Rect | null };

const parseCal = (c: PlanCalibration): Calibration => ({ ...c, zone: c.zone ? (JSON.parse(c.zone) as Rect) : null }) as Calibration;

export async function listCalibrations(pvid: string): Promise<Calibration[]> {
  const rows = await db.select().from(s.planCalibrations).where(and(eq(s.planCalibrations.plan_version_id, pvid), isNull(s.planCalibrations.deleted_at))).orderBy(asc(s.planCalibrations.created_at));
  return rows.map(parseCal);
}

export type CalibrationInput = Omit<Partial<PlanCalibration>, "zone"> & {
  plan_version_id: string;
  methode: string;
  metres_par_point: number;
  zone: Rect | null;
};

export async function saveCalibration(c: CalibrationInput): Promise<string> {
  const row = { ...c, zone: c.zone ? JSON.stringify(c.zone) : null };
  let id = c.id;
  if (id) {
    await db.update(s.planCalibrations).set({ ...row, ...touched() }).where(eq(s.planCalibrations.id, id));
  } else {
    id = uuid();
    // une seule calibration « page entière » par version
    const q = [];
    if (!c.zone)
      q.push(db.update(s.planCalibrations).set(del()).where(and(eq(s.planCalibrations.plan_version_id, c.plan_version_id), isNull(s.planCalibrations.zone), isNull(s.planCalibrations.deleted_at))));
    q.push(db.insert(s.planCalibrations).values({ ...row, id, ...stamp() }));
    await db.batch(q as never);
  }
  bump();
  return id;
}
export async function deleteCalibration(id: string) {
  await db.update(s.planCalibrations).set(del()).where(eq(s.planCalibrations.id, id));
  bump();
}
/** Copie les étalonnages d'une version vers une autre (nouvel indice, mêmes dimensions). */
export async function copyCalibrations(fromPvid: string, toPvid: string) {
  const cals = await listCalibrations(fromPvid);
  if (!cals.length) return 0;
  await db.batch(
    cals.map((c) =>
      db.insert(s.planCalibrations).values({
        ...c, zone: c.zone ? JSON.stringify(c.zone) : null, id: uuid(), plan_version_id: toPvid,
        controle_attendu_m: null, controle_mesure_m: null, ...stamp(),
      }),
    ) as never,
  );
  bump();
  return cals.length;
}

// ================================================================== mesures

export type MeasurementP = Measurement & { pts: Pt[] };
export async function listMeasurements(pvid: string): Promise<MeasurementP[]> {
  const rows = await db.select().from(s.measurements).where(and(eq(s.measurements.plan_version_id, pvid), isNull(s.measurements.deleted_at))).orderBy(asc(s.measurements.created_at));
  return rows.map((m) => ({ ...m, pts: JSON.parse(m.points) as Pt[] }));
}
export async function listMeasurementsForTicket(ticketId: string): Promise<MeasurementP[]> {
  const rows = await db.select().from(s.measurements).where(and(eq(s.measurements.ticket_id, ticketId), isNull(s.measurements.deleted_at)));
  return rows.map((m) => ({ ...m, pts: JSON.parse(m.points) as Pt[] }));
}
export async function saveMeasurement(m: Partial<Measurement> & { plan_version_id: string; type: string; pts: Pt[] }): Promise<string> {
  const { pts, ...rest } = m;
  const row = { ...rest, points: JSON.stringify(pts) };
  let id = m.id;
  if (id) await db.update(s.measurements).set({ ...row, ...touched() }).where(eq(s.measurements.id, id));
  else {
    id = uuid();
    await db.insert(s.measurements).values({ ...row, id, ...stamp() });
  }
  bump();
  return id;
}
export async function deleteMeasurement(id: string) {
  await db.update(s.measurements).set(del()).where(eq(s.measurements.id, id));
  bump();
}

// ================================================================== points

export interface TicketFilter {
  projectId: string;
  planVersionId?: string;
  statuts?: string[];
  lotId?: string | null;
  companyId?: string | null;
  visitId?: string | null;
  type?: string | null;
  enRetard?: boolean;
  texte?: string;
}

export async function listTickets(f: TicketFilter): Promise<Ticket[]> {
  const conds = [eq(s.tickets.project_id, f.projectId), isNull(s.tickets.deleted_at)];
  if (f.planVersionId) conds.push(eq(s.tickets.plan_version_id, f.planVersionId));
  if (f.statuts?.length) conds.push(inArray(s.tickets.statut, f.statuts));
  if (f.lotId) conds.push(eq(s.tickets.lot_id, f.lotId));
  if (f.companyId) conds.push(eq(s.tickets.company_id, f.companyId));
  if (f.visitId) conds.push(eq(s.tickets.visit_id, f.visitId));
  if (f.type) conds.push(eq(s.tickets.type, f.type));
  if (f.enRetard) conds.push(sql`${s.tickets.statut} in ('ouvert','transmis') and ${s.tickets.echeance} < ${todayIso()}`);
  if (f.texte?.trim()) {
    const like = `%${f.texte.trim().toLowerCase()}%`;
    conds.push(sql`(lower(${s.tickets.titre}) like ${like} or lower(coalesce(${s.tickets.description},'')) like ${like} or lower(coalesce(${s.tickets.localisation},'')) like ${like} or cast(${s.tickets.numero} as text) = ${f.texte.trim().replace("#", "")})`);
  }
  return db.select().from(s.tickets).where(and(...conds)).orderBy(asc(s.tickets.numero));
}

export async function getTicket(id: string): Promise<Ticket | undefined> {
  return (await db.select().from(s.tickets).where(eq(s.tickets.id, id)))[0];
}

export type TicketInput = Omit<Partial<Ticket>, "id" | "numero"> & { project_id: string; titre: string };

export async function createTicket(t: TicketInput, visitId: string | null): Promise<string> {
  const id = uuid();
  const num = Number((await db.select({ m: max(s.tickets.numero) }).from(s.tickets).where(eq(s.tickets.project_id, t.project_id)))[0]?.m ?? 0) + 1;
  const now = nowIso();
  await db.batch([
    db.insert(s.tickets).values({
      type: "reserve", statut: "ouvert", priorite: "normale", ...t, visit_id: t.visit_id ?? visitId, id, numero: num, ...stamp(),
    }),
    db.insert(s.ticketEvents).values({ id: uuid(), ticket_id: id, visit_id: visitId, type: "creation", date: now, ...stamp() }),
  ]);
  bump();
  return id;
}

const TRACKED: (keyof Ticket)[] = ["titre", "description", "localisation", "type", "lot_id", "company_id", "priorite", "echeance", "statut"];

export async function updateTicket(id: string, patch: Partial<Ticket>, visitId: string | null) {
  const cur = await getTicket(id);
  if (!cur) return;
  const now = nowIso();
  const events = TRACKED.filter((k) => k in patch && (patch[k] ?? null) !== (cur[k] ?? null)).map((k) =>
    db.insert(s.ticketEvents).values({
      id: uuid(), ticket_id: id, visit_id: visitId, type: k === "statut" ? "statut" : "modification", champ: k,
      ancien: cur[k] == null ? null : String(cur[k]), nouveau: patch[k] == null ? null : String(patch[k]), date: now, ...stamp(),
    }),
  );
  await db.batch([db.update(s.tickets).set({ ...patch, ...touched() }).where(eq(s.tickets.id, id)), ...events] as never);
  bump();
}

export async function setStatut(ids: string[], statut: Statut, visitId: string | null) {
  for (const id of ids) await updateTicket(id, { statut }, visitId);
}

export async function deleteTicket(id: string) {
  await db.update(s.tickets).set(del()).where(eq(s.tickets.id, id));
  bump();
}

export async function addComment(ticketId: string, texte: string, visitId: string | null) {
  await db.insert(s.ticketEvents).values({ id: uuid(), ticket_id: ticketId, visit_id: visitId, type: "commentaire", texte, date: nowIso(), ...stamp() });
  await db.update(s.tickets).set(touched()).where(eq(s.tickets.id, ticketId));
  bump();
}

export const listEvents = (ticketId: string): Promise<TicketEvent[]> =>
  db.select().from(s.ticketEvents).where(and(eq(s.ticketEvents.ticket_id, ticketId), isNull(s.ticketEvents.deleted_at))).orderBy(desc(s.ticketEvents.date));

export async function listEventsForProject(projectId: string): Promise<(TicketEvent & { numero: number; titre: string })[]> {
  const rows = await db
    .select({ e: s.ticketEvents, numero: s.tickets.numero, titre: s.tickets.titre })
    .from(s.ticketEvents)
    .innerJoin(s.tickets, eq(s.tickets.id, s.ticketEvents.ticket_id))
    .where(and(eq(s.tickets.project_id, projectId), isNull(s.ticketEvents.deleted_at), isNull(s.tickets.deleted_at)))
    .orderBy(desc(s.ticketEvents.date));
  return rows.map((r) => ({ ...r.e, numero: r.numero, titre: r.titre }));
}

/**
 * Report des points (et mesures) d'une version de plan vers une autre (nouvel indice).
 * `onlyOpen` : ne reporte que les points non clos.
 */
export async function migrateToVersion(
  from: PlanVersion, to: PlanVersion, t: Similarity | undefined, opts: { onlyOpen: boolean; measures: boolean },
): Promise<{ tickets: number; measures: number }> {
  const src: Dims = { w: from.largeur_pt, h: from.hauteur_pt }, dst: Dims = { w: to.largeur_pt, h: to.hauteur_pt };
  const tickets = (await db.select().from(s.tickets).where(and(eq(s.tickets.plan_version_id, from.id), isNull(s.tickets.deleted_at))))
    .filter((tk) => !opts.onlyOpen || tk.statut !== "clos");
  const now = nowIso();
  const q: unknown[] = [];
  for (const tk of tickets) {
    const p = transferPoint({ x: tk.x ?? 0.5, y: tk.y ?? 0.5 }, src, dst, t);
    q.push(db.update(s.tickets).set({ plan_version_id: to.id, x: clamp01(p.x), y: clamp01(p.y), ...touched() }).where(eq(s.tickets.id, tk.id)));
    q.push(db.insert(s.ticketEvents).values({ id: uuid(), ticket_id: tk.id, type: "migration_indice", ancien: from.indice, nouveau: to.indice, date: now, ...stamp() }));
  }
  let nm = 0;
  if (opts.measures) {
    for (const m of await listMeasurements(from.id)) {
      if (m.ticket_id && !tickets.some((tk) => tk.id === m.ticket_id)) continue;
      const pts = m.pts.map((p) => {
        const r = transferPoint(p, src, dst, t);
        return { x: clamp01(r.x), y: clamp01(r.y) };
      });
      q.push(db.insert(s.measurements).values({ ...m, id: uuid(), plan_version_id: to.id, points: JSON.stringify(pts), ...stamp() }));
      nm++;
    }
  }
  // Étalonnages repris de l'indice précédent : on leur applique le même recalage
  if (t) {
    const k = Math.hypot(t.a, t.b);
    const srcCals = await listCalibrations(from.id);
    for (const c of await listCalibrations(to.id)) {
      const twin = srcCals.find((sc) => JSON.stringify(sc.zone) === JSON.stringify(c.zone) && Math.abs(sc.metres_par_point - c.metres_par_point) < 1e-12);
      if (!twin) continue;
      const tp = (x: number | null, y: number | null) => (x == null || y == null ? null : transferPoint({ x, y }, src, dst, t));
      let zone: Rect | null = null;
      if (c.zone) {
        const cs = [[c.zone.x0, c.zone.y0], [c.zone.x1, c.zone.y0], [c.zone.x1, c.zone.y1], [c.zone.x0, c.zone.y1]].map(([x, y]) => transferPoint({ x, y }, src, dst, t));
        zone = { x0: clamp01(Math.min(...cs.map((p) => p.x))), y0: clamp01(Math.min(...cs.map((p) => p.y))), x1: clamp01(Math.max(...cs.map((p) => p.x))), y1: clamp01(Math.max(...cs.map((p) => p.y))) };
      }
      const p1 = tp(c.p1x, c.p1y), p2 = tp(c.p2x, c.p2y);
      q.push(db.update(s.planCalibrations).set({
        zone: zone ? JSON.stringify(zone) : null, metres_par_point: c.metres_par_point / k,
        p1x: p1?.x ?? null, p1y: p1?.y ?? null, p2x: p2?.x ?? null, p2y: p2?.y ?? null, ...touched(),
      }).where(eq(s.planCalibrations.id, c.id)));
    }
  }
  if (q.length) await db.batch(q as never);
  bump();
  return { tickets: tickets.length, measures: nm };
}

// =================================================================== photos

export const listPhotos = (ticketId: string): Promise<TicketPhoto[]> =>
  db.select().from(s.ticketPhotos).where(and(eq(s.ticketPhotos.ticket_id, ticketId), isNull(s.ticketPhotos.deleted_at))).orderBy(asc(s.ticketPhotos.ordre), asc(s.ticketPhotos.created_at));

export async function listPhotosForTickets(ids: string[]): Promise<TicketPhoto[]> {
  if (!ids.length) return [];
  const out: TicketPhoto[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    out.push(...(await db.select().from(s.ticketPhotos).where(and(inArray(s.ticketPhotos.ticket_id, ids.slice(i, i + 400)), isNull(s.ticketPhotos.deleted_at))).orderBy(asc(s.ticketPhotos.ordre), asc(s.ticketPhotos.created_at))));
  }
  return out;
}

export async function addPhoto(p: Omit<Partial<TicketPhoto>, "id"> & { ticket_id: string; file_sha256: string }, visitId: string | null) {
  const n = (await listPhotos(p.ticket_id)).length;
  await db.batch([
    db.insert(s.ticketPhotos).values({ ordre: n, ...p, id: uuid(), ...stamp() }),
    db.insert(s.ticketEvents).values({ id: uuid(), ticket_id: p.ticket_id, visit_id: visitId, type: "photo", date: nowIso(), ...stamp() }),
  ]);
  bump();
}
export async function updatePhoto(id: string, patch: Partial<TicketPhoto>) {
  await db.update(s.ticketPhotos).set({ ...patch, ...touched() }).where(eq(s.ticketPhotos.id, id));
  bump();
}
export async function deletePhoto(id: string) {
  await db.update(s.ticketPhotos).set(del()).where(eq(s.ticketPhotos.id, id));
  bump();
}

export async function registerFile(sha: string, nom: string | null, mime: string | null, taille: number) {
  await db.insert(s.files).values({ sha256: sha, nom_origine: nom, mime, taille, created_at: nowIso() }).onConflictDoNothing();
}

// ================================================================== visites

export const listVisits = (projectId: string): Promise<Visit[]> =>
  db.select().from(s.visits).where(and(eq(s.visits.project_id, projectId), isNull(s.visits.deleted_at))).orderBy(desc(s.visits.date), desc(s.visits.created_at));

export async function getVisit(id: string): Promise<Visit | undefined> {
  return (await db.select().from(s.visits).where(eq(s.visits.id, id)))[0];
}
export async function saveVisit(v: Partial<Visit> & { project_id: string; date: string }): Promise<string> {
  let id = v.id;
  if (id) await db.update(s.visits).set({ ...v, ...touched() }).where(eq(s.visits.id, id));
  else {
    id = uuid();
    await db.insert(s.visits).values({ ...v, id, cloturee: false, ...stamp() });
  }
  bump();
  return id;
}
export async function deleteVisit(id: string) {
  await db.update(s.visits).set(del()).where(eq(s.visits.id, id));
  bump();
}

/** Points créés ou modifiés pendant une visite. */
export async function ticketsTouchedInVisit(visitId: string): Promise<{ crees: string[]; modifies: string[] }> {
  const ev = await db.select().from(s.ticketEvents).where(and(eq(s.ticketEvents.visit_id, visitId), isNull(s.ticketEvents.deleted_at)));
  const crees = [...new Set(ev.filter((e) => e.type === "creation").map((e) => e.ticket_id))];
  const modifies = [...new Set(ev.filter((e) => e.type !== "creation").map((e) => e.ticket_id))].filter((id) => !crees.includes(id));
  return { crees, modifies };
}

// =============================================================== checklists

export async function listTemplates(): Promise<(ChecklistTemplate & { list: string[] })[]> {
  const rows = await db.select().from(s.checklistTemplates).where(isNull(s.checklistTemplates.deleted_at)).orderBy(asc(s.checklistTemplates.nom));
  return rows.map((r) => ({ ...r, list: JSON.parse(r.items) as string[] }));
}
export async function saveTemplate(t: { id?: string; nom: string; description?: string | null; list: string[] }) {
  const row = { nom: t.nom, description: t.description ?? null, items: JSON.stringify(t.list.filter((x) => x.trim())) };
  if (t.id) await db.update(s.checklistTemplates).set({ ...row, ...touched() }).where(eq(s.checklistTemplates.id, t.id));
  else await db.insert(s.checklistTemplates).values({ ...row, id: uuid(), ...stamp() });
  bump();
}
export async function deleteTemplate(id: string) {
  await db.update(s.checklistTemplates).set(del()).where(eq(s.checklistTemplates.id, id));
  bump();
}

export type ChecklistFull = Checklist & { items: ChecklistItem[] };

export async function listChecklists(where: { projectId: string; ticketId?: string; visitId?: string }): Promise<ChecklistFull[]> {
  const conds = [eq(s.checklists.project_id, where.projectId), isNull(s.checklists.deleted_at)];
  if (where.ticketId) conds.push(eq(s.checklists.ticket_id, where.ticketId));
  if (where.visitId) conds.push(eq(s.checklists.visit_id, where.visitId));
  const cls = await db.select().from(s.checklists).where(and(...conds)).orderBy(asc(s.checklists.created_at));
  if (!cls.length) return [];
  const items = await db.select().from(s.checklistItems).where(and(inArray(s.checklistItems.checklist_id, cls.map((c) => c.id)), isNull(s.checklistItems.deleted_at))).orderBy(asc(s.checklistItems.ordre));
  return cls.map((c) => ({ ...c, items: items.filter((i) => i.checklist_id === c.id) }));
}

export async function createChecklist(projectId: string, nom: string, labels: string[], link: { ticketId?: string | null; visitId?: string | null; templateId?: string | null }) {
  const id = uuid();
  await db.batch([
    db.insert(s.checklists).values({ id, project_id: projectId, nom, ticket_id: link.ticketId ?? null, visit_id: link.visitId ?? null, template_id: link.templateId ?? null, ...stamp() }),
    ...labels.map((libelle, i) => db.insert(s.checklistItems).values({ id: uuid(), checklist_id: id, libelle, etat: "a_faire", ordre: i, ...stamp() })),
  ] as never);
  bump();
  return id;
}
export async function updateChecklistItem(id: string, patch: Partial<ChecklistItem>) {
  await db.update(s.checklistItems).set({ ...patch, ...touched() }).where(eq(s.checklistItems.id, id));
  bump();
}
export async function addChecklistItem(checklistId: string, libelle: string, ordre: number) {
  await db.insert(s.checklistItems).values({ id: uuid(), checklist_id: checklistId, libelle, etat: "a_faire", ordre, ...stamp() });
  bump();
}
export async function deleteChecklistItem(id: string) {
  await db.update(s.checklistItems).set(del()).where(eq(s.checklistItems.id, id));
  bump();
}
export async function deleteChecklist(id: string) {
  await db.update(s.checklists).set(del()).where(eq(s.checklists.id, id));
  bump();
}

// ================================================================ réglages

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = (await db.select().from(s.settings).where(eq(s.settings.key, key)))[0];
  if (!r?.value) return fallback;
  try {
    return { ...fallback, ...JSON.parse(r.value) };
  } catch {
    return fallback;
  }
}
export async function setSetting(key: string, value: unknown) {
  await db.insert(s.settings).values({ key, value: JSON.stringify(value) }).onConflictDoUpdate({ target: s.settings.key, set: { value: JSON.stringify(value) } });
  bump();
}

export interface Identity {
  societe: string;
  conducteur: string;
  telephone: string;
  email: string;
  logo_sha256: string | null;
}
export const DEFAULT_IDENTITY: Identity = { societe: "", conducteur: "", telephone: "", email: "", logo_sha256: null };
export const getIdentity = () => getSetting<Identity>("identite", DEFAULT_IDENTITY);

export const statutLabel = (st: string) => STATUTS[st as Statut]?.label ?? st;

/** Modèles de checklists proposés au premier lancement. */
export async function seedDefaults() {
  const done = await getSetting<{ ok: boolean }>("seed", { ok: false });
  if (done.ok) return;
  const defaults: [string, string[]][] = [
    ["Réception des travaux", ["Ouvrages conformes au marché", "Essais et mesures réalisés", "DOE remis", "Nettoyage effectué", "Réserves listées et notifiées"]],
    ["Contrôle électricité", ["Tableau repéré et étiqueté", "Différentiels testés", "Prises et éclairages fonctionnels", "Liaisons équipotentielles", "Consuel / attestation"]],
    ["Contrôle plomberie", ["Essai d'étanchéité réalisé", "Pas de fuite visible", "Évacuations fonctionnelles", "Robinetterie fixée", "Calorifugeage"]],
    ["Pré-réception menuiseries", ["Fonctionnement des ouvrants", "Réglages / quincaillerie", "Joints et calfeutrements", "Vitrages sans défaut", "Protection retirée"]],
  ];
  for (const [nom, list] of defaults) await saveTemplate({ nom, list });
  await setSetting("seed", { ok: true });
}
