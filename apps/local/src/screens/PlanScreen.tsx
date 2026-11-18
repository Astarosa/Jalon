import { useCallback, useEffect, useMemo, useState } from "react";
import {
  STATUTS, STATUT_LIST, TICKET_TYPES, calibrationAt, measure, formatMeasure, formatLength, calibrateTwoPoints, distRel,
  ratioFromMpp, isEnRetard, type Pt, type Rect, type Statut, type SnapIndex, type MeasureType,
} from "@chantier/core";
import { Icon, PlanViewer, Progress, StatusBadge, useUi, type Tool, type ViewerMeasure, type ViewerPin, type ViewerZone, type ViewerLine } from "@chantier/ui";
import {
  createTicket, getPlan, getPlanVersion, listAssignments, listCalibrations, listLots, listMeasurements, listPlans,
  listTickets, saveMeasurement, updateTicket, getProject, type Calibration, type MeasurementP,
} from "../data/repo";
import { useData } from "../data/useData";
import { useApp } from "../nav";
import { platform } from "../platform";
import { ensureTiles, snapIndexFor, type TileMeta } from "../pdf/pdf";
import { Topbar } from "../components/Topbar";
import { TicketPanel } from "./TicketPanel";
import { CalibrationPanel, type CalFlow } from "./CalibrationPanel";
import { MeasurePanel } from "./MeasurePanel";
import { MigrationPanel } from "./MigrationPanel";

type Panel = { kind: "ticket"; id: string } | { kind: "measure"; id: string } | { kind: "calib" } | { kind: "migrate" } | null;

