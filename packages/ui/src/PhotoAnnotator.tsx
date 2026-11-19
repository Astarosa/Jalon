/** Annotation de photos (flèches, cercles, rectangles, traits, main levée, texte). */
import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KImage, Arrow, Line, Ellipse, Rect as KRect, Text as KText, Transformer } from "react-konva";
import type Konva from "konva";
import { ANNOTATION_COLORS, uuid, type Shape } from "@chantier/core";
import { Icon } from "./components";
import { ColorPicker } from "./ColorPicker";

type Kind = Shape["kind"] | "select";

const TOOLS: { k: Kind; icon: string; label: string }[] = [
  { k: "select", icon: "cursor", label: "Sélection" },
  { k: "fleche", icon: "arrow", label: "Flèche" },
  { k: "ellipse", icon: "circle", label: "Cercle" },
  { k: "rect", icon: "square", label: "Rectangle" },
  { k: "trait", icon: "polyline", label: "Trait" },
  { k: "main", icon: "pen", label: "Main levée" },
  { k: "texte", icon: "text", label: "Texte" },
];

export function PhotoAnnotator({
  src, initial, onSave, onCancel,
}: { src: string; initial: Shape[]; onSave: (shapes: Shape[]) => void; onCancel: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<Shape[]>(initial);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [tool, setTool] = useState<Kind>("fleche");
  const [color, setColor] = useState(ANNOTATION_COLORS[0]);
  const [width, setWidth] = useState(4);
  const [sel, setSel] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const wrap = useRef<HTMLDivElement>(null);
  const tr = useRef<Konva.Transformer>(null);
  const stage = useRef<Konva.Stage>(null);
  const drawing = useRef<Shape | null>(null);

  useEffect(() => {
    const i = new window.Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);
  useEffect(() => {
    const ro = new ResizeObserver(() => wrap.current && setBox({ w: wrap.current.clientWidth, h: wrap.current.clientHeight }));
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!img) return { W: 1, H: 1 };
    const k = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
    return { W: img.naturalWidth * k, H: img.naturalHeight * k };
  }, [img, box]);
  const { W, H } = fit;
  // épaisseurs exprimées relativement à la largeur de l'image (rendu identique quelle que soit la taille)
  const rel = (px: number) => px / 1000;
  const abs = (r: number) => r * W;

  const commit = (next: Shape[]) => {
    setHistory((h) => [...h.slice(-40), shapes]);
    setShapes(next);
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setShapes(prev);
    setSel(null);
  };

  useEffect(() => {
    const t = tr.current;
    if (!t || !stage.current) return;
    const node = sel ? stage.current.findOne("#" + sel) : null;
    t.nodes(node ? [node] : []);
  }, [sel, shapes]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        commit(shapes.filter((s) => s.id !== sel));
        setSel(null);
      }
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) undo();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const pos = () => {
    const p = stage.current!.getPointerPosition()!;
    return { x: p.x / W, y: p.y / H };
  };

  const down = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "select") {
      if (e.target === e.target.getStage() || e.target.name() === "bg") setSel(null);
      return;
    }
    const p = pos();
    const id = uuid();
    const sw = rel(width);
    let s: Shape;
    if (tool === "fleche" || tool === "trait") s = { kind: tool, id, color, width: sw, pts: [p.x, p.y, p.x, p.y] };
    else if (tool === "ellipse") s = { kind: "ellipse", id, color, width: sw, x: p.x, y: p.y, rx: 0, ry: 0 };
    else if (tool === "rect") s = { kind: "rect", id, color, width: sw, x: p.x, y: p.y, w: 0, h: 0 };
    else if (tool === "main") s = { kind: "main", id, color, width: sw, pts: [p.x, p.y] };
    else {
      const text = window.prompt("Texte de l'annotation");
      if (!text) return;
      commit([...shapes, { kind: "texte", id, color, size: rel(width * 7), x: p.x, y: p.y, text }]);
      return;
    }
    drawing.current = s;
    setShapes((all) => [...all, s]);
    setHistory((h) => [...h.slice(-40), shapes]);
  };
  const move = () => {
    const s = drawing.current;
    if (!s) return;
    const p = pos();
    let n: Shape = s;
    if (s.kind === "fleche" || s.kind === "trait") n = { ...s, pts: [s.pts[0], s.pts[1], p.x, p.y] };
    else if (s.kind === "ellipse") n = { ...s, rx: Math.abs(p.x - s.x), ry: Math.abs(p.y - s.y) * (H / W) };
    else if (s.kind === "rect") n = { ...s, w: p.x - s.x, h: p.y - s.y };
    else if (s.kind === "main") n = { ...s, pts: [...s.pts, p.x, p.y] };
    drawing.current = n;
    setShapes((all) => all.map((x) => (x.id === n.id ? n : x)));
  };
  const up = () => {
    const s = drawing.current;
    drawing.current = null;
    if (!s) return;
    const tiny =
      (s.kind === "fleche" || s.kind === "trait") ? Math.hypot((s.pts[2] - s.pts[0]) * W, (s.pts[3] - s.pts[1]) * H) < 6 :
      s.kind === "ellipse" ? s.rx * W < 4 : s.kind === "rect" ? Math.abs(s.w * W) < 4 : false;
    if (tiny) setShapes((all) => all.filter((x) => x.id !== s.id));
  };

  const moved = (id: string, node: Konva.Node) => {
    const dx = node.x() / W, dy = node.y() / H;
    const sx = node.scaleX(), sy = node.scaleY();
    node.position({ x: 0, y: 0 });
    node.scale({ x: 1, y: 1 });
    commit(shapes.map((s) => {
      if (s.id !== id) return s;
      if (s.kind === "fleche" || s.kind === "trait" || s.kind === "main") return { ...s, pts: s.pts.map((v, i) => (i % 2 ? v + dy : v + dx)) } as Shape;
      if (s.kind === "ellipse") return { ...s, x: s.x + dx, y: s.y + dy, rx: s.rx * sx, ry: s.ry * sy };
      if (s.kind === "rect") return { ...s, x: s.x + dx, y: s.y + dy, w: s.w * sx, h: s.h * sy };
      return { ...s, x: s.x + dx, y: s.y + dy, size: s.size * sy };
    }));
  };

  const common = (s: Shape) => ({
    id: s.id, draggable: tool === "select",
    onMouseDown: () => tool === "select" && setSel(s.id),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => moved(s.id, e.target),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => moved(s.id, e.target),
    hitStrokeWidth: 14,
  });

  return (
    <div className="annotator">
      <div className="row wrap between">
        <div className="row wrap">
          <div className="btn-group">
            {TOOLS.map((t) => (
              <button key={t.k} className={`btn ${tool === t.k ? "on" : ""}`} title={t.label} onClick={() => { setTool(t.k); setSel(null); }}>
                <Icon name={t.icon} />
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 8 }}>
            <ColorPicker value={color} presets={ANNOTATION_COLORS} onChange={setColor} inline={false} />
          </div>
          <label className="row small muted" style={{ marginLeft: 8 }}>Épaisseur
            <input type="range" min={2} max={12} value={width} onChange={(e) => setWidth(+e.target.value)} />
          </label>
          <button className="btn" onClick={undo} disabled={!history.length} title="Annuler (Ctrl+Z)"><Icon name="undo" /></button>
          <button className="btn danger" disabled={!sel} onClick={() => { commit(shapes.filter((s) => s.id !== sel)); setSel(null); }}><Icon name="trash" /></button>
        </div>
        <div className="row">
          <button className="btn" onClick={onCancel}>Annuler</button>
          <button className="btn primary" onClick={() => onSave(shapes)}>Enregistrer</button>
        </div>
      </div>
      <div className="stage" ref={wrap}>
        {img && (
          <Stage ref={stage} width={W} height={H} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
            style={{ cursor: tool === "select" ? "default" : "crosshair" }}>
            <Layer>
              <KImage image={img} width={W} height={H} name="bg" />
              {shapes.map((s) => {
                if (s.kind === "fleche")
                  return <Arrow key={s.id} {...common(s)} points={s.pts.map((v, i) => (i % 2 ? v * H : v * W))} stroke={s.color} fill={s.color} strokeWidth={abs(s.width)} pointerLength={abs(s.width) * 4} pointerWidth={abs(s.width) * 4} lineCap="round" />;
                if (s.kind === "trait")
                  return <Line key={s.id} {...common(s)} points={s.pts.map((v, i) => (i % 2 ? v * H : v * W))} stroke={s.color} strokeWidth={abs(s.width)} lineCap="round" />;
                if (s.kind === "main")
                  return <Line key={s.id} {...common(s)} points={s.pts.map((v, i) => (i % 2 ? v * H : v * W))} stroke={s.color} strokeWidth={abs(s.width)} lineCap="round" lineJoin="round" tension={0.4} />;
                if (s.kind === "ellipse")
                  return <Ellipse key={s.id} {...common(s)} x={s.x * W} y={s.y * H} radiusX={s.rx * W} radiusY={s.ry * W} stroke={s.color} strokeWidth={abs(s.width)} />;
                if (s.kind === "rect")
                  return <KRect key={s.id} {...common(s)} x={s.x * W} y={s.y * H} width={s.w * W} height={s.h * H} stroke={s.color} strokeWidth={abs(s.width)} />;
                return <KText key={s.id} {...common(s)} x={s.x * W} y={s.y * H} text={s.text} fill={s.color} fontSize={abs(s.size)} fontStyle="bold" stroke="rgba(0,0,0,.55)" strokeWidth={Math.max(1, abs(s.size) / 18)} fillAfterStrokeEnabled />;
              })}
              <Transformer ref={tr} rotateEnabled={false} />
            </Layer>
          </Stage>
        )}
      </div>
    </div>
  );
}

