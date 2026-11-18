/**
 * Accès au moteur local. Deux transports, mêmes commandes :
 * - Tauri (application Windows) : `invoke` + protocole `chantier://` pour les fichiers et tuiles ;
 * - serveur de développement (navigateur) : HTTP vers `crates/devserver`.
 */
import { tauriPlatform } from "./tauri";
import { devPlatform } from "./dev";

export interface AppConfig {
  data_dir: string | null;
  backup_dir: string | null;
  backup_interval_hours: number;
  backup_keep: number;
  backup_on_close: boolean;
}
export interface ConfigState {
  config: AppConfig;
  dataDirOpen: boolean;
  effectiveBackupDir: string | null;
}
export interface BackupInfo {
  name: string;
  created_at: string;
  reason: string;
  db_bytes: number;
  files_copied: number;
}
export interface Stmt {
  sql: string;
  params: unknown[];
  method: "run" | "all" | "values" | "get";
}

export interface Platform {
  kind: "tauri" | "dev";
  call<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  callBin<T = unknown>(cmd: string, bytes: Uint8Array, args?: Record<string, string>): Promise<T>;
  fileUrl(sha: string): string;
  tileUrl(pvid: string, z: number, x: number, y: number, rev?: number): string;
  /** Choix d'un dossier (null si annulé ou indisponible) */
  pickFolder(title: string): Promise<string | null>;
  /** Enregistrer sous… Retourne le chemin choisi, ou null. En mode navigateur : téléchargement. */
  saveAs(bytes: Uint8Array, defaultName: string, filterName: string, ext: string): Promise<string | null>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const platform: Platform = isTauri() ? tauriPlatform() : devPlatform();

// ------------------------------------------------------------------ raccourcis

export const getConfig = () => platform.call<ConfigState>("get_config");
export const setConfig = (config: AppConfig) => platform.call<ConfigState>("set_config", { config });
export const dbExec = (stmt: Stmt) => platform.call<unknown>("db_exec", { stmt });
export const dbBatch = (stmts: Stmt[]) => platform.call<unknown[]>("db_batch", { stmts });
export const dbScript = (sql: string) => platform.call<void>("db_script", { sql });
export const putFile = (bytes: Uint8Array) => platform.callBin<string>("file_put", bytes);
export const hasFile = (sha: string) => platform.call<boolean>("has_file", { sha });
export const putTile = (key: string, bytes: Uint8Array) => platform.callBin<null>("tile_put", bytes, { key });
export const tilesComplete = (pvid: string, meta: unknown) => platform.call("tiles_complete", { pvid, meta });
export const tilesStatus = <T>(pvid: string) => platform.call<T | null>("tiles_status", { pvid });
export const tilesDelete = (pvid: string) => platform.call("tiles_delete", { pvid });
export const writeReport = (subdir: string, name: string, bytes: Uint8Array) =>
  platform.callBin<string>("report_write", bytes, { subdir, name });
export const backupNow = (reason = "manuelle") => platform.call<BackupInfo>("backup_now", { reason });
export const listBackups = () => platform.call<BackupInfo[]>("backups_list");
export const restoreBackup = (name: string) => platform.call<BackupInfo>("backup_restore", { name });

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Lecture impossible (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
