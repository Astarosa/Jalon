import { useState } from "react";
import type { Company } from "@chantier/core";
import { Empty, Field, Icon, Modal, useUi } from "@chantier/ui";
import { deleteCompany, listCompanies, saveCompany } from "../data/repo";
import { useData } from "../data/useData";
import { Topbar } from "../components/Topbar";

export function CompaniesScreen() {
  const companies = useData(listCompanies, []);
  const [edit, setEdit] = useState<Partial<Company> | null>(null);
  const [q, setQ] = useState("");
  const ui = useUi();
  const list = (companies ?? []).filter((c) => `${c.nom} ${c.contact ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Topbar crumbs={[{ label: "Carnet des entreprises" }]}>
        <input className="input" style={{ width: 220 }} placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" />Nouvelle entreprise</button>
      </Topbar>
      <div className="page">
        {companies && !companies.length ? (
          <Empty icon="users" title="Carnet vide">Les entreprises créées ici sont réutilisables sur tous vos chantiers.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Entreprise</th><th>Contact</th><th>E-mail</th><th>Téléphone</th><th>Adresse</th><th style={{ width: 80 }} /></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="click" onClick={() => setEdit(c)}>
                    <td><b>{c.nom}</b></td><td>{c.contact}</td><td>{c.email}</td><td className="mono small">{c.telephone}</td><td className="small">{c.adresse}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn sm ghost icon danger" onClick={async () => (await ui.confirm(`Supprimer « ${c.nom} » du carnet ?`, { danger: true, ok: "Supprimer" })) && deleteCompany(c.id)}><Icon name="trash" size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <CompanyDialog c={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

export function CompanyDialog({ c, onClose }: { c: Partial<Company>; onClose: () => void }) {
  const [f, setF] = useState<Partial<Company>>(c);
  const ui = useUi();
  const set = (k: keyof Company) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const ok = async () => {
    if (!f.nom?.trim()) return ui.toast("Nom obligatoire", "error");
    await saveCompany({ ...f, nom: f.nom.trim() });
    onClose();
  };
  return (
    <Modal title={c.id ? c.nom : "Nouvelle entreprise"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={ok}>Enregistrer</button></>}>
      <div className="grid2">
        <Field label="Nom"><input className="input" autoFocus value={f.nom ?? ""} onChange={set("nom")} /></Field>
        <Field label="Contact"><input className="input" value={f.contact ?? ""} onChange={set("contact")} /></Field>
        <Field label="E-mail"><input className="input" value={f.email ?? ""} onChange={set("email")} /></Field>
        <Field label="Téléphone"><input className="input" value={f.telephone ?? ""} onChange={set("telephone")} /></Field>
      </div>
      <Field label="Adresse"><input className="input" value={f.adresse ?? ""} onChange={set("adresse")} /></Field>
      <Field label="Notes"><textarea className="textarea" value={f.notes ?? ""} onChange={set("notes")} /></Field>
    </Modal>
  );
}
