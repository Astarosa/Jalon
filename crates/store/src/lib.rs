//! Moteur de stockage local de Jalon.
//!
//! - une base SQLite unique (`data.sqlite`) pilotée depuis l'interface par des requêtes paramétrées ;
//! - des fichiers rangés par empreinte SHA-256 (`fichiers/ab/cd/<sha>`) ;
//! - des tuiles de plans (`tuiles/<plan_version_id>/<z>/<x>_<y>.webp`) ;
//! - des sauvegardes horodatées (`VACUUM INTO`) + un réservoir de fichiers incrémental.
//!
//! Ce crate ne dépend pas de Tauri : il est utilisé à l'identique par l'application
//! et par le serveur de développement, ce qui permet de le tester hors Windows.

pub mod app;
pub mod config;
mod values;

use chrono::Local;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub use values::{json_to_sql, sql_row_to_json};

pub type Result<T> = std::result::Result<T, StoreError>;

#[derive(Debug)]
pub struct StoreError(pub String);

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for StoreError {}

macro_rules! from_err {
    ($t:ty) => {
        impl From<$t> for StoreError {
            fn from(e: $t) -> Self {
                StoreError(e.to_string())
            }
        }
    };
}
from_err!(rusqlite::Error);
from_err!(std::io::Error);
from_err!(serde_json::Error);

pub fn err<T>(msg: impl Into<String>) -> Result<T> {
    Err(StoreError(msg.into()))
}

pub const DB_FILE: &str = "data.sqlite";

#[derive(Debug, Clone, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
    /// "run" | "all" | "values" | "get"
    #[serde(default = "default_method")]
    pub method: String,
}
fn default_method() -> String {
    "all".into()
}

#[derive(Debug, Clone, Serialize)]
pub struct RunResult {
    pub changes: usize,
    pub last_insert_rowid: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupInfo {
    pub name: String,
    pub created_at: String,
    pub reason: String,
    pub db_bytes: u64,
    pub files_copied: u64,
}

pub struct Store {
    root: PathBuf,
    conn: Mutex<Option<Connection>>,
}

fn open_conn(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;",
    )?;
    Ok(conn)
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn is_safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Détection du type MIME par les premiers octets (fichiers servis à l'interface).
pub fn sniff_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"%PDF") {
        "application/pdf"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else {
        "application/octet-stream"
    }
}

impl Store {
    /// Ouvre (ou crée) un dossier de données.
    pub fn open(root: impl AsRef<Path>) -> Result<Store> {
        let root = root.as_ref().to_path_buf();
        for sub in ["fichiers", "tuiles", "rapports"] {
            fs::create_dir_all(root.join(sub))?;
        }
        let conn = open_conn(&root.join(DB_FILE))?;
        Ok(Store { root, conn: Mutex::new(Some(conn)) })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn with_conn<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut guard = self.conn.lock().map_err(|_| StoreError("verrou base".into()))?;
        match guard.as_mut() {
            Some(c) => f(c),
            None => err("base fermée"),
        }
    }

    // ------------------------------------------------------------------ SQL

    pub fn exec_script(&self, sql: &str) -> Result<()> {
        self.with_conn(|c| Ok(c.execute_batch(sql)?))
    }

    pub fn query(&self, sql: &str, params: &[Json]) -> Result<Vec<Vec<Json>>> {
        self.with_conn(|c| query_on(c, sql, params))
    }

    pub fn run(&self, sql: &str, params: &[Json]) -> Result<RunResult> {
        self.with_conn(|c| run_on(c, sql, params))
    }

    /// Exécute une série d'instructions dans une transaction unique.
    /// Retourne, pour chaque instruction : `[]` (run), la liste des lignes (all/values)
    /// ou la première ligne / null (get).
    pub fn batch(&self, stmts: &[Statement]) -> Result<Vec<Json>> {
        self.with_conn(|c| {
            let tx = c.transaction()?;
            let mut out = Vec::with_capacity(stmts.len());
            for s in stmts {
                out.push(exec_stmt(&tx, s)?);
            }
            tx.commit()?;
            Ok(out)
        })
    }

