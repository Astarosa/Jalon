import { useState } from "react";
import { nextIndice, formatDateFr, type PlanVersion } from "@chantier/core";
import { DropZone, Empty, Field, Icon, Modal, Progress, useUi } from "@chantier/ui";
import { deletePlan, listPlans, updatePlan, type PlanWithVersions } from "../data/repo";
import { db } from "../data/db";
import { useData } from "../data/useData";
import { useApp } from "../nav";
import { platform } from "../platform";
import { describePages, tileLevels, TILE, type PageInfo } from "../pdf/pdf";
import { importNewIndice, importNewPlans, openLocalPdf, type LoadedPdf, type PageChoice } from "../pdf/importPlans";
import { schema as s } from "@chantier/core";
import { and, inArray, isNull } from "drizzle-orm";

async function calibratedVersions(pvids: string[]): Promise<Set<string>> {
  if (!pvids.length) return new Set();
  const rows = await db.select({ id: s.planCalibrations.plan_version_id }).from(s.planCalibrations)
    .where(and(inArray(s.planCalibrations.plan_version_id, pvids), isNull(s.planCalibrations.deleted_at)));
  return new Set(rows.map((r) => r.id));
}

export const thumbUrl = (v: PlanVersion) => platform.tileUrl(v.id, tileLevels(v.largeur_pt, v.hauteur_pt).zMin, 0, 0);

/** Vignette = tuile la plus large, recadrée sur la page. */
export function thumbStyle(v: PlanVersion): React.CSSProperties {
  const { zMin } = tileLevels(v.largeur_pt, v.hauteur_pt);
  const pagePx = v.largeur_pt * 2 ** zMin;
  return {
    backgroundImage: `url(${thumbUrl(v)})`,
    backgroundSize: `${(TILE / pagePx) * 100}% auto`,
    backgroundPosition: "0 0",
    aspectRatio: `${v.largeur_pt} / ${v.hauteur_pt}`,
  };
}

