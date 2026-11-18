import type { ReactNode } from "react";
import { Icon } from "@chantier/ui";

export function Topbar({ crumbs, children }: { crumbs: { label: ReactNode; onClick?: () => void }[]; children?: ReactNode }) {
  return (
    <div className="topbar">
      <div className="crumbs grow">
        {crumbs.map((c, i) => (
          <span key={i} className="row" style={{ gap: 6, minWidth: 0 }}>
            {i > 0 && <Icon name="chevron" size={14} />}
            {i === crumbs.length - 1 ? <span className="cur ellipsis">{c.label}</span> : <button onClick={c.onClick}>{c.label}</button>}
          </span>
        ))}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
