import { useEffect, useState } from "react";
import {
  STATUTS, TRANSITIONS, TICKET_TYPES, PRIORITES, CHECK_ETATS, formatDateFr, measure, formatMeasure, parseShapes,
  type Statut, type Ticket, type TicketPhoto, type Dims, type MeasureType, type CheckEtat,
} from "@chantier/core";
import { DropZone, Field, Icon, Modal, PhotoAnnotator, StatusBadge, useUi } from "@chantier/ui";
import {
  addChecklistItem, addComment, createChecklist, deleteChecklist, deleteChecklistItem, deletePhoto, deleteTicket, getTicket,
  listAssignments, listChecklists, listEvents, listLots, listMeasurementsForTicket, listPhotos, listTemplates, updateChecklistItem,
  updatePhoto, updateTicket, statutLabel, type Calibration, type ChecklistFull,
} from "../data/repo";
import { useData } from "../data/useData";
import { useApp } from "../nav";
import { platform } from "../platform";
import { importPhotos, saveAnnotations } from "../photos/photos";

const FIELD_LABELS: Record<string, string> = {
  titre: "Titre", description: "Description", localisation: "Localisation", type: "Type", lot_id: "Lot", company_id: "Entreprise",
  priorite: "Priorité", echeance: "Échéance", statut: "Statut",
};

