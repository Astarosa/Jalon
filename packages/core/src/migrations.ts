/**
 * Migrations SQL, appliquées dans l'ordre selon `PRAGMA user_version`.
 * Ne jamais modifier une migration publiée : en ajouter une nouvelle.
 */
const BASE = `id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT`;

export const MIGRATIONS: string[] = [
  /* 1 — schéma initial */ `
CREATE TABLE projects (${BASE}, nom TEXT NOT NULL, reference TEXT, adresse TEXT, moa TEXT,
  date_debut TEXT, date_fin TEXT, archive INTEGER NOT NULL DEFAULT 0, notes TEXT);
CREATE TABLE lots (${BASE}, project_id TEXT NOT NULL, code TEXT, nom TEXT NOT NULL, couleur TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0);
CREATE TABLE companies (${BASE}, nom TEXT NOT NULL, contact TEXT, email TEXT, telephone TEXT, adresse TEXT, notes TEXT);
CREATE TABLE project_companies (${BASE}, project_id TEXT NOT NULL, company_id TEXT NOT NULL, lot_id TEXT);
CREATE TABLE plans (${BASE}, project_id TEXT NOT NULL, nom TEXT NOT NULL, niveau TEXT, ordre INTEGER NOT NULL DEFAULT 0);
CREATE TABLE plan_versions (${BASE}, plan_id TEXT NOT NULL, indice TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  nom_fichier TEXT, page_index INTEGER NOT NULL DEFAULT 0, largeur_pt REAL NOT NULL, hauteur_pt REAL NOT NULL,
  courant INTEGER NOT NULL DEFAULT 1, notes TEXT);
CREATE TABLE plan_calibrations (${BASE}, plan_version_id TEXT NOT NULL, nom TEXT, zone TEXT, methode TEXT NOT NULL,
  p1x REAL, p1y REAL, p2x REAL, p2y REAL, longueur_reelle_m REAL, ratio INTEGER, metres_par_point REAL NOT NULL,
  controle_attendu_m REAL, controle_mesure_m REAL);
CREATE TABLE measurements (${BASE}, plan_version_id TEXT NOT NULL, ticket_id TEXT, type TEXT NOT NULL,
  points TEXT NOT NULL, libelle TEXT, couleur TEXT);
CREATE TABLE tickets (${BASE}, project_id TEXT NOT NULL, numero INTEGER NOT NULL, plan_version_id TEXT, x REAL, y REAL,
  type TEXT NOT NULL, lot_id TEXT, company_id TEXT, titre TEXT NOT NULL, description TEXT, localisation TEXT,
  statut TEXT NOT NULL, priorite TEXT NOT NULL, echeance TEXT, visit_id TEXT);
CREATE TABLE ticket_events (${BASE}, ticket_id TEXT NOT NULL, visit_id TEXT, type TEXT NOT NULL, champ TEXT,
  ancien TEXT, nouveau TEXT, texte TEXT, date TEXT NOT NULL);
CREATE TABLE ticket_photos (${BASE}, ticket_id TEXT NOT NULL, file_sha256 TEXT NOT NULL, thumb_sha256 TEXT,
  rendu_sha256 TEXT, largeur INTEGER, hauteur INTEGER, date_prise TEXT, legende TEXT, annotations TEXT,
  ordre INTEGER NOT NULL DEFAULT 0);
CREATE TABLE visits (${BASE}, project_id TEXT NOT NULL, date TEXT NOT NULL, titre TEXT, participants TEXT, meteo TEXT,
  notes TEXT, cloturee INTEGER NOT NULL DEFAULT 0);
CREATE TABLE checklist_templates (${BASE}, nom TEXT NOT NULL, description TEXT, items TEXT NOT NULL);
CREATE TABLE checklists (${BASE}, project_id TEXT NOT NULL, ticket_id TEXT, visit_id TEXT, template_id TEXT, nom TEXT NOT NULL);
CREATE TABLE checklist_items (${BASE}, checklist_id TEXT NOT NULL, libelle TEXT NOT NULL, etat TEXT NOT NULL, note TEXT,
  ordre INTEGER NOT NULL DEFAULT 0);
CREATE TABLE files (sha256 TEXT PRIMARY KEY, nom_origine TEXT, mime TEXT, taille INTEGER, created_at TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

CREATE INDEX ix_lots_project ON lots(project_id);
CREATE INDEX ix_pc_project ON project_companies(project_id);
CREATE INDEX ix_plans_project ON plans(project_id);
CREATE INDEX ix_pv_plan ON plan_versions(plan_id);
CREATE INDEX ix_cal_pv ON plan_calibrations(plan_version_id);
CREATE INDEX ix_meas_pv ON measurements(plan_version_id);
CREATE INDEX ix_tickets_project ON tickets(project_id);
CREATE INDEX ix_tickets_pv ON tickets(plan_version_id);
CREATE INDEX ix_events_ticket ON ticket_events(ticket_id);
CREATE INDEX ix_photos_ticket ON ticket_photos(ticket_id);
CREATE INDEX ix_visits_project ON visits(project_id);
CREATE INDEX ix_cl_project ON checklists(project_id);
CREATE INDEX ix_cli_cl ON checklist_items(checklist_id);
`,
];

/** Applique les migrations manquantes via un exécuteur de script SQL. */
export async function migrate(
  getVersion: () => Promise<number>,
  runScript: (sql: string) => Promise<void>,
): Promise<number> {
  let v = await getVersion();
  for (let i = v; i < MIGRATIONS.length; i++) {
    await runScript(`BEGIN;\n${MIGRATIONS[i]}\nPRAGMA user_version = ${i + 1};\nCOMMIT;`);
    v = i + 1;
  }
  return v;
}
