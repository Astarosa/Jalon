//! Configuration de l'application (fichier `config.json` dans le dossier de configuration).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AppConfig {
    /// Dossier de données (base + fichiers + tuiles + rapports).
    pub data_dir: Option<String>,
    /// Dossier des sauvegardes. Ne pas utiliser le même disque que les données si possible.
    pub backup_dir: Option<String>,
    /// Intervalle des sauvegardes automatiques, en heures (0 = désactivé).
    pub backup_interval_hours: u32,
    /// Nombre de sauvegardes automatiques conservées.
    pub backup_keep: u32,
    /// Sauvegarde à la fermeture de l'application.
    pub backup_on_close: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            data_dir: None,
            backup_dir: None,
            backup_interval_hours: 4,
            backup_keep: 20,
            backup_on_close: true,
        }
    }
}

impl AppConfig {
    pub fn load(path: &Path) -> AppConfig {
        fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> crate::Result<()> {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p)?;
        }
        fs::write(path, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
}
