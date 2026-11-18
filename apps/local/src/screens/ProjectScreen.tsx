import { useMemo, useState } from "react";
import { STATUTS, STATUT_LIST, TICKET_TYPES, PRIORITES, formatDateFr, isEnRetard, type Statut, type Ticket } from "@chantier/core";
import { Field, Icon, LotChip, Modal, StatusBadge, Tabs, useUi } from "@chantier/ui";
import { deleteProject, getProject, listAssignments, listLots, listPlans, listTickets, listVisits, setStatut, updateProject } from "../data/repo";
import { useData } from "../data/useData";
import { useApp, type ProjectTab } from "../nav";
import { Topbar } from "../components/Topbar";
import { PlansTab } from "./PlansTab";
import { TicketPanel } from "./TicketPanel";
import { VisitsTab } from "./VisitsTab";
import { IntervenantsTab } from "./IntervenantsTab";
import { ReportsTab } from "./ReportsTab";

export function ProjectScreen({ projectId, tab }: { projectId: string; tab: ProjectTab }) {
  const { go } = useApp();
  const project = useData(() => getProject(projectId), [projectId]);
  const tickets = useData(() => listTickets({ projectId }), [projectId]);
  const plans = useData(() => listPlans(projectId), [projectId]);
  const visits = useData(() => listVisits(projectId), [projectId]);
  const setTab = (t: ProjectTab) => go({ view: "project", projectId, tab: t });
  if (!project) return null;
  return (
    <>
      <Topbar crumbs={[{ label: "Chantiers", onClick: () => go({ view: "home" }) }, { label: project.nom }]}>
        {project.reference && <span className="mono muted small">{project.reference}</span>}
      </Topbar>
      <Tabs value={tab} onChange={setTab} items={[
        { id: "plans", label: "Plans", icon: "layers", count: plans?.length },
        { id: "points", label: "Points", icon: "list", count: tickets?.filter((t) => t.statut !== "clos").length },
        { id: "visites", label: "Visites", icon: "calendar", count: visits?.length },
        { id: "intervenants", label: "Lots et entreprises", icon: "users" },
        { id: "rapports", label: "Rapports et exports", icon: "pdf" },
        { id: "infos", label: "Informations", icon: "edit" },
      ]} />
      {tab === "plans" && <PlansTab projectId={projectId} />}
      {tab === "points" && <PointsTab projectId={projectId} />}
      {tab === "visites" && <VisitsTab projectId={projectId} />}
      {tab === "intervenants" && <IntervenantsTab projectId={projectId} />}
      {tab === "rapports" && <ReportsTab projectId={projectId} />}
      {tab === "infos" && <InfosTab projectId={projectId} />}
    </>
  );
}