export function TicketPanel({ ticketId, projectId, onClose, dims, cals, onShowOnPlan, onRelocate }: {
  ticketId: string; projectId: string; onClose: () => void; dims?: Dims; cals?: Calibration[];
  onShowOnPlan?: (t: Ticket) => void; onRelocate?: () => void;
}) {
  const { visitFor } = useApp();
  const visitId = visitFor(projectId);
  const ui = useUi();
  const t = useData(() => getTicket(ticketId), [ticketId]);
  const lots = useData(() => listLots(projectId), [projectId]);
  const assignments = useData(() => listAssignments(projectId), [projectId]);
  const photos = useData(() => listPhotos(ticketId), [ticketId]);
  const events = useData(() => listEvents(ticketId), [ticketId]);
  const linkedMeasuresAll = useData(() => listMeasurementsForTicket(ticketId), [ticketId]);
  const [draft, setDraft] = useState<Partial<Ticket>>({});
  const [comment, setComment] = useState("");
  const [photoOpen, setPhotoOpen] = useState<TicketPhoto | null>(null);
  const [busyPhotos, setBusyPhotos] = useState(false);

  useEffect(() => setDraft({}), [ticketId]);
  if (!t) return null;
  const linkedMeasures = linkedMeasuresAll?.filter((m) => m.plan_version_id === t.plan_version_id);
  const v = { ...t, ...draft };
  const commit = (k: keyof Ticket, val?: unknown) => {
    const value = val !== undefined ? val : draft[k];
    if (value === undefined || (value ?? null) === (t[k] ?? null)) return;
    updateTicket(t.id, { [k]: value === "" ? null : value } as Partial<Ticket>, visitId);
  };
  const setNow = (k: keyof Ticket, val: unknown) => {
    setDraft({ ...draft, [k]: val });
    commit(k, val);
  };
  const edit = (k: keyof Ticket) => ({
    value: (v[k] as string | null) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [k]: e.target.value }),
    onBlur: () => commit(k),
  });

  const companies = (assignments ?? []).filter((a) => !v.lot_id || !a.lot_id || a.lot_id === v.lot_id);
  const otherCompanies = (assignments ?? []).filter((a) => !companies.includes(a));

  const addPhotos = async (files: File[]) => {
    setBusyPhotos(true);
    try {
      const n = await importPhotos(t.id, files, visitId);
      if (n) ui.toast(`${n} photo(s) ajoutée(s)`, "ok");
    } catch (e) {
      ui.toast(String(e), "error");
    } finally {
      setBusyPhotos(false);
    }
  };

  const remove = async () => {
    if (await ui.confirm(<>Supprimer le point <b>#{t.numero}</b> ?</>, { danger: true, ok: "Supprimer" })) {
      await deleteTicket(t.id);
      onClose();
    }
  };

  return (
    <>
      <div className="panel-head">
        <span className="numero" style={{ fontSize: 16 }}>#{t.numero}</span>
        <StatusBadge statut={t.statut} />
        <span className="grow" />
        {onShowOnPlan && t.plan_version_id && <button className="btn sm" onClick={() => onShowOnPlan(t)}><Icon name="pin" size={14} />Sur le plan</button>}
        {onRelocate && <button className="btn sm ghost icon" title="Déplacer l'épingle" onClick={onRelocate}><Icon name="move" size={14} /></button>}
        <button className="btn sm ghost icon danger" title="Supprimer" onClick={remove}><Icon name="trash" size={14} /></button>
        <button className="btn ghost icon sm" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="panel-body">
        <input className="input" style={{ fontSize: 16, fontWeight: 500, height: 38 }} autoFocus={t.titre === "Nouveau point"}
          onFocus={(e) => t.titre === "Nouveau point" && e.target.select()} {...edit("titre")} />
        <div className="row wrap" style={{ gap: 4 }}>
          {TRANSITIONS[t.statut as Statut]?.map((s) => (
            <button key={s} className="btn sm" style={{ borderColor: STATUTS[s].couleur, color: STATUTS[s].couleur }} onClick={() => setNow("statut", s)}>
              {s === "transmis" ? "Transmettre" : s === "leve" ? "Déclarer levé" : s === "clos" ? "Contrôler et clore" : "Rouvrir"}
            </button>
          ))}
        </div>
        <div className="grid2">
          <Field label="Type">
            <select className="select" value={v.type} onChange={(e) => setNow("type", e.target.value)}>
              {Object.entries(TICKET_TYPES).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="Priorité">
            <select className="select" value={v.priorite} onChange={(e) => setNow("priorite", e.target.value)}>
              {Object.entries(PRIORITES).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="Lot">
            <select className="select" value={v.lot_id ?? ""} onChange={(e) => setNow("lot_id", e.target.value || null)}>
              <option value="">—</option>
              {lots?.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
            </select>
          </Field>
          <Field label="Entreprise">
            <select className="select" value={v.company_id ?? ""} onChange={(e) => setNow("company_id", e.target.value || null)}>
              <option value="">—</option>
              {companies.map((a) => <option key={a.id} value={a.company.id}>{a.company.nom}</option>)}
              {otherCompanies.length > 0 && <optgroup label="Autres lots">{otherCompanies.map((a) => <option key={a.id} value={a.company.id}>{a.company.nom}</option>)}</optgroup>}
            </select>
          </Field>
          <Field label="Échéance"><input type="date" className="input" value={v.echeance ?? ""} onChange={(e) => setNow("echeance", e.target.value || null)} /></Field>
          <Field label="Localisation"><input className="input" placeholder="Pièce, local…" {...edit("localisation")} /></Field>
        </div>
        {assignments && !assignments.length && <div className="small muted">Ajoutez des entreprises au chantier dans l'onglet « Intervenants ».</div>}
        <Field label="Description"><textarea className="textarea" rows={3} {...edit("description")} /></Field>

        <div className="section-title" style={{ margin: "8px 0 0" }}>Photos ({photos?.length ?? 0})</div>
        <div className="photos">
          {photos?.map((p) => (
            <div key={p.id} className="photo-tile" style={{ backgroundImage: `url(${platform.fileUrl(p.thumb_sha256 ?? p.file_sha256)})` }} onClick={() => setPhotoOpen(p)} title={p.legende ?? ""}>
              {p.annotations && <span className="ann badge accent">annotée</span>}
            </div>
          ))}
        </div>
        <DropZone accept="image/*" multiple onFiles={addPhotos}>
          <div className="row" style={{ justifyContent: "center" }}><Icon name="camera" />{busyPhotos ? "Import en cours…" : "Déposer des photos ou cliquer"}</div>
        </DropZone>

        {!!linkedMeasures?.length && dims && cals && (
          <>
            <div className="section-title" style={{ margin: "8px 0 0" }}>Mesures</div>
            {linkedMeasures.map((m) => (
              <div key={m.id} className="row small"><Icon name="ruler" size={14} /><span className="grow">{m.libelle || m.type}</span>
                <span className="mono">{formatMeasure(m.type as MeasureType, measure(m.type as MeasureType, m.pts, dims, cals))}</span></div>
            ))}
          </>
        )}

        <Checklists projectId={projectId} ticketId={t.id} />

        <div className="section-title" style={{ margin: "8px 0 0" }}>Historique</div>
        <div className="row">
          <input className="input" placeholder="Ajouter un commentaire…" value={comment} onChange={(e) => setComment(e.target.value)}
            onKeyDown={async (e) => { if (e.key === "Enter" && comment.trim()) { await addComment(t.id, comment.trim(), visitId); setComment(""); } }} />
          <button className="btn" disabled={!comment.trim()} onClick={async () => { await addComment(t.id, comment.trim(), visitId); setComment(""); }}>Ajouter</button>
        </div>
        <div className="timeline">
          {events?.map((e) => (
            <div key={e.id} className="tl-item">
              <span className="tl-dot" style={{ background: e.type === "statut" ? STATUTS[e.nouveau as Statut]?.couleur : e.type === "commentaire" ? "var(--blue)" : undefined }} />
              <div>
                <div className="when">{formatDateFr(e.date, true)}{e.visit_id ? " · visite" : ""}</div>
                <div className="small">
                  {e.type === "creation" && "Point créé"}
                  {e.type === "statut" && <>Statut : {statutLabel(e.ancien ?? "")} → <b>{statutLabel(e.nouveau ?? "")}</b></>}
                  {e.type === "modification" && <>{FIELD_LABELS[e.champ ?? ""] ?? e.champ} modifié</>}
                  {e.type === "commentaire" && <span style={{ whiteSpace: "pre-wrap" }}>{e.texte}</span>}
                  {e.type === "photo" && "Photo ajoutée"}
                  {e.type === "migration_indice" && <>Reporté de l'indice {e.ancien} vers l'indice {e.nouveau}</>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {photoOpen && <PhotoDialog photo={photoOpen} onClose={() => setPhotoOpen(null)} />}
    </>
  );
}

function PhotoDialog({ photo, onClose }: { photo: TicketPhoto; onClose: () => void }) {
  const [annotate, setAnnotate] = useState(false);
  const [legende, setLegende] = useState(photo.legende ?? "");
  const ui = useUi();
  if (annotate)
    return (
      <Modal title="Annoter la photo" size="full" onClose={() => setAnnotate(false)}>
        <PhotoAnnotator src={platform.fileUrl(photo.file_sha256)} initial={parseShapes(photo.annotations)}
          onCancel={() => setAnnotate(false)}
          onSave={async (shapes) => { await saveAnnotations(photo.id, photo.file_sha256, shapes); ui.toast("Annotations enregistrées", "ok"); onClose(); }} />
      </Modal>
    );
  return (
    <Modal title={`Photo du ${formatDateFr(photo.date_prise, true)}`} size="wide" onClose={onClose}
      footer={<>
        <button className="btn danger" onClick={async () => { if (await ui.confirm("Supprimer cette photo ?", { danger: true, ok: "Supprimer" })) { await deletePhoto(photo.id); onClose(); } }}><Icon name="trash" />Supprimer</button>
        <span className="grow" />
        <button className="btn" onClick={() => setAnnotate(true)}><Icon name="pen" />Annoter</button>
        <button className="btn primary" onClick={async () => { await updatePhoto(photo.id, { legende: legende || null }); onClose(); }}>Fermer</button>
      </>}>
      <img src={platform.fileUrl(photo.rendu_sha256 ?? photo.file_sha256)} style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain", alignSelf: "center", borderRadius: 6 }} />
      <Field label="Légende"><input className="input" value={legende} onChange={(e) => setLegende(e.target.value)} /></Field>
    </Modal>
  );
}

export function Checklists({ projectId, ticketId, visitId }: { projectId: string; ticketId?: string; visitId?: string }) {
  const lists = useData(() => listChecklists({ projectId, ticketId, visitId }), [projectId, ticketId, visitId]);
  const templates = useData(listTemplates, []);
  const ui = useUi();
  const add = async (tplId: string) => {
    if (tplId === "_vide") {
      const nom = await ui.prompt("Nouvelle checklist", "Nom");
      if (nom?.trim()) await createChecklist(projectId, nom.trim(), [], { ticketId, visitId });
      return;
    }
    const tpl = templates?.find((x) => x.id === tplId);
    if (tpl) await createChecklist(projectId, tpl.nom, tpl.list, { ticketId, visitId, templateId: tpl.id });
  };
  return (
    <>
      <div className="section-title" style={{ margin: "8px 0 0" }}>Checklists ({lists?.length ?? 0})</div>
      {lists?.map((cl) => <ChecklistBox key={cl.id} cl={cl} />)}
      <select className="select" value="" onChange={(e) => e.target.value && add(e.target.value)}>
        <option value="">+ Ajouter une checklist…</option>
        {templates?.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
        <option value="_vide">Checklist vide…</option>
      </select>
    </>
  );
}

function ChecklistBox({ cl }: { cl: ChecklistFull }) {
  const ui = useUi();
  const [nv, setNv] = useState("");
  const done = cl.items.filter((i) => i.etat !== "a_faire").length;
  return (
    <div className="card" style={{ padding: "8px 12px" }}>
      <div className="row between">
        <b>{cl.nom}</b>
        <div className="row"><span className="badge">{done}/{cl.items.length}</span>
          <button className="btn sm ghost icon danger" onClick={async () => (await ui.confirm(`Supprimer la checklist « ${cl.nom} » ?`, { danger: true, ok: "Supprimer" })) && deleteChecklist(cl.id)}><Icon name="trash" size={13} /></button>
        </div>
      </div>
      {cl.items.map((it) => (
        <div key={it.id} className="checklist-item">
          <span className="mono" style={{ width: 14 }}>{CHECK_ETATS[it.etat as CheckEtat]?.symbole}</span>
          <div className="small">{it.libelle}{it.note && <div className="muted">{it.note}</div>}</div>
          <div className="row" style={{ gap: 4 }}>
            <div className="etat-group">
              {(["ok", "nok", "na"] as CheckEtat[]).map((e) => (
                <button key={e} className={`${e} ${it.etat === e ? "on" : ""}`} title={CHECK_ETATS[e].label}
                  onClick={() => updateChecklistItem(it.id, { etat: it.etat === e ? "a_faire" : e })}>{CHECK_ETATS[e].symbole}</button>
              ))}
            </div>
            <button className="btn sm ghost icon" title="Note" onClick={async () => { const n = await ui.prompt("Note", it.libelle, it.note ?? ""); if (n != null) updateChecklistItem(it.id, { note: n || null }); }}><Icon name="edit" size={12} /></button>
            <button className="btn sm ghost icon" title="Retirer" onClick={() => deleteChecklistItem(it.id)}><Icon name="x" size={12} /></button>
          </div>
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <input className="input" style={{ height: 28 }} placeholder="Ajouter un élément…" value={nv} onChange={(e) => setNv(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && nv.trim()) { addChecklistItem(cl.id, nv.trim(), cl.items.length); setNv(""); } }} />
      </div>
    </div>
  );
}
