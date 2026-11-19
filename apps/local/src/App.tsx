import { useCallback, useEffect, useState } from "react";
import { Icon, useUi } from "@chantier/ui";
import { backupNow, getConfig, platform, setConfig, type ConfigState } from "./platform";
import { initDatabase } from "./data/db";
import { getProject, getSetting, seedDefaults, setSetting } from "./data/repo";
import { useData } from "./data/useData";
import { Ctx, type ActiveVisit, type Route } from "./nav";
import { HomeScreen } from "./screens/HomeScreen";
import { ProjectScreen } from "./screens/ProjectScreen";
import { PlanScreen } from "./screens/PlanScreen";
import { CompaniesScreen } from "./screens/CompaniesScreen";
import { TemplatesScreen } from "./screens/TemplatesScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

export const APP_VERSION = "1.0.1";

export function App() {
  const [cfg, setCfg] = useState<ConfigState | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    try {
      const c = await getConfig();
      setCfg(c);
      if (c.dataDirOpen) {
        await initDatabase();
        await seedDefaults();
        setReady(true);
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    boot();
  }, [boot]);

  if (error) return <div className="welcome"><div className="card"><h2>Erreur au démarrage</h2><pre className="small">{error}</pre></div></div>;
  if (!cfg) return null;
  if (!cfg.dataDirOpen) return <Setup cfg={cfg} onDone={boot} />;
  if (!ready) return null;
  return <Shell cfg={cfg} />;
}

function Setup({ cfg, onDone }: { cfg: ConfigState; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const ui = useUi();
  const choose = async () => {
    const dir = await platform.pickFolder("Dossier des données de Jalon");
    if (!dir) return;
    setBusy(true);
    try {
      await setConfig({ ...cfg.config, data_dir: dir });
      onDone();
    } catch (e) {
      ui.toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="welcome">
      <div className="card">
        <div className="brand" style={{ color: "var(--ink)", padding: 0 }}>
          <div className="brand-mark">J</div>
          <div><div className="brand-name" style={{ fontSize: 20 }}>Jalon</div><div className="muted small">Suivi de chantier — édition locale</div></div>
        </div>
        <p>Choisissez le dossier où seront rangés vos chantiers : base de données, plans, photos et rapports.</p>
        <div className="callout">
          Conseil : un dossier sur le disque du PC, par exemple <span className="mono">Documents\Chantiers</span>.
          Évitez un dossier synchronisé OneDrive pour les données elles-mêmes : réservez-le aux sauvegardes.
        </div>
        <div className="row end"><button className="btn primary" disabled={busy} onClick={choose}><Icon name="folder" />Choisir le dossier…</button></div>
      </div>
    </div>
  );
}

function Shell({ cfg }: { cfg: ConfigState }) {
  const [route, setRoute] = useState<Route>({ view: "home" });
  const [visit, setVisitState] = useState<ActiveVisit | null>(null);
  const ui = useUi();

  useEffect(() => {
    getSetting<{ v: ActiveVisit | null }>("visite_active", { v: null }).then((s) => setVisitState(s.v));
  }, []);
  const setVisit = (v: ActiveVisit | null) => {
    setVisitState(v);
    setSetting("visite_active", { v });
  };

  // sauvegarde automatique périodique
  useEffect(() => {
    const h = cfg.config.backup_interval_hours;
    if (!h) return;
    const t = setInterval(() => {
      backupNow("auto").catch((e) => ui.toast(`Sauvegarde automatique impossible : ${e}`, "error"));
    }, h * 3600 * 1000);
    return () => clearInterval(t);
  }, [cfg.config.backup_interval_hours, ui]);

  const go = (r: Route) => setRoute(r);
  const visitFor = (pid: string) => (visit && visit.projectId === pid ? visit.visitId : null);
  const visitProject = useData(() => (visit ? getProject(visit.projectId) : Promise.resolve(undefined)), [visit?.projectId]);

  const nav = (label: string, icon: string, r: Route, active: boolean) => (
    <button className={`side-btn ${active ? "active" : ""}`} onClick={() => go(r)}><Icon name={icon} />{label}</button>
  );

  let screen;
  switch (route.view) {
    case "home": screen = <HomeScreen />; break;
    case "project": screen = <ProjectScreen key={route.projectId} projectId={route.projectId} tab={route.tab} />; break;
    case "plan": screen = <PlanScreen key={route.versionId} {...route} />; break;
    case "companies": screen = <CompaniesScreen />; break;
    case "templates": screen = <TemplatesScreen />; break;
    case "settings": screen = <SettingsScreen />; break;
  }

  return (
    <Ctx.Provider value={{ route, go, visit, setVisit, visitFor }}>
      <div className="app">
        <aside className="side">
          <div className="brand">
            <div className="brand-mark">J</div>
            <div><div className="brand-name">Jalon</div><div className="brand-sub">Édition locale</div></div>
          </div>
          {nav("Chantiers", "building", { view: "home" }, route.view === "home" || route.view === "project" || route.view === "plan")}
          <div className="side-label">Référentiels</div>
          {nav("Entreprises", "users", { view: "companies" }, route.view === "companies")}
          {nav("Modèles de checklists", "checklist", { view: "templates" }, route.view === "templates")}
          <div className="side-label">Application</div>
          {nav("Réglages et sauvegardes", "settings", { view: "settings" }, route.view === "settings")}
          {visit && (
            <div className="side-visit">
              <div className="row" style={{ gap: 6 }}><Icon name="clock" size={14} /><b>Visite en cours</b></div>
              <div className="ellipsis" style={{ marginTop: 4 }}>{visit.label}</div>
              <div className="ellipsis muted small" style={{ color: "#f0b796" }}>{visitProject?.nom}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm" style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.3)" }}
                  onClick={() => go({ view: "project", projectId: visit.projectId, tab: "visites" })}>Ouvrir</button>
              </div>
            </div>
          )}
          <div className="side-foot">v{APP_VERSION}{platform.kind === "dev" ? " · dev" : ""}</div>
        </aside>
        <main className="main">{screen}</main>
      </div>
    </Ctx.Provider>
  );
}
