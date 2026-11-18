//! Point d'entrée unique des commandes appelées par l'interface.
//! Utilisé tel quel par l'application Tauri et par le serveur de développement.

use crate::config::AppConfig;
use crate::{err, Result, Statement, Store, StoreError};
use serde_json::{json, Value as Json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

pub struct AppState {
    config_path: PathBuf,
    config: Mutex<AppConfig>,
    store: RwLock<Option<Arc<Store>>>,
}

fn arg_str<'a>(args: &'a Json, k: &str) -> Result<&'a str> {
    args.get(k).and_then(|v| v.as_str()).ok_or_else(|| StoreError(format!("paramètre manquant : {k}")))
}

impl AppState {
    pub fn new(config_path: PathBuf) -> AppState {
        let config = AppConfig::load(&config_path);
        let st = AppState { config_path, config: Mutex::new(config.clone()), store: RwLock::new(None) };
        if let Some(dir) = &config.data_dir {
            if let Ok(s) = Store::open(dir) {
                *st.store.write().unwrap() = Some(Arc::new(s));
            }
        }
        st
    }

    pub fn config(&self) -> AppConfig {
        self.config.lock().unwrap().clone()
    }

    pub fn store(&self) -> Result<Arc<Store>> {
        self.store.read().unwrap().clone().ok_or_else(|| StoreError("aucun dossier de données ouvert".into()))
    }

    /// Dossier de sauvegarde effectif (par défaut : `<dossier de données> - sauvegardes`).
    pub fn backup_dir(&self) -> Option<PathBuf> {
        let c = self.config();
        match (c.backup_dir, c.data_dir) {
            (Some(b), _) if !b.is_empty() => Some(PathBuf::from(b)),
            (_, Some(d)) => {
                let p = PathBuf::from(&d);
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or("donnees".into());
                Some(p.with_file_name(format!("{name} - sauvegardes")))
            }
            _ => None,
        }
    }

    fn config_json(&self) -> Json {
        let c = self.config();
        json!({
            "config": c,
            "dataDirOpen": self.store.read().unwrap().is_some(),
            "effectiveBackupDir": self.backup_dir().map(|p| p.to_string_lossy().to_string()),
        })
    }

    fn set_config(&self, new: AppConfig) -> Result<Json> {
        let old = self.config();
        if new.data_dir != old.data_dir {
            let opened = match &new.data_dir {
                Some(d) if !d.is_empty() => Some(Arc::new(Store::open(d)?)),
                _ => None,
            };
            *self.store.write().unwrap() = opened;
        }
        new.save(&self.config_path)?;
        *self.config.lock().unwrap() = new;
        Ok(self.config_json())
    }

    /// Sauvegarde (appelée aussi à la fermeture de l'application).
    pub fn backup(&self, reason: &str) -> Result<Json> {
        let dir = self.backup_dir().ok_or_else(|| StoreError("dossier de sauvegarde non défini".into()))?;
        let keep = self.config().backup_keep.max(1) as usize;
        Ok(serde_json::to_value(self.store()?.backup(dir, reason, keep)?)?)
    }

    pub fn dispatch(&self, cmd: &str, args: &Json) -> Result<Json> {
        match cmd {
            "get_config" => Ok(self.config_json()),
            "set_config" => {
                let c: AppConfig = serde_json::from_value(args.get("config").cloned().unwrap_or(Json::Null))?;
                self.set_config(c)
            }
            "db_exec" => {
                let s: Statement = serde_json::from_value(args.get("stmt").cloned().unwrap_or(Json::Null))?;
                self.store()?.exec(&s)
            }
            "db_batch" => {
                let s: Vec<Statement> = serde_json::from_value(args.get("stmts").cloned().unwrap_or(Json::Null))?;
                Ok(Json::Array(self.store()?.batch(&s)?))
            }
            "db_script" => {
                self.store()?.exec_script(arg_str(args, "sql")?)?;
                Ok(Json::Null)
            }
            "has_file" => Ok(Json::Bool(self.store()?.has_file(arg_str(args, "sha")?))),
            "tiles_complete" => {
                self.store()?.tiles_complete(arg_str(args, "pvid")?, args.get("meta").unwrap_or(&Json::Null))?;
                Ok(Json::Null)
            }
            "tiles_status" => self.store()?.tiles_status(arg_str(args, "pvid")?),
            "tiles_delete" => {
                self.store()?.delete_tiles(arg_str(args, "pvid")?)?;
                Ok(Json::Null)
            }
            "backup_now" => self.backup(args.get("reason").and_then(|v| v.as_str()).unwrap_or("manuelle")),
            "backups_list" => match self.backup_dir() {
                Some(d) => Ok(serde_json::to_value(Store::list_backups(d)?)?),
                None => Ok(json!([])),
            },
            "backup_restore" => {
                let dir = self.backup_dir().ok_or_else(|| StoreError("dossier de sauvegarde non défini".into()))?;
                Ok(serde_json::to_value(self.store()?.restore(dir, arg_str(args, "name")?)?)?)
            }
            "data_dir" => Ok(json!(self.store()?.root().to_string_lossy())),
            _ => err(format!("commande inconnue : {cmd}")),
        }
    }

    /// Commandes recevant des octets bruts.
    pub fn dispatch_bin(&self, cmd: &str, args: &Json, bytes: &[u8]) -> Result<Json> {
        match cmd {
            "file_put" => Ok(json!(self.store()?.put_file(bytes)?)),
            "tile_put" => {
                self.store()?.put_tile(arg_str(args, "key")?, bytes)?;
                Ok(Json::Null)
            }
            "report_write" => {
                let p = self.store()?.write_report(
                    args.get("subdir").and_then(|v| v.as_str()).unwrap_or(""),
                    arg_str(args, "name")?,
                    bytes,
                )?;
                Ok(json!(p.to_string_lossy()))
            }
            _ => err(format!("commande inconnue : {cmd}")),
        }
    }

    /// Lecture pour le protocole de fichiers : `f/<sha>` ou `t/<pvid>/<z>/<x>/<y>.webp`.
    pub fn read_asset(&self, path: &str) -> Result<(Vec<u8>, &'static str)> {
        let path = path.trim_start_matches('/');
        let store = self.store()?;
        if let Some(sha) = path.strip_prefix("f/") {
            let b = store.read_file(sha)?;
            let m = crate::sniff_mime(&b);
            Ok((b, m))
        } else if let Some(key) = path.strip_prefix("t/") {
            Ok((store.read_tile(key)?, "image/webp"))
        } else {
            err("chemin inconnu")
        }
    }
}