/** Dessin des annotations sur un canvas 2D (aplatissement pour les rapports). */
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], W: number, H: number) {
  const abs = (r: number) => r * W;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of shapes) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    if (s.kind === "texte") {
      const size = abs(s.size);
      ctx.font = `bold ${size}px "IBM Plex Sans", sans-serif`;
      ctx.textBaseline = "top";
      ctx.lineWidth = Math.max(1, size / 9);
      ctx.strokeStyle = "rgba(0,0,0,.55)";
      ctx.strokeText(s.text, s.x * W, s.y * H);
      ctx.fillText(s.text, s.x * W, s.y * H);
      continue;
    }
    ctx.lineWidth = abs(s.width);
    ctx.beginPath();
    if (s.kind === "fleche" || s.kind === "trait") {
      const [x0, y0, x1, y1] = [s.pts[0] * W, s.pts[1] * H, s.pts[2] * W, s.pts[3] * H];
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      if (s.kind === "fleche") {
        const a = Math.atan2(y1 - y0, x1 - x0), L = abs(s.width) * 4;
        ctx.beginPath();
        ctx.moveTo(x1 + Math.cos(a) * L * 0.3, y1 + Math.sin(a) * L * 0.3);
        ctx.lineTo(x1 - Math.cos(a - 0.5) * L, y1 - Math.sin(a - 0.5) * L);
        ctx.lineTo(x1 - Math.cos(a + 0.5) * L, y1 - Math.sin(a + 0.5) * L);
        ctx.closePath();
        ctx.fill();
      }
    } else if (s.kind === "main") {
      for (let i = 0; i < s.pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, s.pts[i] * W, s.pts[i + 1] * H);
      ctx.stroke();
    } else if (s.kind === "ellipse") {
      ctx.ellipse(s.x * W, s.y * H, s.rx * W, s.ry * W, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.kind === "rect") {
      ctx.strokeRect(s.x * W, s.y * H, s.w * W, s.h * H);
    }
  }
}
