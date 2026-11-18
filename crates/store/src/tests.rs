use super::*;
use serde_json::json;

fn store() -> (tempfile::TempDir, Store) {
    let d = tempfile::tempdir().unwrap();
    let s = Store::open(d.path().join("data")).unwrap();
    s.exec_script("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, r REAL, b INTEGER, s TEXT);").unwrap();
    (d, s)
}

#[test]
fn sql_roundtrip_types() {
    let (_d, s) = store();
    s.run("INSERT INTO t VALUES (?,?,?,?,?)", &[json!("a"), json!(42), json!(1.5), json!(true), json!(null)]).unwrap();
    let rows = s.query("SELECT id, n, r, b, s FROM t", &[]).unwrap();
    assert_eq!(rows, vec![vec![json!("a"), json!(42), json!(1.5), json!(1), json!(null)]]);
}

#[test]
fn batch_is_atomic() {
    let (_d, s) = store();
    let ok = s.batch(&[
        Statement { sql: "INSERT INTO t (id) VALUES (?)".into(), params: vec![json!("x")], method: "run".into() },
        Statement { sql: "SELECT id FROM t".into(), params: vec![], method: "get".into() },
    ]);
    assert_eq!(ok.unwrap()[1], json!(["x"]));
    let bad = s.batch(&[
        Statement { sql: "INSERT INTO t (id) VALUES (?)".into(), params: vec![json!("y")], method: "run".into() },
        Statement { sql: "INSERT INTO t (id) VALUES (?)".into(), params: vec![json!("x")], method: "run".into() },
    ]);
    assert!(bad.is_err());
    assert_eq!(s.query("SELECT count(*) FROM t", &[]).unwrap()[0][0], json!(1));
}

#[test]
fn files_are_content_addressed() {
    let (_d, s) = store();
    let a = s.put_file(b"bonjour").unwrap();
    let b = s.put_file(b"bonjour").unwrap();
    assert_eq!(a, b);
    assert_eq!(s.read_file(&a).unwrap(), b"bonjour");
    assert!(s.file_path("../etc").is_err());
}

#[test]
fn tiles() {
    let (_d, s) = store();
    let id = "0b6c1f9e-1111-4222-8333-444455556666";
    s.put_tile(&format!("{id}/-2/0/1"), b"img").unwrap();
    assert_eq!(s.read_tile(&format!("{id}/-2/0/1.webp")).unwrap(), b"img");
    assert!(s.tile_path("../x/1/1/1").is_err());
    assert_eq!(s.tiles_status(id).unwrap(), Json::Null);
    s.tiles_complete(id, &json!({"zmax": 2})).unwrap();
    assert_eq!(s.tiles_status(id).unwrap()["zmax"], json!(2));
    s.delete_tiles(id).unwrap();
    assert_eq!(s.tiles_status(id).unwrap(), Json::Null);
}

#[test]
fn backup_and_restore() {
    let (d, s) = store();
    let bdir = d.path().join("sauv");
    s.run("INSERT INTO t (id) VALUES ('avant')", &[]).unwrap();
    let sha = s.put_file(b"photo").unwrap();
    let info = s.backup(&bdir, "manuelle", 5).unwrap();
    assert_eq!(info.files_copied, 1);
    s.run("DELETE FROM t", &[]).unwrap();
    std::fs::remove_file(s.file_path(&sha).unwrap()).unwrap();
    s.restore(&bdir, &info.name).unwrap();
    assert_eq!(s.query("SELECT id FROM t", &[]).unwrap(), vec![vec![json!("avant")]]);
    assert!(s.has_file(&sha));
    let list = Store::list_backups(&bdir).unwrap();
    assert_eq!(list.len(), 2); // + sauvegarde de sécurité
}

#[test]
fn backup_rotation_keeps_manual() {
    let (d, s) = store();
    let bdir = d.path().join("sauv");
    s.backup(&bdir, "manuelle", 2).unwrap();
    for _ in 0..4 {
        s.backup(&bdir, "auto", 2).unwrap();
    }
    let list = Store::list_backups(&bdir).unwrap();
    assert_eq!(list.iter().filter(|b| b.reason == "auto").count(), 2);
    assert_eq!(list.iter().filter(|b| b.reason == "manuelle").count(), 1);
}

#[test]
fn reports_are_sanitized() {
    let (_d, s) = store();
    let p = s.write_report("Chantier: A/B", "rapport?.pdf", b"%PDF").unwrap();
    assert!(p.ends_with("rapports/Chantier_ A_B/rapport_.pdf"));
}

#[test]
fn mime() {
    assert_eq!(sniff_mime(b"%PDF-1.7"), "application/pdf");
    assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
}
