/** Choix de couleur : palette + mode personnalisé (teinte / saturation-luminosité, hexadécimal, RVB). */
import { useEffect, useRef, useState } from "react";

// ------------------------------------------------------------- conversions

export type RGB = { r: number; g: number; b: number };
export type HSV = { h: number; s: number; v: number };

export function hexToRgb(hex: string): RGB | null {
  const m = hex.trim().replace(/^#/, "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const rgbToHex = ({ r, g, b }: RGB) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// ---------------------------------------------------------------- composant

function useDrag(onMove: (fx: number, fy: number) => void, onEnd: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const handle = (e: React.PointerEvent) => {
    const el = ref.current!;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      onMove(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
    };
    move(e);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      onEnd();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return { ref, onPointerDown: handle };
}

/** Panneau de couleur personnalisée. `onChange` est appelé à la fin d'un glissement ou d'une saisie. */
export function CustomColor({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(value) ?? { r: 232, g: 89, b: 12 }));
  const [hexText, setHexText] = useState(value);
  const latest = useRef(hsv);
  latest.current = hsv;
  const rgb = hsvToRgb(hsv);
  const hex = rgbToHex(rgb);
  useEffect(() => setHexText(hex), [hex]);
  useEffect(() => {
    const c = hexToRgb(value);
    if (c && rgbToHex(c) !== rgbToHex(hsvToRgb(latest.current))) setHsv(rgbToHsv(c));
  }, [value]);

  const commit = () => onChange(rgbToHex(hsvToRgb(latest.current)));
  const sv = useDrag((fx, fy) => setHsv((x) => ({ ...x, s: fx, v: 1 - fy })), commit);
  const hue = useDrag((fx) => setHsv((x) => ({ ...x, h: Math.min(359.9, fx * 360) })), commit);
  const setRgb = (k: keyof RGB, v: string) => {
    const n = Math.max(0, Math.min(255, parseInt(v, 10) || 0));
    const next = rgbToHsv({ ...rgb, [k]: n });
    setHsv(next);
    latest.current = next;
  };
  const applyHex = () => {
    const c = hexToRgb(hexText);
    if (!c) return setHexText(hex);
    const next = rgbToHsv(c);
    setHsv(next);
    latest.current = next;
    onChange(rgbToHex(c));
  };

  return (
    <div className="cp">
      <div className="cp-sv" ref={sv.ref} onPointerDown={sv.onPointerDown} style={{ background: `hsl(${hsv.h} 100% 50%)` }}>
        <div className="cp-sv-white" />
        <div className="cp-sv-black" />
        <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div className="cp-hue" ref={hue.ref} onPointerDown={hue.onPointerDown}>
        <span className="cp-knob" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="cp-fields">
        <span className="cp-preview" style={{ background: hex }} />
        <label>Hex<input className="input num" value={hexText} maxLength={7} onChange={(e) => setHexText(e.target.value)}
          onBlur={applyHex} onKeyDown={(e) => e.key === "Enter" && applyHex()} /></label>
        {(["r", "g", "b"] as const).map((k) => (
          <label key={k}>{k.toUpperCase()}<input className="input num" type="number" min={0} max={255} value={Math.round(rgb[k])}
            onChange={(e) => setRgb(k, e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} /></label>
        ))}
      </div>
    </div>
  );
}

/**
 * Palette + bouton « personnalisé ».
 * - `inline` : le panneau personnalisé s'ouvre sous la palette ;
 * - sinon il s'ouvre en surimpression (position fixe : jamais rogné par un tableau défilant) ;
 * - `compact` : une seule pastille (la couleur courante) qui ouvre palette + panneau.
 */
export function ColorPicker({
  value, onChange, presets, inline = true, compact = false, size = 22,
}: { value: string; onChange: (hex: string) => void; presets: string[]; inline?: boolean; compact?: boolean; size?: number }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const isPreset = presets.some((p) => p.toLowerCase() === value.toLowerCase());
  const floating = compact || !inline;
  useEffect(() => {
    if (!open || !floating) return;
    const r = wrap.current!.getBoundingClientRect();
    const W = 290, H = compact ? 330 : 290;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
      top: r.bottom + 6 + H > window.innerHeight ? Math.max(8, r.top - H - 6) : r.bottom + 6,
    });
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, floating, compact]);

  const swatches = (
    <div className="row wrap" style={{ gap: 6 }}>
      {presets.map((c) => (
        <span key={c} className={`swatch ${c.toLowerCase() === value.toLowerCase() ? "on" : ""}`} style={{ background: c, width: size, height: size }}
          onClick={() => { onChange(c); if (!compact) setOpen(false); }} title={c} />
      ))}
      {!compact && (
        <span className={`swatch swatch-custom ${!isPreset || open ? "on" : ""}`} title="Couleur personnalisée"
          style={{ width: size, height: size, ...(isPreset ? {} : { background: value }) }} onClick={() => setOpen(!open)}>
          {isPreset && "+"}
        </span>
      )}
    </div>
  );
  return (
    <div className="cp-wrap" ref={wrap}>
      {compact ? (
        <span className="swatch on" title="Changer la couleur" style={{ background: value, width: size, height: size, display: "inline-block" }} onClick={() => setOpen(!open)} />
      ) : swatches}
      {open && !floating && <div className="cp-inline"><CustomColor value={value} onChange={onChange} /></div>}
      {open && floating && pos && (
        <div className="cp-pop" ref={pop} style={{ left: pos.left, top: pos.top }}>
          {compact && presets.length > 0 && <div style={{ marginBottom: 10 }}>{swatches}</div>}
          <CustomColor value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