export function PlanScreen({ projectId, planId, versionId, ticketId }: { projectId: string; planId: string; versionId: string; ticketId?: string }) {
  const { go, visitFor } = useApp();
  const ui = useUi();
  const visitId = visitFor(projectId);
  const project = useData(() => getProject(projectId), [projectId]);
  const plan = useData(() => getPlan(planId), [planId]);
  const version = useData(() => getPlanVersion(versionId), [versionId]);
  const allPlans = useData(() => listPlans(projectId), [projectId]);
  const versions = allPlans?.find((p) => p.plan.id === planId)?.versions ?? [];
  const lots = useData(() => listLots(projectId), [projectId]);
  const assignments = useData(() => listAssignments(projectId), [projectId]);
  const cals = useData(() => listCalibrations(versionId), [versionId]);
  const measures = useData(() => listMeasurements(versionId), [versionId]);

  const [meta, setMeta] = useState<TileMeta | null>(null);
  const [prep, setPrep] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [panel, setPanel] = useState<Panel>(ticketId ? { kind: "ticket", id: ticketId } : null);
  const [focus, setFocus] = useState<{ x: number; y: number; key: number } | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [snapIdx, setSnapIdx] = useState<SnapIndex | null>(null);
  const [showZones, setShowZones] = useState(true);
  const [showMeasures, setShowMeasures] = useState(true);
  const [colorBy, setColorBy] = useState<"statut" | "lot">("statut");
  const [listTab, setListTab] = useState<"points" | "mesures">("points");
  const [filter, setFilter] = useState<{ statuts: Statut[]; lot: string; texte: string }>({ statuts: [], lot: "", texte: "" });
  const [calFlow, setCalFlow] = useState<CalFlow | null>(null);
  const [pickHandler, setPickHandler] = useState<((pts: Pt[]) => void) | null>(null);
  const [viewOverride, setViewOverride] = useState<string | null>(null);
  const [overrideMeta, setOverrideMeta] = useState<{ meta: TileMeta; w: number; h: number; snap: SnapIndex | null } | null>(null);

  const tickets = useData(() => listTickets({ projectId, planVersionId: versionId }), [projectId, versionId]);

  // tuiles (régénérées si absentes, ex. après restauration)
  useEffect(() => {
    if (!version) return;
    let alive = true;
    ensureTiles(version.id, version.file_sha256, version.page_index, (d, t) => alive && setPrep(d / t))
      .then((m) => alive && (setMeta(m), setPrep(null)))
      .catch((e) => ui.toast(`Affichage du plan impossible : ${e}`, "error"));
    return () => {
      alive = false;
    };
  }, [version?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // vue temporaire d'un autre indice (recalage)
  useEffect(() => {
    if (!viewOverride) return setOverrideMeta(null);
    getPlanVersion(viewOverride).then(async (v) => {
      if (!v) return;
      const m = await ensureTiles(v.id, v.file_sha256, v.page_index);
      const si = await snapIndexFor(v.file_sha256, v.page_index).catch(() => null);
      setOverrideMeta({ meta: m, w: v.largeur_pt, h: v.hauteur_pt, snap: si });
    });
  }, [viewOverride]);

  // accrochage
  useEffect(() => {
    if (!version || !snapOn) return;
    let alive = true;
    snapIndexFor(version.file_sha256, version.page_index).then((i) => alive && setSnapIdx(i)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [version?.id, snapOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ouverture d'un point depuis la liste
  useEffect(() => {
    if (!ticketId || !tickets) return;
    const t = tickets.find((x) => x.id === ticketId);
    if (t?.x != null && t.y != null) setFocus({ x: t.x, y: t.y, key: Date.now() });
  }, [ticketId, !!tickets]); // eslint-disable-line react-hooks/exhaustive-deps

  const dims = version ? { w: version.largeur_pt, h: version.hauteur_pt } : { w: 1, h: 1 };
  const calsList = useMemo(() => cals ?? [], [cals]);
  const lotById = useMemo(() => Object.fromEntries((lots ?? []).map((l) => [l.id, l])), [lots]);

  const filtered = useMemo(() => (tickets ?? []).filter((t) =>
    (!filter.statuts.length || filter.statuts.includes(t.statut as Statut)) &&
    (!filter.lot || t.lot_id === filter.lot) &&
    (!filter.texte || `${t.numero} ${t.titre} ${t.localisation ?? ""}`.toLowerCase().includes(filter.texte.toLowerCase()))), [tickets, filter]);

  const selTicket = panel?.kind === "ticket" ? panel.id : null;
  const selMeasure = panel?.kind === "measure" ? panel.id : null;

  const pins: ViewerPin[] = useMemo(() => filtered.filter((t) => t.x != null && t.y != null).map((t) => ({
    id: t.id, x: t.x!, y: t.y!, label: String(t.numero),
    color: colorBy === "lot" ? lotById[t.lot_id ?? ""]?.couleur ?? "#6b7480" : STATUTS[t.statut as Statut]?.couleur ?? "#666",
    selected: t.id === selTicket, title: `#${t.numero} ${t.titre}`,
  })), [filtered, colorBy, lotById, selTicket]);

  const mLabel = useCallback((m: MeasurementP) => {
    const r = measure(m.type as MeasureType, m.pts, dims, calsList);
    return `${m.libelle ? m.libelle + " : " : ""}${formatMeasure(m.type as MeasureType, r)}${r.zonesMelangees ? " ⚠" : ""}`;
  }, [dims.w, dims.h, calsList]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewerMeasures: ViewerMeasure[] = useMemo(() => !showMeasures ? [] : (measures ?? []).map((m) => ({
    id: m.id, type: m.type as MeasureType, pts: m.pts, label: mLabel(m), color: m.couleur ?? undefined, selected: m.id === selMeasure,
  })), [measures, showMeasures, mLabel, selMeasure]);

  const zones: ViewerZone[] = useMemo(() => !showZones ? [] : calsList.filter((c) => c.zone).map((c) => ({
    id: c.id, rect: c.zone as Rect, label: `${c.nom ?? "Zone"} · 1/${Math.round(ratioFromMpp(c.metres_par_point))}`,
    selected: calFlow?.kind === "control" && calFlow.calId === c.id,
  })), [calsList, showZones, calFlow]);

  const lines: ViewerLine[] = useMemo(() => panel?.kind !== "calib" ? [] : calsList.filter((c) => c.methode === "deux_points" && c.p1x != null).map((c) => ({
    id: c.id, a: { x: c.p1x!, y: c.p1y! }, b: { x: c.p2x!, y: c.p2y! }, label: `réf. ${formatLength(c.longueur_reelle_m)}`,
  })), [calsList, panel]);

  const mppAt = useCallback((p: Pt) => calibrationAt(p, calsList)?.metres_par_point, [calsList]);
  const snap = useMemo(() => (snapOn && snapIdx ? (p: Pt, r: number) => snapIdx.nearest(p.x, p.y, r) : null), [snapOn, snapIdx]);

  const liveLabel = useCallback((t: Tool, pts: Pt[]) => {
    if (t === "distance" || t === "polyligne" || t === "surface") {
      const r = measure(t, pts, dims, calsList);
      if (r.valeur == null) return r.calibration ? null : "Plan non étalonné";
      return formatMeasure(t, r) + (r.zonesMelangees ? " ⚠ zones" : "");
    }
    if (t === "control" && calFlow?.kind === "control" && pts.length >= 2) {
      const c = calsList.find((x) => x.id === calFlow.calId);
      return c ? formatLength(distRel(pts[0], pts[1], dims) * c.metres_par_point) : null;
    }
    if (t === "calib" && pts.length >= 2) return `${distRel(pts[0], pts[1], dims).toFixed(1)} pt`;
    return null;
  }, [dims.w, dims.h, calsList, calFlow]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastDefaults = () => {
    const last = [...(tickets ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return { lot_id: last?.lot_id ?? null, company_id: last?.company_id ?? null, type: last?.type ?? "reserve" };
  };

  const onPick = async (t: Tool, pts: Pt[]) => {
    if (t === "pin") {
      const id = await createTicket({ project_id: projectId, titre: "Nouveau point", plan_version_id: versionId, x: pts[0].x, y: pts[0].y, ...lastDefaults() }, visitId);
      setTool("select");
      setPanel({ kind: "ticket", id });
    } else if (t === "distance" || t === "polyligne" || t === "surface") {
      const id = await saveMeasurement({ plan_version_id: versionId, type: t, pts });
      setPanel({ kind: "measure", id });
      setListTab("mesures");
    } else if (t === "calib" || t === "zone" || t === "control") {
      setCalFlow((f) => (f ? { ...f, picked: pts } : f));
      setTool("select");
    } else if (t === "pick2") {
      pickHandler?.(pts);
      setTool("select");
    }
  };

  const openTicket = (id: string) => {
    setPanel({ kind: "ticket", id });
    const t = tickets?.find((x) => x.id === id);
    if (t?.x != null && t.y != null) setFocus({ x: t.x, y: t.y, key: Date.now() });
  };

  const hints: Partial<Record<Tool, React.ReactNode>> = {
    pin: <>Cliquez sur le plan pour placer un point · <kbd>Échap</kbd> annuler</>,
    distance: <>Cliquez deux points · <kbd>Échap</kbd> annuler</>,
    polyligne: <>Cliquez les sommets · double-clic ou <kbd>Entrée</kbd> pour terminer · <kbd>⌫</kbd> dernier point</>,
    surface: <>Cliquez le contour · double-clic ou <kbd>Entrée</kbd> pour fermer · <kbd>⌫</kbd> dernier point</>,
    calib: <>Cliquez les deux extrémités d'une cote connue (la plus longue possible) · loupe et accrochage actifs</>,
    control: <>Cliquez les deux extrémités d'une seconde cote connue</>,
    zone: <>Cliquez deux coins opposés du cadre de la vue à étalonner</>,
    pick2: <>Cliquez deux points de repère bien identifiables (angles de murs, axes)</>,
  };

  const versionsSorted = [...versions].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const prevVersions = versionsSorted.filter((v) => v.id !== versionId && v.created_at < (version?.created_at ?? ""));
  const pendingOnOld = useData(async () => {
    let n = 0;
    for (const v of prevVersions) n += (await listTickets({ projectId, planVersionId: v.id, statuts: ["ouvert", "transmis", "leve"] })).length;
    return n;
  }, [versionId, versions.length, tickets?.length]);

  const curCal = calibrationAt({ x: 0.5, y: 0.5 }, calsList);
  const shownMeta = overrideMeta?.meta ?? meta;
  const shownDims = overrideMeta ? { w: overrideMeta.w, h: overrideMeta.h } : dims;
  const shownPvid = viewOverride ?? versionId;

  const toolBtn = (t: Tool, icon: string, label: string, accent = false) => (
    <button className={`tool-btn ${accent ? "accent" : ""} ${tool === t ? "on" : ""}`} title={label} onClick={() => setTool(tool === t ? "select" : t)}>
      <Icon name={icon} />{accent && <span>{label}</span>}
    </button>
  );

  return (
    <>
      <Topbar crumbs={[
        { label: "Chantiers", onClick: () => go({ view: "home" }) },
        { label: project?.nom ?? "…", onClick: () => go({ view: "project", projectId, tab: "plans" }) },
        { label: `${plan?.nom ?? "…"}${plan?.niveau ? ` · ${plan.niveau}` : ""}` },
      ]}>
        <button className={`btn ${panel?.kind === "calib" ? "on" : ""}`} onClick={() => setPanel(panel?.kind === "calib" ? null : { kind: "calib" })}>
          <Icon name="target" />Échelle et zones
        </button>
      </Topbar>
      <div className="page flush">
        <div className={`viewer ${panel ? "with-panel" : ""}`}>
          {/* ------------------------------------------------ liste */}
          <div className="viewer-list">
            <div className="head">
              <div className="btn-group" style={{ width: "100%" }}>
                <button className={`btn sm grow ${listTab === "points" ? "on" : ""}`} onClick={() => setListTab("points")}>Points ({filtered.length})</button>
                <button className={`btn sm grow ${listTab === "mesures" ? "on" : ""}`} onClick={() => setListTab("mesures")}>Mesures ({measures?.length ?? 0})</button>
              </div>
              {listTab === "points" && (
                <>
                  <input className="input" placeholder="Rechercher n°, titre, local…" value={filter.texte} onChange={(e) => setFilter({ ...filter, texte: e.target.value })} />
                  <div className="row wrap" style={{ gap: 4 }}>
                    {STATUT_LIST.map((s) => {
                      const on = filter.statuts.includes(s);
                      return (
                        <button key={s} className="badge" style={{ border: 0, cursor: "pointer", background: on ? STATUTS[s].couleur : "var(--paper-2)", color: on ? "#fff" : "var(--ink-2)" }}
                          onClick={() => setFilter({ ...filter, statuts: on ? filter.statuts.filter((x) => x !== s) : [...filter.statuts, s] })}>
                          {STATUTS[s].label.split(" ")[0]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="row">
                    <select className="select" value={filter.lot} onChange={(e) => setFilter({ ...filter, lot: e.target.value })}>
                      <option value="">Tous les lots</option>
                      {lots?.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
                    </select>
                    <select className="select" style={{ width: 150, flex: "none" }} value={colorBy} onChange={(e) => setColorBy(e.target.value as "statut" | "lot")} title="Couleur des épingles">
                      <option value="statut">Couleur : statut</option>
                      <option value="lot">Couleur : lot</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="items">
              {listTab === "points" && filtered.map((t) => (
                <div key={t.id} className={`pin-row ${t.id === selTicket ? "sel" : ""}`} onClick={() => openTicket(t.id)}>
                  <span className="numero" style={{ minWidth: 34 }}>#{t.numero}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 500 }}>{t.titre}</div>
                    <div className="row small muted" style={{ gap: 6 }}>
                      <span className="lot-chip"><i style={{ background: lotById[t.lot_id ?? ""]?.couleur ?? "#ccc" }} />{lotById[t.lot_id ?? ""]?.nom ?? "Sans lot"}</span>
                      {isEnRetard(t) && <span className="badge danger">Retard</span>}
                    </div>
                  </div>
                  <span className="dot" style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, background: STATUTS[t.statut as Statut]?.couleur }} title={STATUTS[t.statut as Statut]?.label} />
                </div>
              ))}
              {listTab === "points" && tickets && !filtered.length && <div className="empty small"><div>Aucun point. Utilisez l'outil <b>Point</b> pour en placer.</div></div>}
              {listTab === "mesures" && measures?.map((m) => (
                <div key={m.id} className={`pin-row ${m.id === selMeasure ? "sel" : ""}`} onClick={() => setPanel({ kind: "measure", id: m.id })}>
                  <Icon name={m.type === "surface" ? "area" : m.type === "polyligne" ? "polyline" : "ruler"} />
                  <div className="grow"><div className="ellipsis">{m.libelle || (m.type === "surface" ? "Surface" : m.type === "polyligne" ? "Longueur" : "Distance")}</div>
                    <div className="mono small">{formatMeasure(m.type as MeasureType, measure(m.type as MeasureType, m.pts, dims, calsList))}</div></div>
                </div>
              ))}
              {listTab === "mesures" && measures && !measures.length && <div className="empty small"><div>Aucune mesure enregistrée.</div></div>}
            </div>
          </div>

          {/* ------------------------------------------------ plan */}
          <div className={`viewer-map ${tool !== "select" ? "tool" : ""}`}>
            {shownMeta && version ? (
              <PlanViewer key={shownPvid}
                dims={shownDims} tiles={shownMeta} tileUrl={(z, x, y) => platform.tileUrl(shownPvid, z, x, y, shownMeta.rev)}
                pins={viewOverride ? [] : pins} measures={viewOverride ? [] : viewerMeasures} zones={viewOverride ? [] : zones} lines={viewOverride ? [] : lines}
                tool={tool} snap={viewOverride ? (snapOn && overrideMeta?.snap ? (p: Pt, r: number) => overrideMeta.snap!.nearest(p.x, p.y, r) : null) : snap} mppAt={mppAt} liveLabel={liveLabel}
                onPick={onPick} onCancelTool={() => { setTool("select"); setCalFlow(null); }}
                onPinClick={(id) => setPanel({ kind: "ticket", id })} draggablePins
                onPinDrag={(id, p) => updateTicket(id, { x: p.x, y: p.y }, visitId)}
                onMeasureClick={(id) => { setPanel({ kind: "measure", id }); setListTab("mesures"); }}
                onZoneClick={() => setPanel({ kind: "calib" })}
                focus={focus}
              />
            ) : (
              <div className="empty" style={{ position: "absolute", inset: 0, justifyContent: "center" }}>
                <b>Préparation du plan…</b>
                <div style={{ width: 260 }}><Progress value={prep ?? 0} /></div>
              </div>
            )}
            {!viewOverride && (
              <div className="toolbar">
                {toolBtn("select", "cursor", "Sélection")}
                <div className="sep" />
                {toolBtn("pin", "pin", "Point", true)}
                <div className="sep" />
                {toolBtn("distance", "ruler", "Distance")}
                {toolBtn("polyligne", "polyline", "Longueur cumulée")}
                {toolBtn("surface", "area", "Surface")}
                <div className="sep" />
                <button className={`tool-btn ${snapOn ? "on" : ""}`} title={`Accrochage aux traits du plan${snapIdx ? ` (${snapIdx.size.toLocaleString("fr-FR")} points)` : ""}`} onClick={() => setSnapOn(!snapOn)}><Icon name="magnet" /></button>
                <button className={`tool-btn ${showZones ? "on" : ""}`} title="Afficher les zones d'étalonnage" onClick={() => setShowZones(!showZones)}><Icon name="zone" /></button>
                <button className={`tool-btn ${showMeasures ? "on" : ""}`} title="Afficher les mesures" onClick={() => setShowMeasures(!showMeasures)}><Icon name="ruler" /></button>
              </div>
            )}
            {tool !== "select" && hints[tool] && <div className="tool-hint">{hints[tool]}</div>}
            {viewOverride && <div className="tool-hint" style={{ bottom: "auto", top: 14, background: "var(--blue)" }}>Affichage de l'indice précédent pour le recalage</div>}
            <div className="version-switch">
              {versionsSorted.length > 1 && !viewOverride && (
                <select className="select" style={{ width: "auto", boxShadow: "var(--shadow)" }} value={versionId}
                  onChange={(e) => go({ view: "plan", projectId, planId, versionId: e.target.value })}>
                  {versionsSorted.map((v) => <option key={v.id} value={v.id}>Indice {v.indice}{v.courant ? " (en cours)" : ""}</option>)}
                </select>
              )}
              {!!pendingOnOld && !viewOverride && (
                <button className="btn" style={{ boxShadow: "var(--shadow)", background: "var(--accent-soft)", borderColor: "var(--accent)" }} onClick={() => setPanel({ kind: "migrate" })}>
                  <Icon name="migrate" />{pendingOnOld} point(s) ouvert(s) sur l'indice précédent
                </button>
              )}
            </div>
            {!viewOverride && (
              <div className="scale-badge">
                <button className="btn" style={{ boxShadow: "var(--shadow)" }} onClick={() => setPanel({ kind: "calib" })}>
                  {curCal ? <><span className="badge ok">1/{Math.round(ratioFromMpp(curCal.metres_par_point))}</span>{calsList.some((c) => c.zone) && <span className="small muted">+{calsList.filter((c) => c.zone).length} zone(s)</span>}</>
                    : calsList.length ? <span className="badge blue">{calsList.length} zone(s) étalonnée(s)</span> : <span className="badge warn">Non étalonné</span>}
                </button>
              </div>
            )}
          </div>

          {/* ------------------------------------------------ panneau */}
          {panel && (
            <div className="viewer-panel">
              {panel.kind === "ticket" && (
                <TicketPanel key={panel.id} ticketId={panel.id} projectId={projectId} onClose={() => setPanel(null)} dims={dims} cals={calsList}
                  onRelocate={() => ui.toast("Faites glisser l'épingle sélectionnée sur le plan pour la déplacer")} />
              )}
              {panel.kind === "measure" && (
                <MeasurePanel key={panel.id} id={panel.id} measures={measures ?? []} dims={dims} cals={calsList} tickets={tickets ?? []} onClose={() => setPanel(null)} />
              )}
              {panel.kind === "calib" && version && (
                <CalibrationPanel version={version} cals={calsList} flow={calFlow} setFlow={setCalFlow} setTool={setTool} onClose={() => { setPanel(null); setCalFlow(null); setTool("select"); }} />
              )}
              {panel.kind === "migrate" && version && (
                <MigrationPanel projectId={projectId} target={version} previous={prevVersions}
                  startPick={(handler) => { setPickHandler(() => handler); setTool("pick2"); }}
                  showVersion={setViewOverride} onClose={() => { setPanel(null); setViewOverride(null); setTool("select"); }} />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
