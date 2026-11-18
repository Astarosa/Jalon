/**
 * Visionneuse de plan : tuiles + épingles + mesures + zones d'étalonnage + outils de saisie.
 * Repère Leaflet `CRS.Simple` où 1 unité = 1 point PDF (lat = -y, lng = x).
 * Toutes les coordonnées échangées avec l'extérieur sont relatives (0..1).
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import { niceScaleBar, type Dims, type Pt, type Rect } from "@chantier/core";

export type Tool = "select" | "pin" | "distance" | "polyligne" | "surface" | "calib" | "control" | "zone" | "pick2";

export interface ViewerPin { id: string; x: number; y: number; label: string; color: string; selected?: boolean; dim?: boolean; title?: string }
export interface ViewerMeasure { id: string; type: "distance" | "polyligne" | "surface"; pts: Pt[]; label: string; color?: string; selected?: boolean }
export interface ViewerZone { id: string; rect: Rect; label: string; selected?: boolean }
export interface ViewerLine { id: string; a: Pt; b: Pt; label: string; color?: string }

export interface PlanViewerProps {
  dims: Dims;
  tiles: { zMin: number; zMax: number; tile: number };
  tileUrl: (z: number, x: number, y: number) => string;
  pins?: ViewerPin[];
  measures?: ViewerMeasure[];
  zones?: ViewerZone[];
  lines?: ViewerLine[];
  marks?: Pt[];
  tool: Tool;
  /** Accrochage : point (en points PDF) le plus proche dans le rayon donné, ou null */
  snap?: ((p: Pt, radius: number) => Pt | null) | null;
  /** Mètres par point au point relatif donné (barre d'échelle) */
  mppAt?: (p: Pt) => number | undefined;
  /** Libellé affiché pendant le tracé */
  liveLabel?: (tool: Tool, pts: Pt[]) => string | null;
  onPick?: (tool: Tool, pts: Pt[]) => void;
  onCancelTool?: () => void;
  onPinClick?: (id: string) => void;
  onPinDrag?: (id: string, p: Pt) => void;
  draggablePins?: boolean;
  onMeasureClick?: (id: string) => void;
  onZoneClick?: (id: string) => void;
  onBackgroundClick?: () => void;
  focus?: { x: number; y: number; key: number } | null;
}

const NEEDED: Partial<Record<Tool, number>> = { pin: 1, distance: 2, calib: 2, control: 2, zone: 2, pick2: 2 };

function pinHtml(p: ViewerPin) {
  const small = p.label.length > 3 ? "small" : "";
  return `<div class="pin ${p.selected ? "sel" : ""} ${p.dim ? "dim" : ""} ${small}" title="${(p.title ?? "").replace(/"/g, "&quot;")}">
    <svg viewBox="0 0 30 38"><path d="M15 37C15 37 28 24 28 14A13 13 0 0 0 2 14C2 24 15 37 15 37Z" fill="${p.color}" stroke="#fff" stroke-width="2"/></svg>
    <span>${p.label}</span></div>`;
}

