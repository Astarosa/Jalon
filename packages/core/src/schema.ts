/**
 * Schéma de données (SQLite). Partagé avec le futur produit collaboratif :
 * UUID partout, horodatages, suppression logique (`deleted_at`).
 * Les dates sont des chaînes ISO 8601.
 */
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

const base = {
  id: text("id").primaryKey(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  deleted_at: text("deleted_at"),
};

export const projects = sqliteTable("projects", {
  ...base,
  nom: text("nom").notNull(),
  reference: text("reference"),
  adresse: text("adresse"),
  moa: text("moa"),
  date_debut: text("date_debut"),
  date_fin: text("date_fin"),
  archive: integer("archive", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
});

export const lots = sqliteTable("lots", {
  ...base,
  project_id: text("project_id").notNull(),
  code: text("code"),
  nom: text("nom").notNull(),
  couleur: text("couleur").notNull(),
  ordre: integer("ordre").notNull().default(0),
});

export const companies = sqliteTable("companies", {
  ...base,
  nom: text("nom").notNull(),
  contact: text("contact"),
  email: text("email"),
  telephone: text("telephone"),
  adresse: text("adresse"),
  notes: text("notes"),
});

export const projectCompanies = sqliteTable("project_companies", {
  ...base,
  project_id: text("project_id").notNull(),
  company_id: text("company_id").notNull(),
  lot_id: text("lot_id"),
});

export const plans = sqliteTable("plans", {
  ...base,
  project_id: text("project_id").notNull(),
  nom: text("nom").notNull(),
  niveau: text("niveau"),
  ordre: integer("ordre").notNull().default(0),
});

export const planVersions = sqliteTable("plan_versions", {
  ...base,
  plan_id: text("plan_id").notNull(),
  indice: text("indice").notNull(),
  file_sha256: text("file_sha256").notNull(),
  nom_fichier: text("nom_fichier"),
  page_index: integer("page_index").notNull().default(0),
  largeur_pt: real("largeur_pt").notNull(),
  hauteur_pt: real("hauteur_pt").notNull(),
  courant: integer("courant", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
});

export const planCalibrations = sqliteTable("plan_calibrations", {
  ...base,
  plan_version_id: text("plan_version_id").notNull(),
  nom: text("nom"),
  /** JSON {x0,y0,x1,y1} en coordonnées relatives ; null = page entière */
  zone: text("zone"),
  /** 'pdf' | 'ratio' | 'deux_points' */
  methode: text("methode").notNull(),
  p1x: real("p1x"),
  p1y: real("p1y"),
  p2x: real("p2x"),
  p2y: real("p2y"),
  longueur_reelle_m: real("longueur_reelle_m"),
  ratio: integer("ratio"),
  metres_par_point: real("metres_par_point").notNull(),
  controle_attendu_m: real("controle_attendu_m"),
  controle_mesure_m: real("controle_mesure_m"),
});

export const measurements = sqliteTable("measurements", {
  ...base,
  plan_version_id: text("plan_version_id").notNull(),
  ticket_id: text("ticket_id"),
  /** 'distance' | 'polyligne' | 'surface' */
  type: text("type").notNull(),
  /** JSON [{x,y}] en coordonnées relatives */
  points: text("points").notNull(),
  libelle: text("libelle"),
  couleur: text("couleur"),
});

export const tickets = sqliteTable("tickets", {
  ...base,
  project_id: text("project_id").notNull(),
  numero: integer("numero").notNull(),
  plan_version_id: text("plan_version_id"),
  x: real("x"),
  y: real("y"),
  type: text("type").notNull(),
  lot_id: text("lot_id"),
  company_id: text("company_id"),
  titre: text("titre").notNull(),
  description: text("description"),
  localisation: text("localisation"),
  statut: text("statut").notNull(),
  priorite: text("priorite").notNull(),
  echeance: text("echeance"),
  visit_id: text("visit_id"),
});

export const ticketEvents = sqliteTable("ticket_events", {
  ...base,
  ticket_id: text("ticket_id").notNull(),
  visit_id: text("visit_id"),
  /** 'creation' | 'statut' | 'modification' | 'commentaire' | 'photo' | 'migration_indice' */
  type: text("type").notNull(),
  champ: text("champ"),
  ancien: text("ancien"),
  nouveau: text("nouveau"),
  texte: text("texte"),
  date: text("date").notNull(),
});

export const ticketPhotos = sqliteTable("ticket_photos", {
  ...base,
  ticket_id: text("ticket_id").notNull(),
  file_sha256: text("file_sha256").notNull(),
  thumb_sha256: text("thumb_sha256"),
  /** Image aplatie avec annotations (pour les rapports) */
  rendu_sha256: text("rendu_sha256"),
  largeur: integer("largeur"),
  hauteur: integer("hauteur"),
  date_prise: text("date_prise"),
  legende: text("legende"),
  /** JSON : liste de formes (voir annotations.ts) */
  annotations: text("annotations"),
  ordre: integer("ordre").notNull().default(0),
});

export const visits = sqliteTable("visits", {
  ...base,
  project_id: text("project_id").notNull(),
  date: text("date").notNull(),
  titre: text("titre"),
  participants: text("participants"),
  meteo: text("meteo"),
  notes: text("notes"),
  cloturee: integer("cloturee", { mode: "boolean" }).notNull().default(false),
});

export const checklistTemplates = sqliteTable("checklist_templates", {
  ...base,
  nom: text("nom").notNull(),
  description: text("description"),
  /** JSON : liste de libellés */
  items: text("items").notNull(),
});

export const checklists = sqliteTable("checklists", {
  ...base,
  project_id: text("project_id").notNull(),
  ticket_id: text("ticket_id"),
  visit_id: text("visit_id"),
  template_id: text("template_id"),
  nom: text("nom").notNull(),
});

export const checklistItems = sqliteTable("checklist_items", {
  ...base,
  checklist_id: text("checklist_id").notNull(),
  libelle: text("libelle").notNull(),
  /** 'a_faire' | 'ok' | 'nok' | 'na' */
  etat: text("etat").notNull(),
  note: text("note"),
  ordre: integer("ordre").notNull().default(0),
});

export const files = sqliteTable("files", {
  sha256: text("sha256").primaryKey(),
  nom_origine: text("nom_origine"),
  mime: text("mime"),
  taille: integer("taille"),
  created_at: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export type Project = typeof projects.$inferSelect;
export type Lot = typeof lots.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type ProjectCompany = typeof projectCompanies.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type PlanVersion = typeof planVersions.$inferSelect;
export type PlanCalibration = typeof planCalibrations.$inferSelect;
export type Measurement = typeof measurements.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketEvent = typeof ticketEvents.$inferSelect;
export type TicketPhoto = typeof ticketPhotos.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type Checklist = typeof checklists.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type FileRow = typeof files.$inferSelect;

/** Tables synchronisables / exportables d'un chantier, dans l'ordre d'import. */
export const PROJECT_TABLES = [
  "lots",
  "project_companies",
  "plans",
  "plan_versions",
  "plan_calibrations",
  "measurements",
  "visits",
  "tickets",
  "ticket_events",
  "ticket_photos",
  "checklists",
  "checklist_items",
] as const;
export type ProjectTable = (typeof PROJECT_TABLES)[number];