function PointsTab({ projectId }: { projectId: string }) {
  const { go, visitFor } = useApp();
  const ui = useUi();
  const lots = useData(() => listLots(projectId), [projectId]);
  const assignments = useData(() => listAssignments(projectId), [projectId]);
  const plans = useData(() => listPlans(projectId), [projectId]);
  const visits = useData(() => listVisits(projectId), [projectId]);
  const [f, setF] = useState({ statuts: ["ouvert", "transmis", "leve"] as string[], lot: "", company: "", type: "", visit: "", retard: false, texte: "" });
  const tickets = useData(() => listTickets({
    projectId, statuts: f.statuts, lotId: f.lot || null, companyId: f.company || null, type: f.type || null, visitId: f.visit || null, enRetard: f.retard, texte: f.texte,
  }), [projectId, JSON.stringify(f)]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const lotBy = useMemo(() => Object.fromEntries((lots ?? []).map((l) => [l.id, l])), [lots]);
  const compBy = useMemo(() => Object.fromEntries((assignments ?? []).map((a) => [a.company.id, a.company])), [assignments]);
  const planOf = useMemo(() => {
    const m: Record<string, { planId: string; nom: string; indice: string }> = {};
    plans?.forEach((p) => p.versions.forEach((v) => (m[v.id] = { planId: p.plan.id, nom: p.plan.nom, indice: v.indice })));
    return m;
  }, [plans]);

  const showOnPlan = (t: Ticket) => {
    const p = t.plan_version_id && planOf[t.plan_version_id];
    if (p) go({ view: "plan", projectId, planId: p.planId, versionId: t.plan_version_id!, ticketId: t.id });
  };
  const bulk = async (st: Statut) => {
    await setStatut([...sel], st, visitFor(projectId));
    ui.toast(`${sel.size} point(s) : ${STATUTS[st].label}`, "ok");
    setSel(new Set());
  };
  const all = tickets ?? [];

  return (
    <div className="page">
      <div className="row wrap" style={{ marginBottom: 12, gap: 6 }}>
        <input className="input" style={{ width: 220 }} placeholder="Rechercher…" value={f.texte} onChange={(e) => setF({ ...f, texte: e.target.value })} />
        {STATUT_LIST.map((s) => {
          const on = f.statuts.includes(s);
          return <button key={s} className="badge" style={{ border: 0, cursor: "pointer", height: 26, background: on ? STATUTS[s].couleur : "var(--paper-2)", color: on ? "#fff" : "var(--ink-2)" }}
            onClick={() => setF({ ...f, statuts: on ? f.statuts.filter((x) => x !== s) : [...f.statuts, s] })}>{STATUTS[s].label}</button>;
        })}
        <select className="select" style={{ width: 160 }} value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })}>
          <option value="">Tous les lots</option>{lots?.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
        </select>
        <select className="select" style={{ width: 170 }} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })}>
          <option value="">Toutes les entreprises</option>{assignments?.map((a) => <option key={a.id} value={a.company.id}>{a.company.nom}</option>)}
        </select>
        <select className="select" style={{ width: 130 }} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="">Tous types</option>{Object.entries(TICKET_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="select" style={{ width: 170 }} value={f.visit} onChange={(e) => setF({ ...f, visit: e.target.value })}>
          <option value="">Toutes les visites</option>{visits?.map((v) => <option key={v.id} value={v.id}>{formatDateFr(v.date)} {v.titre ?? ""}</option>)}
        </select>
        <label className="check small"><input type="checkbox" checked={f.retard} onChange={(e) => setF({ ...f, retard: e.target.checked })} />En retard</label>
      </div>
      {sel.size > 0 && (
        <div className="row card" style={{ padding: "8px 12px", marginBottom: 10 }}>
          <b>{sel.size} sélectionné(s)</b><span className="grow" />
          {STATUT_LIST.map((s) => <button key={s} className="btn sm" onClick={() => bulk(s)}>{STATUTS[s].label}</button>)}
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Désélectionner</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th style={{ width: 30 }}><input type="checkbox" checked={!!all.length && sel.size === all.length} onChange={(e) => setSel(e.target.checked ? new Set(all.map((t) => t.id)) : new Set())} /></th>
            <th>N°</th><th>Titre</th><th>Lot</th><th>Entreprise</th><th>Plan</th><th>Statut</th><th>Priorité</th><th>Échéance</th>
          </tr></thead>
          <tbody>
            {all.map((t) => (
              <tr key={t.id} className={`click ${sel.has(t.id) ? "sel" : ""}`} onClick={() => setOpen(t.id)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(t.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(t.id); else n.delete(t.id); setSel(n); }} /></td>
                <td className="numero">#{t.numero}</td>
                <td><div style={{ fontWeight: 500 }}>{t.titre}</div>{t.localisation && <div className="small muted">{t.localisation}</div>}</td>
                <td><LotChip nom={lotBy[t.lot_id ?? ""]?.nom} couleur={lotBy[t.lot_id ?? ""]?.couleur} /></td>
                <td>{compBy[t.company_id ?? ""]?.nom ?? <span className="muted">—</span>}</td>
                <td className="small">{t.plan_version_id && planOf[t.plan_version_id] ? `${planOf[t.plan_version_id].nom} (${planOf[t.plan_version_id].indice})` : "—"}</td>
                <td><StatusBadge statut={t.statut} /></td>
                <td className="small">{PRIORITES[t.priorite as keyof typeof PRIORITES]?.label}</td>
                <td className="small">{t.echeance ? <span className={isEnRetard(t) ? "badge danger" : ""}>{formatDateFr(t.echeance)}</span> : "—"}</td>
              </tr>
            ))}
            {tickets && !all.length && <tr><td colSpan={9} className="empty">Aucun point pour ces filtres.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal title={null} size="wide" onClose={() => setOpen(null)}>
          <TicketPanel ticketId={open} projectId={projectId} onClose={() => setOpen(null)} onShowOnPlan={showOnPlan} />
        </Modal>
      )}
    </div>
  );
}

function InfosTab({ projectId }: { projectId: string }) {
  const project = useData(() => getProject(projectId), [projectId]);
  const [d, setD] = useState<Record<string, string>>({});
  const ui = useUi();
  const { go } = useApp();
  if (!project) return null;
  const val = (k: string) => d[k] ?? ((project as unknown as Record<string, string | null>)[k] ?? "");
  const inp = (k: string, type = "text") => (
    <input className="input" type={type} value={val(k)} onChange={(e) => setD({ ...d, [k]: e.target.value })}
      onBlur={() => d[k] !== undefined && updateProject(projectId, { [k]: d[k] || null })} />
  );
  return (
    <div className="page">
      <div className="page-narrow col gap-lg">
        <div className="grid2">
          <Field label="Nom">{inp("nom")}</Field>
          <Field label="Référence / n° d'affaire">{inp("reference")}</Field>
          <Field label="Adresse">{inp("adresse")}</Field>
          <Field label="Maître d'ouvrage">{inp("moa")}</Field>
          <Field label="Début des travaux">{inp("date_debut", "date")}</Field>
          <Field label="Fin prévue">{inp("date_fin", "date")}</Field>
        </div>
        <Field label="Notes">
          <textarea className="textarea" rows={4} value={val("notes")} onChange={(e) => setD({ ...d, notes: e.target.value })} onBlur={() => d.notes !== undefined && updateProject(projectId, { notes: d.notes || null })} />
        </Field>
        <div className="section-title">Cycle de vie</div>
        <div className="row">
          <button className="btn" onClick={() => updateProject(projectId, { archive: !project.archive })}><Icon name="archive" />{project.archive ? "Désarchiver" : "Archiver le chantier"}</button>
          <button className="btn danger" onClick={async () => {
            if (await ui.confirm(<>Supprimer définitivement le chantier <b>{project.nom}</b> de la liste ? Pensez à l'exporter avant.</>, { danger: true, ok: "Supprimer" })) {
              await deleteProject(projectId);
              go({ view: "home" });
            }
          }}><Icon name="trash" />Supprimer</button>
        </div>
      </div>
    </div>
  );
}