    pub fn exec(&self, s: &Statement) -> Result<Json> {
        self.with_conn(|c| exec_stmt(c, s))
    }

    // ------------------------------------------------------------- fichiers

    pub fn file_path(&self, sha: &str) -> Result<PathBuf> {
        if !is_hex64(sha) {
            return err("empreinte invalide");
        }
        Ok(self.root.join("fichiers").join(&sha[0..2]).join(&sha[2..4]).join(sha))
    }

    /// Enregistre un fichier et retourne son empreinte SHA-256 (sans doublon).
    pub fn put_file(&self, bytes: &[u8]) -> Result<String> {
        let sha = hex::encode(Sha256::digest(bytes));
        let path = self.file_path(&sha)?;
        if !path.exists() {
            fs::create_dir_all(path.parent().unwrap())?;
            let tmp = path.with_extension("tmp");
            fs::write(&tmp, bytes)?;
            fs::rename(&tmp, &path)?;
        }
        Ok(sha)
    }

    pub fn read_file(&self, sha: &str) -> Result<Vec<u8>> {
        Ok(fs::read(self.file_path(sha)?)?)
    }

    pub fn has_file(&self, sha: &str) -> bool {
        self.file_path(sha).map(|p| p.exists()).unwrap_or(false)
    }

    // --------------------------------------------------------------- tuiles

    /// Clé : `<plan_version_id>/<z>/<x>/<y>`
    pub fn tile_path(&self, key: &str) -> Result<PathBuf> {
        let parts: Vec<&str> = key.split('/').collect();
        if parts.len() != 4 || !is_safe_id(parts[0]) {
            return err("clé de tuile invalide");
        }
        let z: i32 = parts[1].parse().map_err(|_| StoreError("z invalide".into()))?;
        let x: u32 = parts[2].parse().map_err(|_| StoreError("x invalide".into()))?;
        let y: u32 = parts[3].trim_end_matches(".webp").parse().map_err(|_| StoreError("y invalide".into()))?;
        Ok(self.root.join("tuiles").join(parts[0]).join(z.to_string()).join(format!("{x}_{y}.webp")))
    }

    pub fn put_tile(&self, key: &str, bytes: &[u8]) -> Result<()> {
        let path = self.tile_path(key)?;
        fs::create_dir_all(path.parent().unwrap())?;
        fs::write(path, bytes)?;
        Ok(())
    }

    pub fn read_tile(&self, key: &str) -> Result<Vec<u8>> {
        Ok(fs::read(self.tile_path(key)?)?)
    }

    fn tiles_dir(&self, pvid: &str) -> Result<PathBuf> {
        if !is_safe_id(pvid) {
            return err("identifiant invalide");
        }
        Ok(self.root.join("tuiles").join(pvid))
    }

    /// Marque le jeu de tuiles d'une version de plan comme complet (avec ses paramètres).
    pub fn tiles_complete(&self, pvid: &str, meta: &Json) -> Result<()> {
        let dir = self.tiles_dir(pvid)?;
        fs::create_dir_all(&dir)?;
        fs::write(dir.join("complet.json"), serde_json::to_vec(meta)?)?;
        Ok(())
    }

    /// Paramètres du jeu de tuiles s'il est complet, sinon null (à régénérer).
    pub fn tiles_status(&self, pvid: &str) -> Result<Json> {
        let p = self.tiles_dir(pvid)?.join("complet.json");
        if p.exists() {
            Ok(serde_json::from_slice(&fs::read(p)?).unwrap_or(Json::Null))
        } else {
            Ok(Json::Null)
        }
    }