export function PlanViewer(props: PlanViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const loupeHost = useRef<HTMLDivElement>(null);
  const scaleHost = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const pr = useRef(props);
  pr.current = props;
  const st = useRef<{
    map: L.Map; loupe: L.Map; pins: L.LayerGroup; meas: L.LayerGroup; zones: L.LayerGroup; lines: L.LayerGroup;
    draw: L.LayerGroup; snapMark: L.Marker; drawing: L.LatLng[]; cursor: L.LatLng | null; live: L.Tooltip;
  } | null>(null);

  const { w, h } = props.dims;
  const toLL = (p: Pt) => L.latLng(-p.y * h, p.x * w);
  const toRel = (ll: L.LatLng): Pt => ({ x: ll.lng / w, y: -ll.lat / h });

  // ------------------------------------------------------------- création
  useEffect(() => {
    const { tiles, tileUrl } = pr.current;
    const bounds = L.latLngBounds([-h, 0], [0, w]);
    const TL = L.TileLayer.extend({
      getTileUrl(c: L.Coords) {
        return pr.current.tileUrl(c.z, c.x, c.y);
      },
    }) as unknown as new (url: string, o: L.TileLayerOptions) => L.TileLayer;
    const tileOpts: L.TileLayerOptions = {
      tileSize: tiles.tile, minNativeZoom: tiles.zMin, maxNativeZoom: tiles.zMax,
      minZoom: tiles.zMin - 2, maxZoom: tiles.zMax + 3, bounds, noWrap: true, keepBuffer: 3,
    };
    void tileUrl;
    const map = L.map(host.current!, {
      crs: L.CRS.Simple, minZoom: tiles.zMin - 1, maxZoom: tiles.zMax + 3, zoomSnap: 0.25, zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90, attributionControl: false, zoomControl: false, doubleClickZoom: false, boxZoom: false,
      maxBounds: bounds.pad(0.4), maxBoundsViscosity: 0.6, inertia: true,
    });
    new TL("", tileOpts).addTo(map);
    L.rectangle(bounds, { color: "#8c959e", weight: 1, fill: false, interactive: false }).addTo(map);
    map.fitBounds(bounds, { padding: [20, 20] });
    L.control.zoom({ position: "bottomright", zoomInTitle: "Zoom avant", zoomOutTitle: "Zoom arrière" }).addTo(map);

    const loupe = L.map(loupeHost.current!, {
      crs: L.CRS.Simple, minZoom: tiles.zMin - 2, maxZoom: tiles.zMax + 5, zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
      fadeAnimation: false, zoomAnimation: false,
    });
    new TL("", { ...tileOpts, maxZoom: tiles.zMax + 5, keepBuffer: 1 }).addTo(loupe);
    loupe.setView([-h / 2, w / 2], tiles.zMin);

    const snapMark = L.marker([0, 0], { icon: L.divIcon({ className: "snap-mark", iconSize: [12, 12] }), interactive: false, keyboard: false });
    const live = L.tooltip({ permanent: true, direction: "right", offset: [14, 0], className: "measure-label" });
    const s = {
      map, loupe, snapMark, live, drawing: [] as L.LatLng[], cursor: null as L.LatLng | null,
      zones: L.layerGroup().addTo(map), meas: L.layerGroup().addTo(map), lines: L.layerGroup().addTo(map),
      pins: L.layerGroup().addTo(map), draw: L.layerGroup().addTo(map),
    };
    st.current = s;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((import.meta as any).env?.DEV) (window as any).__planMap = map;

    const snapped = (ll: L.LatLng): { ll: L.LatLng; snapped: boolean } => {
      const fn = pr.current.snap;
      if (!fn || pr.current.tool === "select") return { ll, snapped: false };
      const r = 10 / 2 ** map.getZoom();
      const q = fn({ x: ll.lng, y: -ll.lat }, r);
      return q ? { ll: L.latLng(-q.y, q.x), snapped: true } : { ll, snapped: false };
    };

    const redrawDraft = () => {
      s.draw.clearLayers();
      const tool = pr.current.tool;
      const pts = s.cursor ? [...s.drawing, s.cursor] : [...s.drawing];
      if (!pts.length || tool === "select" || tool === "pin") return;
      const color = tool === "calib" || tool === "control" ? "#e8590c" : tool === "zone" ? "#1e5aa8" : "#e8590c";
      if (tool === "zone" && pts.length >= 2) {
        L.rectangle(L.latLngBounds(pts[0], pts[1]), { color, weight: 2, dashArray: "6 4", fillOpacity: 0.08, interactive: false }).addTo(s.draw);
      } else if (tool === "surface" && pts.length >= 2) {
        L.polygon(pts, { color, weight: 2, fillOpacity: 0.15, interactive: false }).addTo(s.draw);
      } else if (pts.length >= 2) {
        L.polyline(pts, { color, weight: 2, dashArray: tool === "calib" ? "8 5" : undefined, interactive: false }).addTo(s.draw);
      }
      s.drawing.forEach((p) => L.marker(p, { icon: L.divIcon({ className: "draw-vertex", iconSize: [8, 8] }), interactive: false }).addTo(s.draw));
      const lbl = pr.current.liveLabel?.(tool, pts.map(toRel));
      if (lbl && s.cursor) s.live.setLatLng(s.cursor).setContent(lbl).addTo(s.draw);
    };

    const finish = () => {
      const tool = pr.current.tool;
      const pts = s.drawing.map(toRel);
      s.drawing = [];
      redrawDraft();
      if (pts.length) pr.current.onPick?.(tool, pts);
    };

    map.on("click", (e: L.LeafletMouseEvent) => {
      const tool = pr.current.tool;
      if (tool === "select") {
        pr.current.onBackgroundClick?.();
        return;
      }
      const { ll } = snapped(e.latlng);
      const last = s.drawing[s.drawing.length - 1];
      if (last && map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(ll)) < 3) return;
      s.drawing.push(ll);
      const need = NEEDED[tool];
      if (need && s.drawing.length >= need) finish();
      else redrawDraft();
    });
    map.on("dblclick", () => {
      const tool = pr.current.tool;
      if ((tool === "polyligne" && s.drawing.length >= 2) || (tool === "surface" && s.drawing.length >= 3)) finish();
    });

    const updateLoupe = (ll: L.LatLng, cp: L.Point) => {
      const el = loupeHost.current!;
      const show = pr.current.tool !== "select";
      el.style.display = show ? "block" : "none";
      if (!show) return;
      const size = map.getSize();
      const x = cp.x + 190 > size.x ? cp.x - 190 : cp.x + 22;
      const y = cp.y + 190 > size.y ? cp.y - 190 : cp.y + 22;
      el.style.transform = `translate(${x}px, ${y}px)`;
      loupe.setView(ll, Math.min(map.getZoom() + 2, pr.current.tiles.zMax + 4), { animate: false });
    };

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      const tool = pr.current.tool;
      if (tool === "select") return;
      const r = snapped(e.latlng);
      s.cursor = r.ll;
      if (r.snapped) s.snapMark.setLatLng(r.ll).addTo(map);
      else s.snapMark.remove();
      updateLoupe(r.ll, map.latLngToContainerPoint(r.ll));
      redrawDraft();
    });
    map.on("mouseout", () => {
      loupeHost.current!.style.display = "none";
      s.cursor = null;
      s.snapMark.remove();
      redrawDraft();
    });

    const updateScale = () => {
      const el = scaleHost.current!;
      const c = map.getCenter();
      const mpp = pr.current.mppAt?.(toRel(c));
      if (!mpp) {
        el.className = "scalebar none";
        el.innerHTML = "Échelle non définie";
        return;
      }
      const mPerPx = mpp / 2 ** map.getZoom();
      const b = niceScaleBar(mPerPx, 140);
      const label = b.metres >= 1 ? `${b.metres} m` : `${Math.round(b.metres * 100)} cm`;
      el.className = "scalebar";
      el.innerHTML = `${label}<div class="bar" style="width:${b.px.toFixed(1)}px"></div>`;
    };
    map.on("zoomend moveend", updateScale);
    (s as unknown as { updateScale: () => void }).updateScale = updateScale;
    updateScale();

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (pr.current.tool === "select") return;
      if (e.key === "Escape") {
        if (s.drawing.length) {
          s.drawing = [];
          redrawDraft();
        } else pr.current.onCancelTool?.();
      } else if (e.key === "Enter") {
        const tool = pr.current.tool;
        if ((tool === "polyligne" && s.drawing.length >= 2) || (tool === "surface" && s.drawing.length >= 3)) finish();
      } else if (e.key === "Backspace") {
        s.drawing.pop();
        redrawDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    // Recadrage sur la page tant que l'utilisateur n'a pas encore navigué (taille du conteneur connue tardivement)
    let touched = false;
    const markTouched = () => (touched = true);
    host.current!.addEventListener("mousedown", markTouched);
    host.current!.addEventListener("wheel", markTouched, { passive: true });
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      if (!touched && !pr.current.focus) map.fitBounds(bounds, { padding: [20, 20], animate: false });
    });
    ro.observe(host.current!);
    return () => {
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      map.remove();
      loupe.remove();
      st.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, props.tiles.zMin, props.tiles.zMax]);

  // ---------------------------------------------------------- changement d'outil
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.drawing = [];
    s.draw.clearLayers();
    s.snapMark.remove();
    if (props.tool === "select") loupeHost.current!.style.display = "none";
  }, [props.tool]);

  // --------------------------------------------------------------- épingles
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.pins.clearLayers();
    const interactive = props.tool === "select";
    for (const p of props.pins ?? []) {
      const m = L.marker(toLL(p), {
        icon: L.divIcon({ className: "", html: pinHtml(p), iconSize: [30, 38], iconAnchor: [15, 37] }),
        interactive, keyboard: false, draggable: interactive && !!props.draggablePins && !!p.selected,
        zIndexOffset: p.selected ? 1000 : 0, riseOnHover: true,
      });
      m.on("click", () => pr.current.onPinClick?.(p.id));
      m.on("dragend", () => pr.current.onPinDrag?.(p.id, toRel(m.getLatLng())));
      m.addTo(s.pins);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pins, props.tool, props.draggablePins, w, h]);

  // ---------------------------------------------------------------- mesures
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.meas.clearLayers();
    const interactive = props.tool === "select";
    for (const m of props.measures ?? []) {
      const lls = m.pts.map(toLL);
      const color = m.color ?? "#e8590c";
      const style = { color, weight: m.selected ? 4 : 2.5, interactive, fillOpacity: 0.14 };
      const layer = m.type === "surface" ? L.polygon(lls, style) : L.polyline(lls, style);
      layer.bindTooltip(m.label, { permanent: true, direction: "center", className: "measure-label", interactive: false });
      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        pr.current.onMeasureClick?.(m.id);
      });
      layer.addTo(s.meas);
      if (m.type !== "surface")
        for (const ll of [lls[0], lls[lls.length - 1]])
          L.circleMarker(ll, { radius: 3, color, fillColor: "#fff", fillOpacity: 1, weight: 2, interactive: false }).addTo(s.meas);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.measures, props.tool, w, h]);

  // ----------------------------------------------------------------- zones
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.zones.clearLayers();
    const interactive = props.tool === "select";
    for (const z of props.zones ?? []) {
      const r = L.rectangle(L.latLngBounds(toLL({ x: z.rect.x0, y: z.rect.y0 }), toLL({ x: z.rect.x1, y: z.rect.y1 })), {
        color: "#1e5aa8", weight: z.selected ? 3 : 1.5, dashArray: "7 5", fillOpacity: z.selected ? 0.08 : 0.03, interactive,
      });
      r.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        pr.current.onZoneClick?.(z.id);
      });
      r.addTo(s.zones);
      L.tooltip({ permanent: true, direction: "right", className: "zone-label", offset: [0, 10], interactive: false })
        .setLatLng(toLL({ x: Math.min(z.rect.x0, z.rect.x1), y: Math.min(z.rect.y0, z.rect.y1) }))
        .setContent(z.label)
        .addTo(s.zones);
    }
    (s as unknown as { updateScale: () => void }).updateScale?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.zones, props.tool, w, h]);

  // --------------------------------------------------- lignes de référence
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    s.lines.clearLayers();
    for (const l of props.lines ?? []) {
      const pl = L.polyline([toLL(l.a), toLL(l.b)], { color: l.color ?? "#e8590c", weight: 2.5, dashArray: "8 5", interactive: false });
      pl.bindTooltip(l.label, { permanent: true, direction: "top", className: "measure-label" });
      pl.addTo(s.lines);
      for (const p of [l.a, l.b]) L.circleMarker(toLL(p), { radius: 4, color: l.color ?? "#e8590c", fillColor: "#fff", fillOpacity: 1, weight: 2, interactive: false }).addTo(s.lines);
    }
    for (const p of props.marks ?? [])
      L.circleMarker(toLL(p), { radius: 6, color: "#00a36c", fillColor: "#00a36c", fillOpacity: 0.35, weight: 2, interactive: false }).addTo(s.lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.lines, props.marks, w, h]);

  // ------------------------------------------------------------ échelle
  useEffect(() => {
    (st.current as unknown as { updateScale?: () => void })?.updateScale?.();
  }, [props.mppAt]);

  // ----------------------------------------------------------------- focus
  useEffect(() => {
    const s = st.current;
    if (!s || !props.focus) return;
    s.map.setView(toLL(props.focus), Math.max(s.map.getZoom(), props.tiles.zMax - 1), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.key]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      <div ref={loupeHost} className="loupe" style={{ display: "none", left: 0, top: 0 }} />
      <div style={{ position: "absolute", left: 12, bottom: 14, zIndex: 1000 }}><div ref={scaleHost} className="scalebar" /></div>
      <div ref={hintRef} />
    </div>
  );
}
