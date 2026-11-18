import { useEffect, useState } from "react";
import { formatDateFr } from "@chantier/core";
import { Field, Icon, useUi } from "@chantier/ui";
import { DEFAULT_IDENTITY, getIdentity, registerFile, setSetting, type Identity } from "../data/repo";
import { useData } from "../data/useData";
import { Topbar } from "../components/Topbar";
import { backupNow, getConfig, listBackups, platform, putFile, restoreBackup, setConfig, type ConfigState } from "../platform";
import { bump } from "../data/db";

export function SettingsScreen() {
  const ui = useUi();
  const identity = useData(getIdentity, []);
  const [id, setId] = useState<Identity>(DEFAULT_IDENTITY);
  const [cfg, setCfg] = useState<ConfigState | null>(null);
  const [backups, setBackups] = useState<Awaited<ReturnType<typeof listBackups>>>([]);
  const [busy, setBusy] = useState(false);

  const [idLoaded, setIdLoaded] = useState(false);
  useEffect(() => {
    if (identity && !idLoaded) {
      setId(identity);
      setIdLoaded(true);
    }
  }, [identity, idLoaded]);
  const refresh = async () => {
    setCfg(await getConfig());
    setBackups(await listBackups().catch(() => []));
  };
  useEffect(() => { refresh(); }, []);

  const saveId = (patch: Partial<Identity>) => {
    const n = { ...id, ...patch };
    setId(n);
    setSetting("identite", n);
  };
  const logo = () => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = "image/png,image/jpeg";
    i.onchange = async () => {
      const f = i.files?.[0];
      if (!f) return;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const sha = await putFile(bytes);
      await registerFile(sha, f.name, f.type, bytes.length);
      saveId({ logo_sha256: sha });
    };
    i.click();
  };
  const updCfg = async (patch: Partial<ConfigState["config"]>) => {
    if (!cfg) return;
    setCfg(await setConfig({ ...cfg.config, ...patch }));
    setBackups(await listBackups().catch(() => []));
  };
  const doBackup = async () => {
    setBusy(true);
    try {
      const b = await backupNow("manuelle");
      ui.toast(`Sauvegarde ${b.name} effectuée`, "ok");
      await refresh();
    } catch (e) {
      ui.toast(`Sauvegarde impossible : ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };
  const restore = async (name: string) => {
    if (!(await ui.confirm(<>Restaurer la sauvegarde <b>{name}</b> ? L'état actuel sera d'abord sauvegardé (« avant-restauration »).</>, { ok: "Restaurer" }))) return;
    setBusy(true);
    try {
      await restoreBackup(name);
      bump();
      ui.toast("Sauvegarde restaurée", "ok");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      ui.toast(`Restauration impossible : ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const sameDisk = cfg?.config.data_dir && cfg.effectiveBackupDir && cfg.effectiveBackupDir.slice(0, 2).toLowerCase() === cfg.config.data_dir.slice(0, 2).toLowerCase();

  return (
    <>
      <Topbar crumbs={[{ label: "Réglages et sauvegardes" }]} />
      <div className="page">
        <div className="page-narrow col gap-lg">
          <div className="card card-pad col">
            <h2>Identité (en-tête des rapports)</h2>
            <div className="grid2">
              <Field label="Société"><input className="input" value={id.societe} onChange={(e) => setId({ ...id, societe: e.target.value })} onBlur={() => saveId({})} /></Field>
              <Field label="Conducteur de travaux"><input className="input" value={id.conducteur} onChange={(e) => setId({ ...id, conducteur: e.target.value })} onBlur={() => saveId({})} /></Field>
              <Field label="Téléphone"><input className="input" value={id.telephone} onChange={(e) => setId({ ...id, telephone: e.target.value })} onBlur={() => saveId({})} /></Field>
              <Field label="E-mail"><input className="input" value={id.email} onChange={(e) => setId({ ...id, email: e.target.value })} onBlur={() => saveId({})} /></Field>
            </div>
            <div className="row">
              {id.logo_sha256 && <img src={platform.fileUrl(id.logo_sha256)} style={{ height: 40, border: "1px solid var(--line)", borderRadius: 4, padding: 2, background: "#fff" }} />}
              <button className="btn" onClick={logo}><Icon name="image" />{id.logo_sha256 ? "Changer le logo" : "Ajouter un logo"}</button>
              {id.logo_sha256 && <button className="btn ghost" onClick={() => saveId({ logo_sha256: null })}>Retirer</button>}
            </div>
          </div>

          <div className="card card-pad col">
            <h2>Sauvegardes</h2>
            <div className="small muted">Toutes les données sont sur ce PC : les sauvegardes sont votre filet de sécurité. Copie cohérente de la base + copie incrémentale des photos et plans.</div>
            <div className="grid2">
              <Field label="Dossier de sauvegarde" hint={cfg?.config.backup_dir ? "personnalisé" : "par défaut"}>
                <div className="row">
                  <input className="input mono small" readOnly value={cfg?.effectiveBackupDir ?? ""} />
                  <button className="btn" onClick={async () => { const d = await platform.pickFolder("Dossier de sauvegarde"); if (d) updCfg({ backup_dir: d }); }}>Changer…</button>
                </div>
              </Field>
              <div className="grid3">
                <Field label="Toutes les (h)"><input className="input num" type="number" min={0} value={cfg?.config.backup_interval_hours ?? 4} onChange={(e) => updCfg({ backup_interval_hours: +e.target.value })} /></Field>
                <Field label="Conserver"><input className="input num" type="number" min={1} value={cfg?.config.backup_keep ?? 20} onChange={(e) => updCfg({ backup_keep: +e.target.value })} /></Field>
                <Field label="À la fermeture"><label className="check" style={{ height: 32 }}><input type="checkbox" checked={cfg?.config.backup_on_close ?? true} onChange={(e) => updCfg({ backup_on_close: e.target.checked })} />Oui</label></Field>
              </div>
            </div>
            {sameDisk && <div className="callout warn">Les sauvegardes sont sur le même disque que les données : choisissez de préférence un disque externe, un NAS ou un dossier OneDrive / SharePoint.</div>}
            <div className="row"><button className="btn primary" disabled={busy} onClick={doBackup}><Icon name="save" />Sauvegarder maintenant</button></div>
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="table">
                <thead><tr><th>Sauvegarde</th><th>Type</th><th>Base</th><th>Fichiers copiés</th><th /></tr></thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.name}>
                      <td>{formatDateFr(b.created_at, true)}</td>
                      <td><span className="badge">{b.reason}</span></td>
                      <td className="mono small">{(b.db_bytes / 1024).toFixed(0)} Ko</td>
                      <td className="mono small">{b.files_copied}</td>
                      <td><button className="btn sm" disabled={busy} onClick={() => restore(b.name)}><Icon name="restore" size={13} />Restaurer</button></td>
                    </tr>
                  ))}
                  {!backups.length && <tr><td colSpan={5} className="empty small">Aucune sauvegarde pour l'instant.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad col">
            <h2>Dossier des données</h2>
            <div className="row"><input className="input mono small" readOnly value={cfg?.config.data_dir ?? ""} />
              <button className="btn" onClick={() => cfg?.config.data_dir && platform.revealPath(cfg.config.data_dir)}>Ouvrir</button>
            </div>
            <div className="small muted">Changer de dossier ouvre un autre jeu de données (les chantiers actuels ne sont pas déplacés). Pour transférer un chantier, utilisez l'export .zip.</div>
            <div><button className="btn" onClick={async () => {
              const d = await platform.pickFolder("Autre dossier de données");
              if (d && (await ui.confirm(<>Ouvrir le dossier <span className="mono">{d}</span> ? L'application va redémarrer.</>))) {
                await updCfg({ data_dir: d });
                window.location.reload();
              }
            }}><Icon name="folder" />Ouvrir un autre dossier de données…</button></div>
          </div>
        </div>
      </div>
    </>
  );
}
