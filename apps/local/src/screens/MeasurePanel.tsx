import { useEffect, useState } from "react";
import { formatArea, formatLength, measure, ratioFromMpp, type Dims, type MeasureType, type Ticket } from "@chantier/core";
import { Field, Icon, useUi } from "@chantier/ui";
import { deleteMeasurement, saveMeasurement, type Calibration, type MeasurementP } from "../data/repo";

const COLORS = ["#e8590c", "#1e5aa8", "#2e9a5b", "#9333ea", "#c73a3a", "#17202a"];
const TYPES: Record<string, string> = { distance: "Distance", polyligne: "Longueur cumulée", surface: "Surface" };

export function MeasurePanel({ id, measures, dims, cals, tickets, onClose }: {
  id: string; measures: MeasurementP[]; dims: Dims; cals: Calibration[]; tickets: Ticket[]; onClose: () => void;
}) {
  const m = measures.find((x) => x.id === id);
  const [libelle, setLibelle] = useState(m?.libelle ?? "");
  const ui = useUi();
  useEffect(() => setLibelle(m?.libelle ?? ""), [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;
  const r = measure(m.type as MeasureType, m.pts, dims, cals);
  const upd = (patch: Partial<MeasurementP>) => saveMeasurement({ ...m, ...patch, pts: patch.pts ?? m.pts });
  const cal = r.calibration as Calibration | undefined;

  return (
    <>
      <div className="panel-head">
        <Icon name={m.type === "surface" ? "area" : m.type === "polyligne" ? "polyline" : "ruler"} />
        <b className="grow">{TYPES[m.type]}</b>
        <button className="btn ghost icon sm" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="panel-body">
        <div className="card card-pad" style={{ textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 28 }}>{m.type === "surface" ? formatArea(r.valeur) : formatLength(r.valeur)}</div>
          {m.type === "surface" && <div className="muted mono">périmètre {formatLength(r.perimetre)}</div>}
          <div className="small muted" style={{ marginTop: 6 }}>
            {cal ? <>Échelle : {cal.zone ? `zone « ${cal.nom} »` : "page"} · 1/{Math.round(ratioFromMpp(cal.metres_par_point))}</> : "Aucun étalonnage à cet endroit"}
          </div>
        </div>
        {r.zonesMelangees && <div className="callout warn">Les points de cette mesure sont dans des zones d'échelles différentes : la valeur utilise l'échelle du premier point.</div>}
        <Field label="Libellé"><input className="input" value={libelle} placeholder="ex. Fissure façade nord" onChange={(e) => setLibelle(e.target.value)} onBlur={() => libelle !== (m.libelle ?? "") && upd({ libelle: libelle || null })} /></Field>
        <Field label="Couleur">
          <div className="row">{COLORS.map((c) => <span key={c} className={`swatch ${(m.couleur ?? "#e8590c") === c ? "on" : ""}`} style={{ background: c }} onClick={() => upd({ couleur: c })} />)}</div>
        </Field>
        <Field label="Rattacher à un point" hint="reprise dans les rapports">
          <select className="select" value={m.ticket_id ?? ""} onChange={(e) => upd({ ticket_id: e.target.value || null })}>
            <option value="">—</option>
            {tickets.map((t) => <option key={t.id} value={t.id}>#{t.numero} {t.titre}</option>)}
          </select>
        </Field>
        <div className="small muted">{m.pts.length} sommet(s). Les valeurs sont recalculées si l'étalonnage change.</div>
        <div className="row end">
          <button className="btn danger" onClick={async () => { if (await ui.confirm("Supprimer cette mesure ?", { danger: true, ok: "Supprimer" })) { await deleteMeasurement(m.id); onClose(); } }}><Icon name="trash" />Supprimer</button>
        </div>
      </div>
    </>
  );
}
