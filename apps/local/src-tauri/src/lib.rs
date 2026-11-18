//! Couche Tauri : relaie l'interface vers le moteur `chantier-store`.
//! Toute la logique (base, fichiers, tuiles, sauvegardes) est dans le crate partagé,
//! testé indépendamment ; ce fichier ne fait que la plomberie.

use chantier_store::app::AppState;
use serde_json::Value;
use std::sync::Arc;
use tauri::http::{header, Response, StatusCode};
use tauri::ipc::{InvokeBody, Request};
use tauri::{Manager, State};

type S = Arc<AppState>;

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn header_str(req: &Request<'_>, name: &str) -> Result<String, String> {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or_else(|| format!("en-tête manquant : {name}"))
}

fn raw_body(req: &Request<'_>) -> Result<Vec<u8>, String> {
    match req.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        _ => Err("corps binaire attendu".into()),
    }
}

/// Commandes JSON (base de données, configuration, sauvegardes…).
#[tauri::command]
async fn cmd(state: State<'_, S>, name: String, args: Value) -> Result<Value, String> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || s.dispatch(&name, &args))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Commandes recevant des octets (fichiers, tuiles, rapports).
#[tauri::command]
async fn cmd_bin(state: State<'_, S>, request: Request<'_>) -> Result<Value, String> {
    let name = header_str(&request, "x-cmd")?;
    let args: Value = serde_json::from_str(&header_str(&request, "x-args")?).map_err(|e| e.to_string())?;
    let bytes = raw_body(&request)?;
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || s.dispatch_bin(&name, &args, &bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// « Enregistrer sous » : écriture à l'emplacement choisi par l'utilisateur dans la boîte de dialogue.
#[tauri::command]
async fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = header_str(&request, "x-path")?;
    let bytes = raw_body(&request)?;
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            app.manage::<S>(Arc::new(AppState::new(dir.join("config.json"))));
            Ok(())
        })
        // Fichiers (f/<sha256>) et tuiles (t/<plan_version>/<z>/<x>/<y>.webp) servis à l'interface
        .register_asynchronous_uri_scheme_protocol("chantier", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = percent_decode(request.uri().path());
            std::thread::spawn(move || {
                let state = app.state::<S>();
                let resp = match state.read_asset(&path) {
                    Ok((bytes, mime)) => Response::builder()
                        .header(header::CONTENT_TYPE, mime)
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .header(
                            header::CACHE_CONTROL,
                            if path.trim_start_matches('/').starts_with("f/") { "max-age=31536000, immutable" } else { "no-cache" },
                        )
                        .body(bytes),
                    Err(e) => Response::builder()
                        .status(StatusCode::NOT_FOUND)
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(e.to_string().into_bytes()),
                };
                responder.respond(resp.unwrap_or_else(|_| Response::new(Vec::new())));
            });
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<S>();
                if state.config().backup_on_close && state.store().is_ok() {
                    // Sauvegarde synchrone : la fenêtre se ferme une fois la copie terminée.
                    let _ = state.backup("fermeture");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![cmd, cmd_bin, write_file])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Jalon");
}
