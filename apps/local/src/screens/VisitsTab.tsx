import { useState } from "react";
import { formatDateFr, todayIso, type Visit } from "@chantier/core";
import { Empty, Field, Icon, Modal, StatusBadge, useUi } from "@chantier/ui";
import { deleteVisit, getProject, listTickets, listVisits, saveVisit, ticketsTouchedInVisit } from "../data/repo";
import { useData } from "../data/useData";
import { useApp } from "../nav";
import { Checklists } from "./TicketPanel";
import { generateVisitReport } from "../reports/generate";

export function VisitsTab({ projectId }: { projectId: string }) {
  const visits = useData(() => listVisits(projectId), [projectId]);
  const [selId, setSelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const sel = visits?.find((v) => v.id === (selId ?? visits[0]?.id));
  return (
    <div className="page" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 18, alignItems: "start" }}>
      <div className="col">
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />Nouvelle visite</button>
        <div className="card" style={{ overflow: "hidden" }}>
          {visits?.map((v) => (
            <div key={v.id} className={`pin-row ${v.id === sel?.id ? "sel" : ""}`} onClick={() => setSelId(v.id)}>
              <Icon name="calendar" />
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{formatDateFr(v.date)}</div>
                <div className="small muted ellipsis">{v.titre || "Visite de chantier"}</div>
              </div>
              {v.cloturee ? <span className="badge ok">Close</span> : <span className="badge">Ouverte</span>}
            </div>
          ))}
          {visits && !visits.length && <div className="empty small">Aucune visite.</div>}
        </div>
      </div>
      <div>{sel ? <VisitDetail key={sel.id} v={sel} /> : <Empty icon="calendar" title="Aucune visite sélectionnée">Créez une visite pour regrouper les constats d'une tournée de chantier.</Empty>}</div>
      {creating && <NewVisit projectId={projectId} onClose={() => setCreating(false)} onCreated={setSelId} />}
    </div>
  );
}

function NewVisit({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [v, setV] = useState({ date: todayIso(), titre: "Visite de chantier", participants: "", meteo: "" });
  const { setVisit } = useApp();
  const create = async (start: boolean) => {
    const id = await saveVisit({ project_id: projectId, ...v });
    if (start) setVisit({ projectId, visitId: id, label: `${formatDateFr(v.date)} — ${v.titre}` });
    onCreated(id);
    onClose();
  };
  return (
    <Modal title="Nouvelle visite" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn" onClick={() => create(false)}>Créer</button><button className="btn primary" onClick={() => create(true)}><Icon name="play" />Créer et démarrer</button></>}>
      <div className="grid2">
        <Field label="Date"><input type="date" className="input" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Météo"><input className="input" value={v.meteo} onChange={(e) => setV({ ...v, meteo: e.target.value })} /></Field>
      </div>
      <Field label="Objet"><input className="input" value={v.titre} onChange={(e) => setV({ ...v, titre: e.target.value })} /></Field>
      <Field label="Participants" hint="un par ligne"><textarea className="textarea" rows={3} value={v.participants} onChange={(e) => setV({ ...v, participants: e.target.value })} /></Field>
      <div className="small muted">Une visite démarrée rattache automatiquement les points créés ou modifiés pendant la tournée.</div>
    </Modal>
  );
}

function VisitDetail({ v }: { v: Visit }) {
  const { visit, setVisit, go } = useApp();
  const ui = useUi();
  const [d, setD] = useState<Partial<Visit>>({});
  const touched = useData(() => ticketsTouchedInVisit(v.id), [v.id]);
  const tickets = useData(() => listTickets({ projectId: v.project_id }), [v.project_id]);
  const project = useData(() => getProject(v.project_id), [v.project_id]);
  const [busy, setBusy] = useState(false);
  const active = visit?.visitId === v.id;
  const val = (k: keyof Visit) => ((d[k] ?? v[k]) as string | null) ?? "";
  const blur = (k: keyof Visit) => () => d[k] !== undefined && saveVisit({ ...v, [k]: d[k] });
  const byId = Object.fromEntries((tickets ?? []).map((t) => [t.id, t]));

  const report = async () => {
    setBusy(true);
    try {
      const path = await generateVisitReport(v.id);
      ui.toast(`Rapport enregistré : ${path}`, "ok");
    } catch (e) {
      ui.toast(`Rapport impossible : ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const list = (ids: string[] | undefined, title: string) => (
    <>
      <div className="section-title">{title} ({ids?.length ?? 0})</div>
      <div className="col" style={{ gap: 4 }}>
        {ids?.map((id) => byId[id]).filter(Boolean).map((t) => (
          <div key={t.id} className="row card" style={{ padding: "6px 10px", cursor: "pointer" }}
            onClick={() => go({ view: "project", projectId: v.project_id, tab: "points" })}>
            <span className="numero">#{t.numero}</span><span className="grow">{t.titre}</span><StatusBadge statut={t.statut} />
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="card card-pad col">
      <div className="row between">
        <h2>{formatDateFr(v.date)} — {v.titre || "Visite"}</h2>
        <div className="row">
          {!v.cloturee && (active
            ? <button className="btn" onClick={() => setVisit(null)}><Icon name="stop" />Arrêter la visite</button>
            : <button className="btn primary" onClick={() => setVisit({ projectId: v.project_id, visitId: v.id, label: `${formatDateFr(v.date)} — ${v.titre ?? ""}` })}><Icon name="play" />Démarrer la visite</button>)}
          <button className="btn" disabled={busy} onClick={report}><Icon name="pdf" />{busy ? "Génération…" : "Compte rendu PDF"}</button>
        </div>
      </div>
      {active && <div className="callout warn">Visite en cours : les points créés ou modifiés sur {project?.nom} y sont rattachés.</div>}
      <div className="grid3">
        <Field label="Date"><input type="date" className="input" value={val("date")} onChange={(e) => setD({ ...d, date: e.target.value })} onBlur={blur("date")} /></Field>
        <Field label="Objet"><input className="input" value={val("titre")} onChange={(e) => setD({ ...d, titre: e.target.value })} onBlur={blur("titre")} /></Field>
        <Field label="Météo"><input className="input" value={val("meteo")} onChange={(e) => setD({ ...d, meteo: e.target.value })} onBlur={blur("meteo")} /></Field>
      </div>
      <div className="grid2">
        <Field label="Participants"><textarea className="textarea" rows={4} value={val("participants")} onChange={(e) => setD({ ...d, participants: e.target.value })} onBlur={blur("participants")} /></Field>
        <Field label="Observations générales"><textarea className="textarea" rows={4} value={val("notes")} onChange={(e) => setD({ ...d, notes: e.target.value })} onBlur={blur("notes")} /></Field>
      </div>
      {list(touched?.crees, "Points créés")}
      {list(touched?.modifies, "Points mis à jour")}
      <Checklists projectId={v.project_id} visitId={v.id} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => saveVisit({ ...v, cloturee: !v.cloturee }).then(() => !v.cloturee && active && setVisit(null))}>
          <Icon name="check" />{v.cloturee ? "Rouvrir la visite" : "Clôturer la visite"}
        </button>
        <span className="grow" />
        <button className="btn danger" onClick={async () => { if (await ui.confirm("Supprimer cette visite ? Les points restent.", { danger: true, ok: "Supprimer" })) { if (active) setVisit(null); await deleteVisit(v.id); } }}><Icon name="trash" />Supprimer</button>
      </div>
    </div>
  );
}