    pub fn delete_tiles(&self, pvid: &str) -> Result<()> {
        let dir = self.tiles_dir(pvid)?;
        if dir.exists() {
            fs::remove_dir_all(dir)?;
        }
        Ok(())
    }

    // ------------------------------------------------------------ rapports

    /// Écrit un fichier généré (rapport, export) dans `rapports/<sous-dossier>/<nom>`.
    pub fn write_report(&self, subdir: &str, name: &str, bytes: &[u8]) -> Result<PathBuf> {
        let clean = |s: &str| -> String {
            s.chars()
                .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
                .collect::<String>()
                .trim()
                .trim_matches('.')
                .to_string()
        };
        let (sd, nm) = (clean(subdir), clean(name));
        if nm.is_empty() {
            return err("nom de fichier vide");
        }
        let dir = if sd.is_empty() { self.root.join("rapports") } else { self.root.join("rapports").join(sd) };
        fs::create_dir_all(&dir)?;
        let path = dir.join(nm);
        fs::write(&path, bytes)?;
        Ok(path)
    }

    // ---------------------------------------------------------- sauvegardes

    /// Sauvegarde cohérente : copie de la base par `VACUUM INTO` + copie incrémentale des fichiers.
    /// Les sauvegardes « auto » et « fermeture » sont limitées aux `keep` plus récentes.
    pub fn backup(&self, backup_dir: impl AsRef<Path>, reason: &str, keep: usize) -> Result<BackupInfo> {
        let bdir = backup_dir.as_ref();
        let base = bdir.join("sauvegardes");
        fs::create_dir_all(&base)?;
        let now = Local::now();
        let mut name = format!("{}_{}", now.format("%Y-%m-%d_%H-%M-%S"), slug(reason));
        let mut n = 1;
        while base.join(&name).exists() {
            n += 1;
            name = format!("{}_{}-{}", now.format("%Y-%m-%d_%H-%M-%S"), slug(reason), n);
        }
        let dest = base.join(&name);
        fs::create_dir_all(&dest)?;
        let db_dest = dest.join(DB_FILE);
        let db_dest_str = db_dest.to_string_lossy().to_string();
        self.with_conn(|c| Ok(c.execute("VACUUM INTO ?1", [db_dest_str.as_str()]).map(|_| ())?))?;

        let files_copied = sync_tree(&self.root.join("fichiers"), &bdir.join("fichiers"))?;
        let info = BackupInfo {
            name: name.clone(),
            created_at: now.to_rfc3339(),
            reason: reason.to_string(),
            db_bytes: fs::metadata(&db_dest)?.len(),
            files_copied,
        };
        fs::write(dest.join("meta.json"), serde_json::to_vec_pretty(&info)?)?;
        prune(&base, keep)?;
        Ok(info)
    }

    pub fn list_backups(backup_dir: impl AsRef<Path>) -> Result<Vec<BackupInfo>> {
        let base = backup_dir.as_ref().join("sauvegardes");
        let mut out = vec![];
        if !base.exists() {
            return Ok(out);
        }
        for e in fs::read_dir(&base)? {
            let e = e?;
            let meta = e.path().join("meta.json");
            if meta.exists() && e.path().join(DB_FILE).exists() {
                if let Ok(info) = serde_json::from_slice::<BackupInfo>(&fs::read(meta)?) {
                    out.push(info);
                }
            }
        }
        out.sort_by(|a, b| b.name.cmp(&a.name));
        Ok(out)
    }

