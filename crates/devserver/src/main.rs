//! Serveur de développement (non livré) : mêmes commandes que l'application Tauri, en HTTP.
//! Usage : cargo run -p chantier-devserver -- <dossier-config>

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chantier_store::app::AppState;
use serde_json::Value;
use std::{collections::HashMap, sync::Arc};

type S = Arc<AppState>;

fn fail(e: impl ToString) -> Response {
    (StatusCode::BAD_REQUEST, e.to_string()).into_response()
}

async fn cmd(State(s): State<S>, Path(name): Path<String>, Json(args): Json<Value>) -> Response {
    let s2 = s.clone();
    match tokio::task::spawn_blocking(move || s2.dispatch(&name, &args)).await.unwrap() {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}

async fn bin(State(s): State<S>, Path(name): Path<String>, Query(q): Query<HashMap<String, String>>, body: Bytes) -> Response {
    let args = serde_json::to_value(q).unwrap();
    match tokio::task::spawn_blocking(move || s.dispatch_bin(&name, &args, &body)).await.unwrap() {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}

async fn asset(State(s): State<S>, Path(path): Path<String>) -> Response {
    match s.read_asset(&path) {
        Ok((b, mime)) => {
            let cache = if path.starts_with("f/") { "max-age=31536000, immutable" } else { "no-cache" };
            ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, cache)], b).into_response()
        }
        Err(e) => (StatusCode::NOT_FOUND, e.to_string()).into_response(),
    }
}

#[tokio::main]
async fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| "./.dev-config".into());
    let state: S = Arc::new(AppState::new(std::path::PathBuf::from(dir).join("config.json")));
    let app = Router::new()
        .route("/api/{name}", post(cmd))
        .route("/bin/{name}", post(bin))
        .route("/asset/{*path}", get(asset))
        .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024))
        .with_state(state);
    let addr = std::env::var("DEV_ADDR").unwrap_or_else(|_| "127.0.0.1:1421".into());
    println!("serveur de développement sur http://{addr}");
    let l = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(l, app).await.unwrap();
}