export function PlansTab({ projectId }: { projectId: string }) {
  const plans = useData(() => listPlans(projectId), [projectId]);
  const calibrated = useData(async () => calibratedVersions((plans ?? []).map((p) => p.current?.id).filter(Boolean) as string[]), [plans]);
  const [importing, setImporting] = useState(false);
  const [indiceFor, setIndiceFor] = useState<PlanWithVersions | null>(null);
  const { go } = useApp();
  const ui = useUi();

  const rename = async (p: PlanWithVersions) => {
    const nom = await ui.prompt("Renommer le plan", "Nom", p.plan.nom);
    if (nom?.trim()) await updatePlan(p.plan.id, { nom: nom.trim() });
  };
  const niveau = async (p: PlanWithVersions) => {
    const n = await ui.prompt("Niveau / zone", "Niveau", p.plan.niveau ?? "");
    if (n != null) await updatePlan(p.plan.id, { niveau: n.trim() || null });
  };
  const remove = async (p: PlanWithVersions) => {
    if (await ui.confirm(<>Supprimer le plan <b>{p.plan.nom}</b> et toutes ses versions ? Les points restent dans la liste du chantier.</>, { danger: true, ok: "Supprimer" }))
      await deletePlan(p.plan.id);
  };

  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="muted">{plans?.length ?? 0} plan(s)</div>
        <button className="btn primary" onClick={() => setImporting(true)}><Icon name="upload" />Importer des plans PDF</button>
      </div>
      {plans && !plans.length && (
        <Empty icon="layers" title="Aucun plan">
          <p>Importez les PDF exportés depuis ArchiCAD : chaque page devient un plan.</p>
          <button className="btn primary" onClick={() => setImporting(true)}><Icon name="upload" />Importer des plans PDF</button>
        </Empty>
      )}
      <div className="cards">
        {plans?.map((p) => p.current && (
          <div key={p.plan.id} className="card plan-card">
            <div className="thumb" style={thumbStyle(p.current)}
              onClick={() => go({ view: "plan", projectId, planId: p.plan.id, versionId: p.current!.id })}>
              <span className="tag badge accent">Indice {p.current.indice}</span>
            </div>
            <div className="body">
              <div className="row between">
                <b className="ellipsis">{p.plan.nom}</b>
                {calibrated?.has(p.current.id) ? <span className="badge ok">Étalonné</span> : <span className="badge warn">Non étalonné</span>}
              </div>
              <div className="muted small">{p.plan.niveau || "—"} · {p.versions.length} indice(s) · {formatDateFr(p.current.created_at)}</div>
              <div className="row" style={{ marginTop: 6, gap: 4 }}>
                <button className="btn sm" onClick={() => go({ view: "plan", projectId, planId: p.plan.id, versionId: p.current!.id })}><Icon name="eye" size={14} />Ouvrir</button>
                <button className="btn sm" onClick={() => setIndiceFor(p)} title="Importer un nouvel indice"><Icon name="migrate" size={14} />Nouvel indice</button>
                <span className="grow" />
                <button className="btn sm ghost icon" title="Renommer" onClick={() => rename(p)}><Icon name="edit" size={14} /></button>
                <button className="btn sm ghost icon" title="Niveau" onClick={() => niveau(p)}><Icon name="layers" size={14} /></button>
                <button className="btn sm ghost icon danger" title="Supprimer" onClick={() => remove(p)}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {importing && <ImportDialog projectId={projectId} onClose={() => setImporting(false)} />}
      {indiceFor && <IndiceDialog plan={indiceFor} projectId={projectId} onClose={() => setIndiceFor(null)} />}
    </div>
  );
}

function usePdfPicker() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [pages, setPages] = useState<PageInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ui = useUi();
  const pick = async (files: File[]) => {
    const f = files.find((x) => x.name.toLowerCase().endsWith(".pdf"));
    if (!f) return ui.toast("Choisissez un fichier PDF", "error");
    setLoading(true);
    try {
      const p = await openLocalPdf(f);
      setPdf(p);
      setPages(await describePages(p.doc));
    } catch (e) {
      ui.toast(`PDF illisible : ${e}`, "error");
    } finally {
      setLoading(false);
    }
  };
  return { pdf, pages, loading, pick };
}

function ImportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { pdf, pages, loading, pick } = usePdfPicker();
  const [choices, setChoices] = useState<Record<number, PageChoice>>({});
  const [busy, setBusy] = useState<{ msg: string; frac: number } | null>(null);
  const ui = useUi();
  const { go } = useApp();

  const base = pdf?.name.replace(/\.pdf$/i, "") ?? "";
  const toggle = (pg: PageInfo, on: boolean) => {
    const c = { ...choices };
    if (on) c[pg.index] = { page: pg, nom: pages!.length > 1 ? `${base} — p.${pg.index + 1}` : base, niveau: "", indice: "A" };
    else delete c[pg.index];
    setChoices(c);
  };
  const upd = (i: number, k: keyof PageChoice, v: string) => setChoices({ ...choices, [i]: { ...choices[i], [k]: v } });

  const run = async () => {
    const list = Object.values(choices).sort((a, b) => a.page.index - b.page.index);
    if (!list.length || !pdf) return;
    setBusy({ msg: "Enregistrement du PDF", frac: 0 });
    try {
      const res = await importNewPlans(projectId, pdf, list, (msg, frac) => setBusy({ msg, frac }));
      const sc = res.reduce((a, r) => a + r.scales, 0);
      ui.toast(`${res.length} plan(s) importé(s)${sc ? ` — ${sc} échelle(s) lue(s) dans le PDF` : ""}`, "ok");
      onClose();
      if (res.length === 1) go({ view: "plan", projectId, planId: res[0].planId, versionId: res[0].versionId });
    } catch (e) {
      ui.toast(`Import impossible : ${e}`, "error");
      setBusy(null);
    }
  };

  return (
    <Modal title="Importer des plans PDF" size="wide" onClose={() => !busy && onClose()}
      footer={busy ? undefined : <><button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={!Object.keys(choices).length} onClick={run}>Importer {Object.keys(choices).length || ""} plan(s)</button></>}>
      {busy ? (
        <div className="col" style={{ padding: "30px 10px" }}>
          <b>{busy.msg}…</b>
          <Progress value={busy.frac} />
          <span className="muted small">Le plan est découpé en tuiles pour un affichage fluide. Ne fermez pas l'application.</span>
        </div>
      ) : !pages ? (
        <DropZone accept=".pdf,application/pdf" onFiles={pick}>
          <Icon name="pdf" size={28} /><div><b>{loading ? "Lecture du PDF…" : "Déposez un PDF ici ou cliquez pour choisir"}</b></div>
          <div className="small">Export ArchiCAD conseillé : mise en page à 100 %, format papier réel.</div>
        </DropZone>
      ) : (
        <>
          <div className="row between">
            <span className="muted">{pdf?.name} — {pages.length} page(s). Cochez les pages à importer.</span>
            <button className="btn sm" onClick={() => setChoices(Object.fromEntries(pages.map((pg) => [pg.index, choices[pg.index] ?? { page: pg, nom: pages.length > 1 ? `${base} — p.${pg.index + 1}` : base, niveau: "", indice: "A" }])))}>Tout cocher</button>
          </div>
          <div className="col">
            {pages.map((pg) => {
              const c = choices[pg.index];
              return (
                <div key={pg.index} className="row card" style={{ padding: 8, alignItems: "flex-start", gap: 12 }}>
                  <label className="check" style={{ marginTop: 4 }}><input type="checkbox" checked={!!c} onChange={(e) => toggle(pg, e.target.checked)} /></label>
                  <img src={pg.thumb} style={{ width: 120, border: "1px solid var(--line)", borderRadius: 4 }} />
                  <div className="col grow">
                    <div className="small muted">Page {pg.index + 1} · {pg.format}</div>
                    {c && (
                      <div className="grid3">
                        <Field label="Nom du plan"><input className="input" value={c.nom} onChange={(e) => upd(pg.index, "nom", e.target.value)} /></Field>
                        <Field label="Niveau / zone"><input className="input" value={c.niveau} placeholder="RDC, R+1…" onChange={(e) => upd(pg.index, "niveau", e.target.value)} /></Field>
                        <Field label="Indice"><input className="input" value={c.indice} onChange={(e) => upd(pg.index, "indice", e.target.value)} /></Field>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

function IndiceDialog({ plan, projectId, onClose }: { plan: PlanWithVersions; projectId: string; onClose: () => void }) {
  const { pdf, pages, loading, pick } = usePdfPicker();
  const [page, setPage] = useState<number>(0);
  const [indice, setIndice] = useState(nextIndice(plan.current?.indice));
  const [busy, setBusy] = useState<{ msg: string; frac: number } | null>(null);
  const ui = useUi();
  const { go } = useApp();
  const run = async () => {
    if (!pdf || !pages) return;
    setBusy({ msg: "Enregistrement", frac: 0 });
    try {
      const r = await importNewIndice(plan.plan.id, plan.current, pdf, pages[page], indice.trim() || nextIndice(plan.current?.indice), (msg, frac) => setBusy({ msg, frac }));
      const notes = [
        r.scales ? `${r.scales} échelle(s) lue(s) dans le PDF` : r.copied ? `étalonnage de l'indice précédent repris (à contrôler)` : "plan à étalonner",
        r.sameSize ? null : "format de page différent : recalage conseillé pour le report des points",
      ].filter(Boolean).join(" · ");
      ui.toast(`Indice ${indice} importé — ${notes}`, "ok");
      onClose();
      go({ view: "plan", projectId, planId: plan.plan.id, versionId: r.versionId });
    } catch (e) {
      ui.toast(`Import impossible : ${e}`, "error");
      setBusy(null);
    }
  };
  return (
    <Modal title={`Nouvel indice — ${plan.plan.nom}`} onClose={() => !busy && onClose()}
      footer={busy ? undefined : <><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={!pages} onClick={run}>Importer l'indice</button></>}>
      {busy ? (
        <div className="col" style={{ padding: "20px 4px" }}><b>{busy.msg}…</b><Progress value={busy.frac} /></div>
      ) : (
        <>
          <div className="muted small">Indice actuel : <b>{plan.current?.indice}</b>. Après l'import, vous pourrez reporter les points ouverts sur le nouvel indice depuis le plan.</div>
          {!pages ? (
            <DropZone accept=".pdf,application/pdf" onFiles={pick}><Icon name="pdf" size={26} /><div><b>{loading ? "Lecture…" : "Déposez le PDF du nouvel indice"}</b></div></DropZone>
          ) : (
            <>
              <Field label="Page"><select className="select" value={page} onChange={(e) => setPage(+e.target.value)}>
                {pages.map((p) => <option key={p.index} value={p.index}>Page {p.index + 1} — {p.format}</option>)}
              </select></Field>
              <img src={pages[page].thumb} style={{ width: 220, alignSelf: "center", border: "1px solid var(--line)" }} />
            </>
          )}
          <Field label="Indice"><input className="input" value={indice} onChange={(e) => setIndice(e.target.value)} /></Field>
        </>
      )}
    </Modal>
  );
}
