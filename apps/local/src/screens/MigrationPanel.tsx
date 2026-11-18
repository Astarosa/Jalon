import { useState } from "react";
import { similarityFromPairs, toPt, type PlanVersion, type Pt, type Similarity } from "@chantier/core";
import { Field, Icon, useUi } from "@chantier/ui";
import { listTickets, migrateToVersion } from "../data/repo";
import { useData } from "../data/useData";

export function MigrationPanel({ projectId, target, previous, startPick, showVersion, onClose }: {
  projectId: string; target: PlanVersion; previous: PlanVersion[];
  startPick: (h: (pts: Pt[]) => void) => void; showVersion: (id: string | null) => void; onClose: () => void;
}) {
  const ui = useUi();
  const [srcId, setSrcId] = useState(previous[previous.length - 1]?.id ?? "");
  const src = previous.find((v) => v.id === srcId);
  const [mode, setMode] = useState<"same" | "recal">(
    src && Math.abs(src.largeur_pt - target.largeur_pt) < 1 && Math.abs(src.hauteur_pt - target.hauteur_pt) < 1 ? "same" : "recal",
  );
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [withMeasures, setWithMeasures] = useState(true);
  const [newPts, setNewPts] = useState<Pt[] | null>(null);
  const [oldPts, setOldPts] = useState<Pt[] | null>(null);
  const counts = useData(async () => {
    if (!src) return { all: 0, open: 0 };
    const all = await listTickets({ projectId, planVersionId: src.id });
    return { all: all.length, open: all.filter((t) => t.statut !== "clos").length };
  }, [srcId]);

  let sim: Similarity | undefined;
  if (mode === "recal" && newPts && oldPts && src) {
    const sd = { w: src.largeur_pt, h: src.hauteur_pt }, dd = { w: target.largeur_pt, h: target.hauteur_pt };
    try {
      sim = similarityFromPairs(toPt(oldPts[0], sd), toPt(oldPts[1], sd), toPt(newPts[0], dd), toPt(newPts[1], dd));
    } catch {
      sim = undefined;
    }
  }

  const pickNew = () => {
    showVersion(null);
    startPick((pts) => setNewPts(pts));
  };
  const pickOld = () => {
    showVersion(srcId);
    startPick((pts) => {
      setOldPts(pts);
      showVersion(null);
    });
  };

  const run = async () => {
    if (!src) return;
    if (mode === "recal" && !sim) return ui.toast("Saisissez les deux points de repère sur chaque indice", "error");
    const r = await migrateToVersion(src, target, mode === "recal" ? sim : undefined, { onlyOpen, measures: withMeasures });
    ui.toast(`${r.tickets} point(s) et ${r.measures} mesure(s) reportés sur l'indice ${target.indice}`, "ok");
    onClose();
  };

  return (
    <>
      <div className="panel-head">
        <Icon name="migrate" /><b className="grow">Reporter les points sur l'indice {target.indice}</b>
        <button className="btn ghost icon sm" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="panel-body">
        <Field label="Depuis l'indice">
          <select className="select" value={srcId} onChange={(e) => { setSrcId(e.target.value); setOldPts(null); }}>
            {previous.map((v) => <option key={v.id} value={v.id}>Indice {v.indice}</option>)}
          </select>
        </Field>
        <div className="small muted">{counts ? `${counts.open} point(s) non clos sur ${counts.all}` : "…"}</div>
        <Field label="Méthode">
          <div className="col" style={{ gap: 6 }}>
            <label className="check"><input type="radio" checked={mode === "same"} onChange={() => setMode("same")} />Même position sur la page (plans superposables)</label>
            <label className="check"><input type="radio" checked={mode === "recal"} onChange={() => setMode("recal")} />Recaler avec deux points de repère</label>
          </div>
        </Field>
        {mode === "recal" && (
          <div className="callout" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="small">Choisissez deux repères identiques sur les deux indices (angles de murs, axes de trame), éloignés l'un de l'autre.</span>
            <div className="row between">
              <span>1. Repères sur l'indice {target.indice}</span>
              <button className="btn sm" onClick={pickNew}>{newPts ? "✓ Refaire" : "Placer"}</button>
            </div>
            <div className="row between">
              <span>2. Mêmes repères sur l'indice {src?.indice}</span>
              <button className="btn sm" disabled={!newPts} onClick={pickOld}>{oldPts ? "✓ Refaire" : "Placer"}</button>
            </div>
            {sim && (
              <span className="small mono">
                échelle × {Math.hypot(sim.a, sim.b).toFixed(4)} · rotation {((Math.atan2(sim.b, sim.a) * 180) / Math.PI).toFixed(2)}°
              </span>
            )}
          </div>
        )}
        <label className="check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />Uniquement les points non clos</label>
        <label className="check"><input type="checkbox" checked={withMeasures} onChange={(e) => setWithMeasures(e.target.checked)} />Copier aussi les mesures</label>
        <div className="small muted">Les points reportés quittent l'ancien indice ; l'historique de chaque point garde la trace du report.</div>
        <div className="row end">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={!src || (mode === "recal" && !sim)} onClick={run}>Reporter</button>
        </div>
      </div>
    </>
  );
}
