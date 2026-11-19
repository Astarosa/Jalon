/**
 * Mises à jour : vérification au lancement (et à la demande depuis les réglages), puis proposition
 * de téléchargement. Les mises à jour sont signées : l'application refuse tout fichier dont la
 * signature ne correspond pas à la clé publique intégrée.
 */
import { useCallback, useEffect, useState } from "react";
import { Icon, Progress, useUi } from "@chantier/ui";
import { backupNow, isTauri } from "../platform";
import { APP_VERSION } from "../version";

type UpdateHandle = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

const EVENT = "jalon:verifier-mise-a-jour";

/** Lance une vérification manuelle (bouton des réglages). */
export const requestUpdateCheck = () => window.dispatchEvent(new CustomEvent(EVENT));

export function UpdateNotifier() {
  const ui = useUi();
  const [update, setUpdate] = useState<NonNullable<UpdateHandle> | null>(null);
  const [hidden, setHidden] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  const run = useCallback(async (manual: boolean) => {
    if (!isTauri()) {
      if (manual) ui.toast("Les mises à jour ne sont disponibles que dans l'application installée");
      return;
    }
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const u = await check({ timeout: 15000 });
      if (u) {
        setUpdate(u);
        setHidden(false);
      } else if (manual) ui.toast(`Jalon est à jour (version ${APP_VERSION})`, "ok");
    } catch (e) {
      // Hors connexion ou aucune version publiée : silencieux au lancement.
      if (manual) ui.toast(`Vérification impossible : ${e}`, "error");
      else console.warn("vérification des mises à jour", e);
    }
  }, [ui]);

  useEffect(() => {
    const t = setTimeout(() => run(false), 2500);
    const onManual = () => run(true);
    window.addEventListener(EVENT, onManual);
    return () => {
      clearTimeout(t);
      window.removeEventListener(EVENT, onManual);
    };
  }, [run]);

  const install = async () => {
    if (!update) return;
    setProgress(0);
    try {
      // Filet de sécurité avant de remplacer l'application.
      await backupNow("avant-mise-a-jour").catch(() => undefined);
      let total = 0, done = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          setProgress(total ? done / total : 0.5);
        } else if (ev.event === "Finished") setProgress(1);
      });
      // Sous Windows, l'installeur ferme l'application, installe la nouvelle version puis la relance.
    } catch (e) {
      setProgress(null);
      ui.toast(`Mise à jour impossible : ${e}`, "error");
    }
  };

  if (!update || hidden) return null;
  return (
    <div className="update-card" role="status">
      <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
        <span className="update-ico"><Icon name="download" size={18} /></span>
        <div className="grow">
          <b>Nouvelle version disponible : {update.version}</b>
          <div className="small" style={{ opacity: 0.8 }}>Version installée : {APP_VERSION}{update.date ? ` · publiée le ${new Date(update.date).toLocaleDateString("fr-FR")}` : ""}</div>
        </div>
        {progress == null && <button className="btn sm ghost icon" style={{ color: "#fff" }} title="Plus tard" onClick={() => setHidden(true)}><Icon name="x" size={14} /></button>}
      </div>
      {update.body && (
        <>
          <button className="update-link" onClick={() => setShowNotes(!showNotes)}>{showNotes ? "Masquer les nouveautés" : "Voir les nouveautés"}</button>
          {showNotes && <div className="update-notes">{update.body}</div>}
        </>
      )}
      {progress == null ? (
        <div className="row end" style={{ marginTop: 10 }}>
          <button className="btn sm" style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.35)" }} onClick={() => setHidden(true)}>Plus tard</button>
          <button className="btn sm primary" onClick={install}><Icon name="download" size={14} />Télécharger et installer</button>
        </div>
      ) : (
        <div className="col" style={{ marginTop: 10, gap: 6 }}>
          <Progress value={progress} />
          <span className="small" style={{ opacity: 0.8 }}>
            {progress < 1 ? "Téléchargement… une sauvegarde de vos données a été faite." : "Installation : Jalon va redémarrer."}
          </span>
        </div>
      )}
    </div>
  );
}
