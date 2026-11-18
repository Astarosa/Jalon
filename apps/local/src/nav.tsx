import { createContext, useContext } from "react";

export type ProjectTab = "plans" | "points" | "visites" | "intervenants" | "rapports" | "infos";

export type Route =
  | { view: "home" }
  | { view: "project"; projectId: string; tab: ProjectTab }
  | { view: "plan"; projectId: string; planId: string; versionId: string; ticketId?: string }
  | { view: "companies" }
  | { view: "templates" }
  | { view: "settings" };

export interface ActiveVisit {
  projectId: string;
  visitId: string;
  label: string;
}

export interface AppCtx {
  route: Route;
  go: (r: Route) => void;
  visit: ActiveVisit | null;
  setVisit: (v: ActiveVisit | null) => void;
  /** Identifiant de la visite active pour le chantier donné (sinon null) */
  visitFor: (projectId: string) => string | null;
}

export const Ctx = createContext<AppCtx>(null as never);
export const useApp = () => useContext(Ctx);
