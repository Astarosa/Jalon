import { useState } from "react";
import {
  calibrateRatio, calibrateTwoPoints, controlErrorPct, distRel, formatLength, normRect, parseRatio, ratioFromMpp,
  type Pt, type Rect, type PlanVersion,
} from "@chantier/core";
import { Field, Icon, useUi, type Tool } from "@chantier/ui";
import { deleteCalibration, saveCalibration, type Calibration } from "../data/repo";
import { paperFormat } from "../pdf/pdf";

export type CalFlow =
  | { kind: "page2pts"; picked?: Pt[] }
  | { kind: "zone"; picked?: Pt[] }
  | { kind: "zone2pts"; rect: Rect; nom: string; picked?: Pt[] }
  | { kind: "recal"; calId: string; picked?: Pt[] }
  | { kind: "control"; calId: string; picked?: Pt[] };

const METHODES: Record<string, string> = { pdf: "Échelle lue dans le PDF", ratio: "Échelle saisie", deux_points: "Deux points" };

function ecartBadge(c: Calibration) {
  if (c.controle_attendu_m == null || c.controle_mesure_m == null) return <span className="badge warn">Non contrôlé</span>;
  const e = Math.round(controlErrorPct(c.controle_mesure_m, c.controle_attendu_m) * 100) / 100 || 0;
  const cls = Math.abs(e) <= 0.5 ? "ok" : Math.abs(e) <= 2 ? "warn" : "danger";
  return <span className={`badge ${cls}`}>Contrôle {e >= 0 ? "+" : ""}{e.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %</span>;
}

export function CalibrationPanel({
  version, cals, flow, setFlow, setTool, onClose,
}: { version: PlanVersion; cals: Calibration[]; flow: CalFlow | null; setFlow: (f: CalFlow | null) => void; setTool: (t: Tool) => void; onClose: () => void }) {
  const ui = useUi();
  const dims = { w: version.largeur_pt, h: version.hauteur_pt };
  const page = cals.find((c) => !c.zone);
  const zones = cals.filter((c) => c.zone);
  const [len, setLen] = useState("");
  const [ratioFor, setRatioFor] = useState<null | { calId?: string; zone: Rect | null; nom: string | null }>(null);
  const [ratio, setRatio] = useState("1/100");
  const [zoneNom, setZoneNom] = useState("");

  const start = (f: CalFlow, tool: Tool) => {
    setLen("");
    setRatioFor(null);
    setFlow(f);
    setTool(tool);
  };

  const parseLen = (s: string) => {
    const v = parseFloat(s.replace(",", ".").replace(/\s/g, ""));
    return v > 0 ? v : null;
  };

  const save2pts = async () => {
    if (!flow?.picked || flow.picked.length < 2) return;
    const L = parseLen(len);
    if (!L) return ui.toast("Saisissez la longueur réelle en mètres", "error");
    const [a, b] = flow.picked;
    const mpp = calibrateTwoPoints(a, b, dims, L);
    const base = { methode: "deux_points", p1x: a.x, p1y: a.y, p2x: b.x, p2y: b.y, longueur_reelle_m: L, ratio: null, metres_par_point: mpp, controle_attendu_m: null, controle_mesure_m: null };
    let id: string;
    if (flow.kind === "page2pts") id = await saveCalibration({ ...base, plan_version_id: version.id, nom: "Page", zone: null });
    else if (flow.kind === "zone2pts") id = await saveCalibration({ ...base, plan_version_id: version.id, nom: flow.nom, zone: flow.rect });
    else if (flow.kind === "recal") {
      const c = cals.find((x) => x.id === flow.calId)!;
      id = await saveCalibration({ ...base, id: c.id, plan_version_id: version.id, nom: c.nom, zone: c.zone });
    } else return;
    ui.toast(`Étalonnage enregistré (≈ 1/${Math.round(ratioFromMpp(mpp))}). Faites maintenant une mesure de contrôle.`, "ok");
    start({ kind: "control", calId: id }, "control");
  };

  const saveControl = async () => {
    if (flow?.kind !== "control" || !flow.picked) return;
    const L = parseLen(len);
    if (!L) return ui.toast("Saisissez la longueur attendue en mètres", "error");
    const c = cals.find((x) => x.id === flow.calId)!;
    const mesure = distRel(flow.picked[0], flow.picked[1], dims) * c.metres_par_point;
    await saveCalibration({ ...c, controle_attendu_m: L, controle_mesure_m: mesure });
    const e = controlErrorPct(mesure, L);
    ui.toast(`Contrôle : ${formatLength(mesure)} mesuré pour ${formatLength(L)} attendu (${e >= 0 ? "+" : ""}${e.toFixed(2)} %)`, Math.abs(e) <= 2 ? "ok" : "error");
    setFlow(null);
  };

  const saveRatio = async () => {
    const d = parseRatio(ratio);
    if (!d || !ratioFor) return ui.toast("Échelle invalide (ex. 1/100)", "error");
    const c = ratioFor.calId ? cals.find((x) => x.id === ratioFor.calId) : undefined;
    const id = await saveCalibration({
      ...(c ?? {}), id: c?.id, plan_version_id: version.id, nom: ratioFor.nom ?? (ratioFor.zone ? "Zone" : "Page"), zone: ratioFor.zone,
      methode: "ratio", ratio: Math.round(d), metres_par_point: calibrateRatio(d), p1x: null, p1y: null, p2x: null, p2y: null, longueur_reelle_m: null,
      controle_attendu_m: null, controle_mesure_m: null,
    });
    setRatioFor(null);
    ui.toast("Échelle enregistrée. Une mesure de contrôle est conseillée.", "ok");
    start({ kind: "control", calId: id }, "control");
  };

  const remove = async (c: Calibration) => {
    if (await ui.confirm(`Supprimer l'étalonnage « ${c.nom ?? "Page"} » ? Les mesures concernées n'auront plus de valeur.`, { danger: true, ok: "Supprimer" }))
      await deleteCalibration(c.id);
  };

  const card = (c: Calibration) => (
    <div key={c.id} className={`cal-item ${c.zone ? "zone" : "page"}`}>
      <div className="row between">
        <b>{c.zone ? c.nom ?? "Zone" : "Page entière"}</b>
        <span className="badge mono">1/{Math.round(ratioFromMpp(c.metres_par_point)).toLocaleString("fr-FR")}</span>
      </div>
      <div className="small muted">{METHODES[c.methode] ?? c.methode}{c.longueur_reelle_m ? ` · référence ${formatLength(c.longueur_reelle_m)}` : ""}</div>
      <div className="row wrap" style={{ gap: 4 }}>
        {ecartBadge(c)}
        {c.controle_attendu_m != null && <span className="small muted mono">{formatLength(c.controle_mesure_m)} / {formatLength(c.controle_attendu_m)}</span>}
      </div>
      <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
        <button className="btn sm" onClick={() => start({ kind: "control", calId: c.id }, "control")}><Icon name="check" size={13} />Contrôler</button>
        <button className="btn sm" onClick={() => start({ kind: "recal", calId: c.id }, "calib")}><Icon name="target" size={13} />2 points</button>
        <button className="btn sm" onClick={() => { setFlow(null); setTool("select"); setRatioFor({ calId: c.id, zone: c.zone, nom: c.nom }); setRatio(c.ratio ? `1/${c.ratio}` : "1/100"); }}>1/…</button>
        <span className="grow" />
        <button className="btn sm ghost icon danger" title="Supprimer" onClick={() => remove(c)}><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );

  const picked = flow?.picked;
  const lengthForm = (title: string, help: string, onOk: () => void) => (
    <div className="callout" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <b>{title}</b>
      <span className="small">{help}</span>
      <Field label="Longueur réelle (m)">
        <input className="input num" autoFocus value={len} placeholder="ex. 12,40" onChange={(e) => setLen(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onOk()} />
      </Field>
      <div className="row end">
        <button className="btn" onClick={() => setFlow(null)}>Annuler</button>
        <button className="btn primary" onClick={onOk}>Valider</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="panel-head">
        <Icon name="target" /><b className="grow">Échelle et zones d'étalonnage</b>
        <button className="btn ghost icon sm" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="panel-body">
        <div className="small muted">Page : <b>{paperFormat(dims.w, dims.h)}</b> · indice {version.indice}</div>

        {/* étapes en cours */}
        {flow && !picked && (
          <div className="callout warn">
            {flow.kind === "zone" ? "Tracez le cadre de la vue sur le plan (deux coins opposés)." :
              flow.kind === "control" ? "Cliquez les deux extrémités d'une deuxième cote connue." :
                "Cliquez les deux extrémités de la cote de référence. Choisissez la plus grande cote connue : l'erreur de clic pèse moins."}
            <div className="row end" style={{ marginTop: 6 }}><button className="btn sm" onClick={() => { setFlow(null); setTool("select"); }}>Annuler</button></div>
          </div>
        )}
        {flow && picked && (flow.kind === "page2pts" || flow.kind === "zone2pts" || flow.kind === "recal") &&
          lengthForm("Longueur de la cote de référence", `Distance sur le plan : ${distRel(picked[0], picked[1], dims).toFixed(1)} pt`, save2pts)}
        {flow?.kind === "control" && picked &&
          lengthForm("Mesure de contrôle", `Mesuré : ${formatLength(distRel(picked[0], picked[1], dims) * (cals.find((c) => c.id === flow.calId)?.metres_par_point ?? 0))}. Saisissez la cote attendue.`, saveControl)}
        {flow?.kind === "zone" && picked && (
          <div className="callout" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <b>Nouvelle zone</b>
            <Field label="Nom de la zone"><input className="input" autoFocus value={zoneNom} placeholder="Détail 1/20, Coupe AA…" onChange={(e) => setZoneNom(e.target.value)} /></Field>
            <div className="row wrap">
              <button className="btn" onClick={() => start({ kind: "zone2pts", rect: normRect({ x0: picked[0].x, y0: picked[0].y, x1: picked[1].x, y1: picked[1].y }), nom: zoneNom || "Zone" }, "calib")}>
                <Icon name="target" />Étalonner sur 2 points
              </button>
              <button className="btn" onClick={() => { setRatioFor({ zone: normRect({ x0: picked[0].x, y0: picked[0].y, x1: picked[1].x, y1: picked[1].y }), nom: zoneNom || "Zone" }); setFlow(null); }}>Saisir l'échelle</button>
              <button className="btn ghost" onClick={() => setFlow(null)}>Annuler</button>
            </div>
          </div>
        )}
        {ratioFor && (
          <div className="callout" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <b>Échelle {ratioFor.zone ? `de la zone « ${ratioFor.nom} »` : "de la page"}</b>
            <span className="small">Fiable seulement si le PDF est au format papier réel (export ArchiCAD de la mise en page à 100 %).</span>
            <Field label="Échelle"><input className="input num" autoFocus value={ratio} onChange={(e) => setRatio(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRatio()} /></Field>
            <div className="row end"><button className="btn" onClick={() => setRatioFor(null)}>Annuler</button><button className="btn primary" onClick={saveRatio}>Valider</button></div>
          </div>
        )}

        <div className="section-title" style={{ marginTop: 6 }}>Page entière</div>
        {page ? card(page) : (
          <div className="col">
            <div className="small muted">Aucune échelle de page. Les mesures hors zones sont impossibles.</div>
            <div className="row wrap">
              <button className="btn primary" onClick={() => start({ kind: "page2pts" }, "calib")}><Icon name="target" />Étalonner sur 2 points</button>
              <button className="btn" onClick={() => { setFlow(null); setRatioFor({ zone: null, nom: "Page" }); }}>Saisir l'échelle</button>
            </div>
          </div>
        )}

        <div className="section-title">Zones ({zones.length})</div>
        <div className="small muted">Pour les vues à une autre échelle sur la même page (détail au 1/20, coupe…). La plus petite zone contenant le point s'applique.</div>
        <div className="cal-list">{zones.map(card)}</div>
        <div><button className="btn" onClick={() => { setZoneNom(""); start({ kind: "zone" }, "zone"); }}><Icon name="zone" />Nouvelle zone</button></div>

        <div className="section-title">Conseils</div>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Les PDF ArchiCAD exportés depuis une mise en page à 100 % gardent l'échelle papier : la saisie « 1/100 » suffit, à confirmer par un contrôle.</li>
          <li>L'accrochage (aimant) place les clics exactement sur les extrémités des traits du plan.</li>
          <li>Un écart de contrôle supérieur à 2 % indique un PDF redimensionné ou une erreur de cote.</li>
        </ul>
      </div>
    </>
  );
}