    /// Restaure une sauvegarde. Une sauvegarde de sécurité de l'état courant est faite avant.
    pub fn restore(&self, backup_dir: impl AsRef<Path>, name: &str) -> Result<BackupInfo> {
        let bdir = backup_dir.as_ref();
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return err("nom de sauvegarde invalide");
        }
        let src = bdir.join("sauvegardes").join(name).join(DB_FILE);
        if !src.exists() {
            return err("sauvegarde introuvable");
        }
        let safety = self.backup(bdir, "avant-restauration", usize::MAX)?;
        let mut guard = self.conn.lock().map_err(|_| StoreError("verrou base".into()))?;
        // Fermeture propre (checkpoint WAL) puis remplacement du fichier.
        if let Some(c) = guard.take() {
            c.close().map_err(|(_, e)| StoreError(e.to_string()))?;
        }
        let db = self.root.join(DB_FILE);
        for ext in ["-wal", "-shm"] {
            let p = PathBuf::from(format!("{}{}", db.to_string_lossy(), ext));
            if p.exists() {
                fs::remove_file(p)?;
            }
        }
        let tmp = self.root.join("data.sqlite.restauration");
        fs::copy(&src, &tmp)?;
        fs::rename(&tmp, &db)?;
        *guard = Some(open_conn(&db)?);
        drop(guard);
        // Fichiers manquants récupérés depuis le réservoir de sauvegarde.
        sync_tree(&bdir.join("fichiers"), &self.root.join("fichiers"))?;
        Ok(safety)
    }
}

fn slug(s: &str) -> String {
    let s: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "manuelle".into() } else { s }
}

/// Copie récursive des fichiers absents de la destination. Retourne le nombre copié.
fn sync_tree(src: &Path, dst: &Path) -> Result<u64> {
    let mut n = 0;
    if !src.exists() {
        return Ok(0);
    }
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)? {
        let e = e?;
        let p = e.path();
        let target = dst.join(e.file_name());
        if e.file_type()?.is_dir() {
            n += sync_tree(&p, &target)?;
        } else if !target.exists() && p.extension().map(|x| x != "tmp").unwrap_or(true) {
            let tmp = target.with_extension("tmp");
            fs::copy(&p, &tmp)?;
            fs::rename(&tmp, &target)?;
            n += 1;
        }
    }
    Ok(n)
}

fn prune(base: &Path, keep: usize) -> Result<()> {
    let mut rotating: Vec<String> = vec![];
    for e in fs::read_dir(base)? {
        let name = e?.file_name().to_string_lossy().to_string();
        if name.contains("_auto") || name.contains("_fermeture") {
            rotating.push(name);
        }
    }
    rotating.sort();
    rotating.reverse();
    for old in rotating.into_iter().skip(keep.max(1)) {
        fs::remove_dir_all(base.join(old))?;
    }
    Ok(())
}

fn query_on(c: &Connection, sql: &str, params: &[Json]) -> Result<Vec<Vec<Json>>> {
    let mut st = c.prepare_cached(sql)?;
    let ps: Vec<rusqlite::types::Value> = params.iter().map(json_to_sql).collect();
    let ncol = st.column_count();
    let mut rows = st.query(rusqlite::params_from_iter(ps))?;
    let mut out = vec![];
    while let Some(r) = rows.next()? {
        out.push(sql_row_to_json(r, ncol)?);
    }
    Ok(out)
}

fn run_on(c: &Connection, sql: &str, params: &[Json]) -> Result<RunResult> {
    let mut st = c.prepare_cached(sql)?;
    let ps: Vec<rusqlite::types::Value> = params.iter().map(json_to_sql).collect();
    let changes = st.execute(rusqlite::params_from_iter(ps))?;
    Ok(RunResult { changes, last_insert_rowid: c.last_insert_rowid() })
}

fn exec_stmt(c: &Connection, s: &Statement) -> Result<Json> {
    match s.method.as_str() {
        "run" => {
            run_on(c, &s.sql, &s.params)?;
            Ok(Json::Array(vec![]))
        }
        "get" => {
            let rows = query_on(c, &s.sql, &s.params)?;
            Ok(rows.into_iter().next().map(Json::Array).unwrap_or(Json::Null))
        }
        _ => {
            let rows = query_on(c, &s.sql, &s.params)?;
            Ok(Json::Array(rows.into_iter().map(Json::Array).collect()))
        }
    }
}

#[cfg(test)]
mod tests;
