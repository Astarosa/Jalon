import { useState } from "react";
import { LOTS_TYPES, formatDateFr, type Project } from "@chantier/core";
import { Empty, Field, Icon, Modal, useUi } from "@chantier/ui";
import { createProject, listProjects, projectStats } from "../data/repo";
import { useData } from "../data/useData";
import { useApp } from "../nav";
import { Topbar } from "../components/Topbar";
import { importProjectZip } from "../exporting/zip";

export function HomeScreen() {
  const projects = useData(listProjects, []);
  const stats = useData(projectStats, []);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const { go } = useApp();
  const ui = useUi();

  const importZip = () => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = ".zip";
    i.onchange = async () => {
      const f = i.files?.[0];
      if (!f) return;
      try {
        const r = await importProjectZip(new Uint8Array(await f.arrayBuffer()), async (nom) =>
          ui.confirm(<>Le chantier <b>{nom}</b> existe déjà. Le remplacer par la version du fichier (les éléments plus récents du fichier écrasent les vôtres) ?</>, { ok: "Fusionner" }));
        if (r) {
          ui.toast(`Chantier « ${r.nom} » importé`, "ok");
          go({ view: "project", projectId: r.id, tab: "plans" });
        }
      } catch (e) {
        ui.toast(`Import impossible : ${e}`, "error");
      }
    };
    i.click();
  };

  const visible = (projects ?? []).filter((p) => showArchived || !p.archive);
  return (
    <>
      <Topbar crumbs={[{ label: "Chantiers" }]}>
        <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Afficher les archivés</label>
        <button className="btn" onClick={importZip}><Icon name="upload" />Importer un chantier (.zip)</button>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />Nouveau chantier</button>
      </Topbar>
      <div className="page">
        {projects && !visible.length && (
          <Empty icon="building" title="Aucun chantier">
            <p>Créez votre premier chantier, puis importez ses plans PDF.</p>
            <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />Nouveau chantier</button>
          </Empty>
        )}
        <div className="cards">
          {visible.map((p) => <ProjectCard key={p.id} p={p} s={stats?.[p.id]} onOpen={() => go({ view: "project", projectId: p.id, tab: "plans" })} />)}
        </div>
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={(id) => go({ view: "project", projectId: id, tab: "plans" })} />}
    </>
  );
}

function ProjectCard({ p, s, onOpen }: { p: Project; s?: { total: number; ouverts: number; retard: number }; onOpen: () => void }) {
  return (
    <button className="card proj-card" onClick={onOpen} style={{ opacity: p.archive ? 0.6 : 1 }}>
      <div className="row between">
        <span className="ref">{p.reference || "—"}</span>
        {p.archive ? <span className="badge">Archivé</span> : null}
      </div>
      <h3>{p.nom}</h3>
      <div className="muted small ellipsis">{p.adresse || "Adresse non renseignée"}</div>
      <div className="muted small">{p.moa ? `MOA : ${p.moa}` : ""}{p.date_fin ? ` · Fin prévue ${formatDateFr(p.date_fin)}` : ""}</div>
      <div className="kpis">
        <div className="kpi"><b>{s?.total ?? 0}</b><span>points</span></div>
        <div className="kpi"><b>{s?.ouverts ?? 0}</b><span>non clos</span></div>
        <div className={`kpi ${s?.retard ? "alert" : ""}`}><b>{s?.retard ?? 0}</b><span>en retard</span></div>
      </div>
    </button>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ nom: "", reference: "", adresse: "", moa: "", date_debut: "", date_fin: "" });
  const [lots, setLots] = useState<string[]>(LOTS_TYPES.slice(0, 10));
  const [extra, setExtra] = useState("");
  const ui = useUi();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (!f.nom.trim()) return ui.toast("Le nom du chantier est obligatoire", "error");
    const extras = extra.split("\n").map((x) => x.trim()).filter(Boolean);
    const id = await createProject(
      { nom: f.nom.trim(), reference: f.reference || null, adresse: f.adresse || null, moa: f.moa || null, date_debut: f.date_debut || null, date_fin: f.date_fin || null },
      [...LOTS_TYPES.filter((l) => lots.includes(l)), ...extras],
    );
    onClose();
    onCreated(id);
  };
  return (
    <Modal title="Nouveau chantier" size="wide" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={submit}>Créer le chantier</button></>}>
      <div className="grid2">
        <Field label="Nom du chantier"><input className="input" autoFocus value={f.nom} onChange={set("nom")} placeholder="Résidence Les Tilleuls" /></Field>
        <Field label="Référence / n° d'affaire"><input className="input" value={f.reference} onChange={set("reference")} /></Field>
        <Field label="Adresse"><input className="input" value={f.adresse} onChange={set("adresse")} /></Field>
        <Field label="Maître d'ouvrage"><input className="input" value={f.moa} onChange={set("moa")} /></Field>
        <Field label="Début des travaux"><input type="date" className="input" value={f.date_debut} onChange={set("date_debut")} /></Field>
        <Field label="Fin prévue"><input type="date" className="input" value={f.date_fin} onChange={set("date_fin")} /></Field>
      </div>
      <div className="section-title">Lots du chantier</div>
      <div className="grid3">
        {LOTS_TYPES.map((l) => (
          <label key={l} className="check">
            <input type="checkbox" checked={lots.includes(l)} onChange={(e) => setLots(e.target.checked ? [...lots, l] : lots.filter((x) => x !== l))} />{l}
          </label>
        ))}
      </div>
      <Field label="Autres lots" hint="un par ligne">
        <textarea className="textarea" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} />
      </Field>
    </Modal>
  );
}
