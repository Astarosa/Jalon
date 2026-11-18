import * as XLSX from "xlsx";
import {
  PRIORITES, STATUTS, TICKET_TYPES, formatDateFr, isEnRetard, measure, safeFileName, todayIso, ratioFromMpp,
  type MeasureType, type Statut,
} from "@chantier/core";
import {
  getProject, listAssignments, listCalibrations, listLots, listMeasurements, listPhotosForTickets, listPlans, listTickets, listVisits,
} from "../data/repo";

/** Export Excel : feuilles Points, Mesures, Visites. */
export async function exportXlsx(projectId: string): Promise<{ bytes: Uint8Array; name: string }> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Chantier introuvable");
  const [tickets, lots, assignments, plans, visits] = await Promise.all([
    listTickets({ projectId }), listLots(projectId), listAssignments(projectId), listPlans(projectId), listVisits(projectId),
  ]);
  const photos = await listPhotosForTickets(tickets.map((t) => t.id));
  const lotBy = Object.fromEntries(lots.map((l) => [l.id, l.nom]));
  const compBy = Object.fromEntries(assignments.map((a) => [a.company.id, a.company.nom]));
  const visitBy = Object.fromEntries(visits.map((v) => [v.id, `${formatDateFr(v.date)} ${v.titre ?? ""}`.trim()]));
  const pvBy: Record<string, { plan: string; indice: string }> = {};
  plans.forEach((p) => p.versions.forEach((v) => (pvBy[v.id] = { plan: p.plan.nom, indice: v.indice })));

  const rows = tickets.map((t) => ({
    "N°": t.numero,
    Type: TICKET_TYPES[t.type as keyof typeof TICKET_TYPES]?.label ?? t.type,
    Titre: t.titre,
    Description: t.description ?? "",
    Localisation: t.localisation ?? "",
    Lot: lotBy[t.lot_id ?? ""] ?? "",
    Entreprise: compBy[t.company_id ?? ""] ?? "",
    Statut: STATUTS[t.statut as Statut]?.label ?? t.statut,
    Priorité: PRIORITES[t.priorite as keyof typeof PRIORITES]?.label ?? t.priorite,
    Échéance: t.echeance ? new Date(t.echeance + "T12:00:00") : "",
    "En retard": isEnRetard(t) ? "oui" : "",
    Plan: pvBy[t.plan_version_id ?? ""]?.plan ?? "",
    Indice: pvBy[t.plan_version_id ?? ""]?.indice ?? "",
    Visite: visitBy[t.visit_id ?? ""] ?? "",
    Photos: photos.filter((p) => p.ticket_id === t.id).length,
    "Créé le": new Date(t.created_at),
    "Modifié le": new Date(t.updated_at),
  }));

  const mrows: Record<string, unknown>[] = [];
  for (const p of plans)
    for (const v of p.versions) {
      const ms = await listMeasurements(v.id);
      if (!ms.length) continue;
      const cals = await listCalibrations(v.id);
      for (const m of ms) {
        const r = measure(m.type as MeasureType, m.pts, { w: v.largeur_pt, h: v.hauteur_pt }, cals);
        mrows.push({
          Plan: p.plan.nom, Indice: v.indice, Libellé: m.libelle ?? "", Type: m.type,
          Valeur: r.valeur != null ? Math.round(r.valeur * 1000) / 1000 : "", Unité: m.type === "surface" ? "m²" : "m",
          "Périmètre (m)": r.perimetre != null ? Math.round(r.perimetre * 1000) / 1000 : "",
          Échelle: r.calibration ? `1/${Math.round(ratioFromMpp(r.calibration.metres_par_point))}` : "non étalonné",
          "Zones mélangées": r.zonesMelangees ? "oui" : "",
          Point: m.ticket_id ? `#${tickets.find((t) => t.id === m.ticket_id)?.numero ?? ""}` : "",
        });
      }
    }

  const vrows = visits.map((v) => ({ Date: new Date(v.date + "T12:00:00"), Objet: v.titre ?? "", Météo: v.meteo ?? "", Participants: v.participants ?? "", Observations: v.notes ?? "", Close: v.cloturee ? "oui" : "" }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true, dateNF: "dd/mm/yyyy" });
  ws["!cols"] = [6, 12, 40, 50, 18, 20, 24, 22, 10, 12, 9, 24, 7, 22, 7, 12, 12].map((w) => ({ wch: w }));
  ws["!autofilter"] = { ref: ws["!ref"]! };
  XLSX.utils.book_append_sheet(wb, ws, "Points");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mrows), "Mesures");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vrows, { cellDates: true, dateNF: "dd/mm/yyyy" }), "Visites");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", cellDates: true }) as ArrayBuffer;
  return { bytes: new Uint8Array(out), name: `${safeFileName(project.nom)}_points_${todayIso()}.xlsx` };
}
