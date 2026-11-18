import { useState } from "react";
import { LOT_COLORS } from "@chantier/core";
import { Field, Icon, Modal, useUi } from "@chantier/ui";
import { assignCompany, deleteLot, listAssignments, listCompanies, listLots, removeAssignment, saveCompany, saveLot, updateAssignment } from "../data/repo";
import { useData } from "../data/useData";

export function IntervenantsTab({ projectId }: { projectId: string }) {
  const lots = useData(() => listLots(projectId), [projectId]);
  const assignments = useData(() => listAssignments(projectId), [projectId]);
  const companies = useData(listCompanies, []);
  const [newLot, setNewLot] = useState("");
  const [adding, setAdding] = useState(false);
  const ui = useUi();

  return (
    <div className="page">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(420px, 1.4fr)", gap: 24, alignItems: "start" }}>
        <div className="col">
          <h2>Lots</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 56 }}>Code</th><th>Lot</th><th style={{ width: 60 }}>Couleur</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {lots?.map((l) => (
                  <tr key={l.id}>
                    <td><input className="input mono" style={{ height: 28 }} defaultValue={l.code ?? ""} onBlur={(e) => e.target.value !== (l.code ?? "") && saveLot({ ...l, code: e.target.value })} /></td>
                    <td><input className="input" style={{ height: 28 }} defaultValue={l.nom} onBlur={(e) => e.target.value.trim() && e.target.value !== l.nom && saveLot({ ...l, nom: e.target.value.trim() })} /></td>
                    <td><input type="color" value={l.couleur} onChange={(e) => saveLot({ ...l, couleur: e.target.value })} style={{ width: 40, height: 26, border: 0, background: "none" }} /></td>
                    <td><button className="btn sm ghost icon danger" onClick={async () => (await ui.confirm(`Supprimer le lot « ${l.nom} » ?`, { danger: true, ok: "Supprimer" })) && deleteLot(l.id)}><Icon name="trash" size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <input className="input" placeholder="Nouveau lot…" value={newLot} onChange={(e) => setNewLot(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newLot.trim()) { saveLot({ project_id: projectId, nom: newLot.trim(), couleur: LOT_COLORS[(lots?.length ?? 0) % LOT_COLORS.length] }); setNewLot(""); } }} />
            <button className="btn" disabled={!newLot.trim()} onClick={() => { saveLot({ project_id: projectId, nom: newLot.trim() }); setNewLot(""); }}><Icon name="plus" />Ajouter</button>
          </div>
        </div>
        <div className="col">
          <div className="row between"><h2>Entreprises du chantier</h2><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Ajouter une entreprise</button></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Entreprise</th><th>Contact</th><th>Lot</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {assignments?.map((a) => (
                  <tr key={a.id}>
                    <td><b>{a.company.nom}</b></td>
                    <td className="small">{a.company.contact}<div className="muted">{a.company.email} {a.company.telephone}</div></td>
                    <td>
                      <select className="select" style={{ height: 28 }} value={a.lot_id ?? ""} onChange={(e) => updateAssignment(a.id, e.target.value || null)}>
                        <option value="">—</option>{lots?.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
                      </select>
                    </td>
                    <td><button className="btn sm ghost icon danger" title="Retirer du chantier" onClick={() => removeAssignment(a.id)}><Icon name="x" size={13} /></button></td>
                  </tr>
                ))}
                {assignments && !assignments.length && <tr><td colSpan={4} className="empty small">Aucune entreprise affectée.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {adding && <AssignDialog projectId={projectId} lots={lots ?? []} companies={companies ?? []} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AssignDialog({ projectId, lots, companies, onClose }: { projectId: string; lots: { id: string; nom: string }[]; companies: { id: string; nom: string }[]; onClose: () => void }) {
  const [mode, setMode] = useState<"existing" | "new">(companies.length ? "existing" : "new");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [lotId, setLotId] = useState("");
  const [c, setC] = useState({ nom: "", contact: "", email: "", telephone: "" });
  const ui = useUi();
  const ok = async () => {
    let id = companyId;
    if (mode === "new") {
      if (!c.nom.trim()) return ui.toast("Nom de l'entreprise obligatoire", "error");
      id = await saveCompany({ ...c, nom: c.nom.trim() });
    }
    if (!id) return;
    await assignCompany(projectId, id, lotId || null);
    onClose();
  };
  return (
    <Modal title="Ajouter une entreprise au chantier" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={ok}>Ajouter</button></>}>
      <div className="btn-group">
        <button className={`btn ${mode === "existing" ? "on" : ""}`} onClick={() => setMode("existing")} disabled={!companies.length}>Depuis le carnet</button>
        <button className={`btn ${mode === "new" ? "on" : ""}`} onClick={() => setMode("new")}>Nouvelle entreprise</button>
      </div>
      {mode === "existing" ? (
        <Field label="Entreprise"><select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>{companies.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select></Field>
      ) : (
        <div className="grid2">
          <Field label="Nom"><input className="input" autoFocus value={c.nom} onChange={(e) => setC({ ...c, nom: e.target.value })} /></Field>
          <Field label="Contact"><input className="input" value={c.contact} onChange={(e) => setC({ ...c, contact: e.target.value })} /></Field>
          <Field label="E-mail"><input className="input" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
          <Field label="Téléphone"><input className="input" value={c.telephone} onChange={(e) => setC({ ...c, telephone: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Lot"><select className="select" value={lotId} onChange={(e) => setLotId(e.target.value)}><option value="">—</option>{lots.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}</select></Field>
    </Modal>
  );
}
