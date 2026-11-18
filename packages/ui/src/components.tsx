import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { STATUTS, type Statut } from "@chantier/core";

// ------------------------------------------------------------------ icônes

const P: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  folder: <path d="M3 6h7l2 2h9v11H3z" />,
  building: <><path d="M4 21V5l8-3v19M12 9l8 3v9" /><path d="M8 8h0M8 12h0M8 16h0M16 15h0M16 18h0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.6c2 .7 3.2 2.4 3.6 5.4" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h0M3.5 12h0M3.5 18h0" />,
  check: <path d="m4 12.5 5 5L20 6.5" />,
  checklist: <><path d="M10 6h11M10 12h11M10 18h11" /><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17" /></>,
  save: <><path d="M5 3h11l4 4v14H5z" /><path d="M8 3v5h8V3M8 21v-7h8v7" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  pin: <><path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  ruler: <><path d="M3 17 17 3l4 4L7 21z" /><path d="m7 13 2 2M10 10l2 2M13 7l2 2" /></>,
  polyline: <path d="M3 18 9 8l6 7 6-11" />,
  area: <path d="M4 7 11 3l9 6-3 11H6z" />,
  target: <><circle cx="12" cy="12" r="8" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></>,
  zone: <><path d="M4 4h6M14 4h6v6M20 14v6h-6M10 20H4v-6M4 10V4" /></>,
  magnet: <path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4" />,
  cursor: <path d="m5 3 14 7-6 2-2 6z" />,
  camera: <><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="m3 17 5-5 4 4 3-3 6 6" /><circle cx="15.5" cy="8.5" r="1.5" /></>,
  file: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5" /></>,
  pdf: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4 20h16" />,
  upload: <path d="M12 20V9m0 0-4.5 4.5M12 9l4.5 4.5M4 4h16" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="1" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  layers: <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  back: <path d="M15 6 9 12l6 6" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  arrow: <path d="M5 19 19 5M10 5h9v9" />,
  circle: <circle cx="12" cy="12" r="8" />,
  square: <rect x="4" y="4" width="16" height="16" />,
  pen: <path d="M3 21c3-1 4-4 7-7l7-7 3 3-7 7c-3 3-6 4-7 7z" />,
  text: <path d="M5 5h14M12 5v15M9 20h6" />,
  migrate: <><path d="M4 7h11l-3-3M20 17H9l3 3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  warning: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h0" /></>,
  sheet: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 9h18M3 14h18M9 4v16" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" /><path d="M5 9v11h14V9M10 13h4" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  play: <path d="M7 4v16l13-8z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  move: <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />,
};

export function Icon({ name, size = 16, stroke = 1.7 }: { name: keyof typeof P | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name] ?? null}
    </svg>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({
  title, onClose, children, footer, size,
}: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "wide" | "full" }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ""}`} role="dialog">
        {title !== null && (
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="btn ghost icon" onClick={onClose} title="Fermer"><Icon name="x" /></button>
          </div>
        )}
        <div className={title === null ? "modal-body bare" : "modal-body"}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------- toasts + confirm

type Toast = { id: number; text: string; kind?: "ok" | "error" };
interface UiApi {
  toast: (text: string, kind?: "ok" | "error") => void;
  confirm: (text: ReactNode, opts?: { ok?: string; danger?: boolean; title?: string }) => Promise<boolean>;
  prompt: (title: string, label: string, initial?: string) => Promise<string | null>;
}
const UiCtx = createContext<UiApi>(null as never);
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<ReactNode>(null);
  const toast = useCallback((text: string, kind?: "ok" | "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  const confirm = useCallback<UiApi["confirm"]>(
    (text, opts) =>
      new Promise((res) => {
        const done = (v: boolean) => {
          setDlg(null);
          res(v);
        };
        setDlg(
          <Modal title={opts?.title ?? "Confirmation"} onClose={() => done(false)}
            footer={<>
              <button className="btn" onClick={() => done(false)}>Annuler</button>
              <button className={`btn ${opts?.danger ? "danger" : "primary"}`} autoFocus onClick={() => done(true)}>{opts?.ok ?? "Confirmer"}</button>
            </>}>
            <div>{text}</div>
          </Modal>,
        );
      }),
    [],
  );
  const prompt = useCallback<UiApi["prompt"]>(
    (title, label, initial = "") =>
      new Promise((res) => {
        const done = (v: string | null) => {
          setDlg(null);
          res(v);
        };
        setDlg(<PromptDialog title={title} label={label} initial={initial} done={done} />);
      }),
    [],
  );
  return (
    <UiCtx.Provider value={{ toast, confirm, prompt }}>
      {children}
      {dlg}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind ?? ""}`}>{t.text}</div>)}</div>
    </UiCtx.Provider>
  );
}

function PromptDialog({ title, label, initial, done }: { title: string; label: string; initial: string; done: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Modal title={title} onClose={() => done(null)}
      footer={<><button className="btn" onClick={() => done(null)}>Annuler</button><button className="btn primary" onClick={() => done(v)}>Valider</button></>}>
      <label className="field"><span>{label}</span>
        <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && done(v)} />
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------- divers

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ""}`}>
      <span>{label}{hint && <> <span className="hint">— {hint}</span></>}</span>
      {children}
    </label>
  );
}

export function StatusBadge({ statut }: { statut: string }) {
  const s = STATUTS[statut as Statut];
  if (!s) return <span className="badge">{statut}</span>;
  return <span className="badge" style={{ background: s.couleur + "1a", color: s.couleur }}><span className="dot" style={{ background: s.couleur }} />{s.label}</span>;
}

export function LotChip({ nom, couleur }: { nom?: string | null; couleur?: string | null }) {
  if (!nom) return <span className="muted">—</span>;
  return <span className="lot-chip"><i style={{ background: couleur ?? "#999" }} />{nom}</span>;
}

export function Empty({ icon = "folder", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={34} stroke={1.3} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number; icon?: string }[] }) {
  return (
    <div className="tabs">
      {items.map((it) => (
        <button key={it.id} className={`tab ${value === it.id ? "active" : ""}`} onClick={() => onChange(it.id)}>
          {it.icon && <Icon name={it.icon} size={15} />}{it.label}{it.count != null && <span className="count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Zone de dépôt de fichiers (glisser-déposer ou clic). */
export function DropZone({ accept, multiple, onFiles, children }: { accept: string; multiple?: boolean; onFiles: (f: File[]) => void; children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className={`drop ${over ? "over" : ""}`} onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}>
      <input ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {children}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return <div className="progress"><div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} /></div>;
}
