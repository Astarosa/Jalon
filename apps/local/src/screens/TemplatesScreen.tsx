import { useState } from "react";
import { Field, Icon, Modal, useUi } from "@chantier/ui";
import { deleteTemplate, listTemplates, saveTemplate } from "../data/repo";
import { useData } from "../data/useData";
import { Topbar } from "../components/Topbar";

type Tpl = { id?: string; nom: string; description?: string | null; list: string[] };

export function TemplatesScreen() {
  const templates = useData(listTemplates, []);
  const [edit, setEdit] = useState<Tpl | null>(null);
  const ui = useUi();
  return (
    <>
      <Topbar crumbs={[{ label: "Modèles de checklists" }]}>
        <button className="btn primary" onClick={() => setEdit({ nom: "", list: [] })}><Icon name="plus" />Nouveau modèle</button>
      </Topbar>
      <div className="page">
        <div className="small muted" style={{ marginBottom: 12 }}>Les modèles s'ajoutent à un point ou à une visite ; chaque élément se coche « conforme », « non conforme » ou « sans objet ».</div>
        <div className="cards">
          {templates?.map((t) => (
            <div key={t.id} className="card card-pad col">
              <div className="row between"><h3>{t.nom}</h3><span className="badge">{t.list.length} éléments</span></div>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{t.list.slice(0, 5).map((x, i) => <li key={i}>{x}</li>)}{t.list.length > 5 && <li>…</li>}</ul>
              <div className="row end">
                <button className="btn sm" onClick={() => setEdit(t)}><Icon name="edit" size={13} />Modifier</button>
                <button className="btn sm ghost icon danger" onClick={async () => (await ui.confirm(`Supprimer le modèle « ${t.nom} » ?`, { danger: true, ok: "Supprimer" })) && deleteTemplate(t.id)}><Icon name="trash" size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {edit && <TemplateDialog t={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function TemplateDialog({ t, onClose }: { t: Tpl; onClose: () => void }) {
  const [nom, setNom] = useState(t.nom);
  const [items, setItems] = useState(t.list.join("\n"));
  const ui = useUi();
  const ok = async () => {
    if (!nom.trim()) return ui.toast("Nom obligatoire", "error");
    await saveTemplate({ id: t.id, nom: nom.trim(), list: items.split("\n").map((x) => x.trim()).filter(Boolean) });
    onClose();
  };
  return (
    <Modal title={t.id ? "Modifier le modèle" : "Nouveau modèle"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={ok}>Enregistrer</button></>}>
      <Field label="Nom"><input className="input" autoFocus value={nom} onChange={(e) => setNom(e.target.value)} /></Field>
      <Field label="Éléments à contrôler" hint="un par ligne"><textarea className="textarea" rows={10} value={items} onChange={(e) => setItems(e.target.value)} /></Field>
    </Modal>
  );
}
