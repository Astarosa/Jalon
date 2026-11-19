import { useState } from "react";
import { STATUTS, STATUT_LIST, STATUTS_OUVERTS, formatDateFr, safeFileName, type Statut } from "@chantier/core";
import { Icon, Progress, useUi } from "@chantier/ui";
import { getProject, listAssignments, listVisits } from "../data/repo";
import { useData } from "../data/useData";
import { platform, writeReport } from "../platform";
import { generateCompanyReports, generateGlobalReport, generateVisitReport } from "../reports/generate";
import { exportXlsx } from "../exporting/xlsx";
import { exportProjectZip } from "../exporting/zip";

type Done = { label: string; path: string };

export function ReportsTab({ projectId }: { projectId: string }) {
  const assignments = useData(() => listAssignments(projectId), [projectId]);
  const visits = useData(() => listVisits(projectId), [projectId]);
  const [companies, setCompanies] = useState<Set<string>>(new Set());
  const [statuts, setStatuts] = useState<string[]>(STATUTS_OUVERTS);
  const [opts, setOpts] = useState({ planExtracts: true, photos: true, maxPhotos: 3, mesures: true });
  const [visitId, setVisitId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const ui = useUi();
  const project = useData(() => getProject(projectId), [projectId]);
  const projectFolder = safeFileName(project?.nom ?? "chantier");

  const run = async (label: string, fn: () => Promise<Done[]>) => {
    setBusy(label);
    try {
      const d = await fn();
      if (!d.length) ui.toast("Rien à éditer pour ces critères", "error");
      else {
        setDone((x) => [...d, ...x]);
        ui.toast(`${d.length} document(s) enregistré(s)`, "ok");
      }
    } catch (e) {
      console.error(e);
      ui.toast(`Échec : ${e}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const allIds = (assignments ?? []).map((a) => a.company.id);
  const uniq = [...new Map((assignments ?? []).map((a) => [a.company.id, a.company])).values()];

  return (
    <div className="page">
      <div className="page-narrow col gap-lg">
        <div className="card card-pad col">
          <div className="row between"><h2><Icon name="users" /> Points à traiter par entreprise</h2></div>
          <div className="small muted">Un PDF par entreprise, avec extrait de plan localisé et photos — à envoyer à chaque intervenant.</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setCompanies(new Set(allIds))}>Toutes</button>
            <button className="btn sm ghost" onClick={() => setCompanies(new Set())}>Aucune</button>
            {uniq.map((c) => (
              <label key={c.id} className="check badge" style={{ height: 26 }}>
                <input type="checkbox" checked={companies.has(c.id)} onChange={(e) => { const n = new Set(companies); if (e.target.checked) n.add(c.id); else n.delete(c.id); setCompanies(n); }} />{c.nom}
              </label>
            ))}
            {assignments && !assignments.length && <span className="muted small">Aucune entreprise sur ce chantier.</span>}
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="small muted">Statuts :</span>
            {STATUT_LIST.map((s) => (
              <label key={s} className="check small"><input type="checkbox" checked={statuts.includes(s)} onChange={(e) => setStatuts(e.target.checked ? [...statuts, s] : statuts.filter((x) => x !== s))} />{STATUTS[s as Statut].label}</label>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="check small"><input type="checkbox" checked={opts.planExtracts} onChange={(e) => setOpts({ ...opts, planExtracts: e.target.checked })} />Extraits de plan</label>
            <label className="check small"><input type="checkbox" checked={opts.photos} onChange={(e) => setOpts({ ...opts, photos: e.target.checked })} />Photos</label>
            <label className="check small"><input type="checkbox" checked={opts.mesures} onChange={(e) => setOpts({ ...opts, mesures: e.target.checked })} />Mesures (tracés et tableau)</label>
            <label className="small row">Photos par point <input type="number" min={1} max={6} className="input num" style={{ width: 60, height: 26 }} value={opts.maxPhotos} onChange={(e) => setOpts({ ...opts, maxPhotos: +e.target.value || 1 })} /></label>
          </div>
          <div className="row end">
            <button className="btn primary" disabled={!companies.size || !statuts.length || !!busy}
              onClick={() => run("entreprises", async () => (await generateCompanyReports(projectId, [...companies], statuts, opts, (m) => setBusy(`Rapport : ${m}`))).map((r) => ({ label: r.name, path: r.path })))}>
              <Icon name="pdf" />Générer {companies.size > 1 ? `${companies.size} rapports` : "le rapport"}
            </button>
          </div>
        </div>

        <div className="grid2">
          <div className="card card-pad col">
            <h2><Icon name="calendar" /> Compte rendu de visite</h2>
            <select className="select" value={visitId} onChange={(e) => setVisitId(e.target.value)}>
              <option value="">Choisir une visite…</option>
              {visits?.map((v) => <option key={v.id} value={v.id}>{formatDateFr(v.date)} — {v.titre ?? "Visite"}</option>)}
            </select>
            <div className="row end"><button className="btn" disabled={!visitId || !!busy} onClick={() => run("visite", async () => [{ label: "Compte rendu de visite", path: await generateVisitReport(visitId, opts) }])}><Icon name="pdf" />Générer</button></div>
          </div>
          <div className="card card-pad col">
            <h2><Icon name="layers" /> État du chantier</h2>
            <div className="small muted">Synthèse par lot et par entreprise, liste des points non clos.</div>
            <div className="row end"><button className="btn" disabled={!!busy} onClick={() => run("etat", async () => { const r = await generateGlobalReport(projectId, opts.mesures); return [{ label: r.name, path: r.path }]; })}><Icon name="pdf" />Générer</button></div>
          </div>
          <div className="card card-pad col">
            <h2><Icon name="sheet" /> Export Excel</h2>
            <div className="small muted">Points, mesures et visites, avec filtres automatiques.</div>
            <div className="row end"><button className="btn" disabled={!!busy} onClick={() => run("xlsx", async () => {
              const r = await exportXlsx(projectId);
              return [{ label: r.name, path: await writeReport(projectFolder, r.name, r.bytes) }];
            })}><Icon name="download" />Exporter</button></div>
          </div>
          <div className="card card-pad col">
            <h2><Icon name="archive" /> Export complet (.zip)</h2>
            <div className="small muted">Toutes les données, plans et photos du chantier : archivage, transfert vers un autre poste, future application collaborative.</div>
            <div className="row end"><button className="btn" disabled={!!busy} onClick={() => run("zip", async () => {
              const r = await exportProjectZip(projectId, (m) => setBusy(`Export : ${m}`));
              const p = await platform.saveAs(r.bytes, r.name, "Archive de chantier", "zip");
              return p ? [{ label: r.name, path: p }] : [];
            })}><Icon name="download" />Exporter</button></div>
          </div>
        </div>

        {busy && <div className="card card-pad col"><b>{busy}…</b><Progress value={0.5} /></div>}

        {done.length > 0 && (
          <div className="card card-pad col">
            <h2>Documents générés</h2>
            {done.map((d, i) => (
              <div key={i} className="row">
                <Icon name="file" /><span className="grow ellipsis" title={d.path}>{d.label}</span>
                <button className="btn sm" onClick={() => platform.openPath(d.path)}>Ouvrir</button>
                <button className="btn sm ghost" onClick={() => platform.revealPath(d.path)}>Afficher dans le dossier</button>
              </div>
            ))}
            <div className="small muted">Les rapports sont rangés dans le dossier « rapports » de vos données.</div>
          </div>
        )}
      </div>
    </div>
  );
}
