/** Export / import d'un chantier complet au format .zip (données + fichiers). */
import JSZip from "jszip";
import { getTableName, inArray, is, eq, sql } from "drizzle-orm";
import { SQLiteTable, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  schema, PROJECT_TABLES, EXPORT_FORMAT, EXPORT_VERSION, exportBundleSchema, nowIso, safeFileName, todayIso, type ExportBundle,
} from "@chantier/core";
import { db, bump } from "../data/db";
import { fetchBytes, platform, putFile } from "../platform";
import { getProject, listPlans } from "../data/repo";
import { ensureTiles } from "../pdf/pdf";

type AnyTable = SQLiteTable & Record<string, SQLiteColumn>;
const TABLES: Record<string, AnyTable> = Object.fromEntries(
  Object.values(schema).filter((t) => is(t, SQLiteTable)).map((t) => [getTableName(t as SQLiteTable), t as unknown as AnyTable]),
);
type Row = Record<string, unknown>;

async function rowsWhere(table: string, col: string, ids: string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const t = TABLES[table];
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 400) out.push(...((await db.select().from(t).where(inArray(t[col], ids.slice(i, i + 400)))) as Row[]));
  return out;
}
const ids = (rows: Row[], k = "id") => [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])];

export async function exportProjectZip(projectId: string, progress?: (m: string) => void): Promise<{ bytes: Uint8Array; name: string }> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Chantier introuvable");
  progress?.("Lecture des données");
  const t: Record<string, Row[]> = {};
  for (const n of ["lots", "project_companies", "plans", "visits", "tickets", "checklists"]) t[n] = await rowsWhere(n, "project_id", [projectId]);
  t.plan_versions = await rowsWhere("plan_versions", "plan_id", ids(t.plans));
  t.plan_calibrations = await rowsWhere("plan_calibrations", "plan_version_id", ids(t.plan_versions));
  t.measurements = await rowsWhere("measurements", "plan_version_id", ids(t.plan_versions));
  t.ticket_events = await rowsWhere("ticket_events", "ticket_id", ids(t.tickets));
  t.ticket_photos = await rowsWhere("ticket_photos", "ticket_id", ids(t.tickets));
  t.checklist_items = await rowsWhere("checklist_items", "checklist_id", ids(t.checklists));
  const companies = await rowsWhere("companies", "id", ids(t.project_companies, "company_id"));
  const templates = await rowsWhere("checklist_templates", "id", ids(t.checklists, "template_id"));
  const shas = new Set<string>();
  t.plan_versions.forEach((v) => shas.add(v.file_sha256 as string));
  t.ticket_photos.forEach((p) => ["file_sha256", "thumb_sha256", "rendu_sha256"].forEach((k) => p[k] && shas.add(p[k] as string)));
  const files = await rowsWhere("files", "sha256", [...shas]);

  const bundle: ExportBundle = {
    format: EXPORT_FORMAT, version: EXPORT_VERSION, exported_at: nowIso(), project: project as unknown as Row, companies,
    checklist_templates: templates, files, tables: Object.fromEntries(PROJECT_TABLES.map((n) => [n, t[n] ?? []])) as ExportBundle["tables"],
  };
  const zip = new JSZip();
  zip.file("chantier.json", JSON.stringify(bundle, null, 1));
  zip.file("LISEZMOI.txt", `Export du chantier « ${project.nom} » (Jalon, format ${EXPORT_FORMAT} v${EXPORT_VERSION}).\nÀ importer depuis l'écran « Chantiers » > « Importer un chantier ».\n`);
  let n = 0;
  for (const sha of shas) {
    progress?.(`Fichiers ${++n}/${shas.size}`);
    zip.file(`fichiers/${sha}`, await fetchBytes(platform.fileUrl(sha)), { binary: true, compression: "STORE" });
  }
  progress?.("Compression");
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 3 } });
  return { bytes, name: `${safeFileName(project.nom)}_${todayIso()}.zip` };
}

async function upsert(table: string, rows: Row[]) {
  const t = TABLES[table];
  if (!t || !rows.length) return;
  const cols = Object.keys(t).filter((k) => typeof (t as Row)[k] === "object" && (t as Row)[k] !== null && "name" in ((t as Row)[k] as object));
  const pk = table === "files" ? "sha256" : "id";
  const q = rows.map((r) => {
    const v = Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]]));
    const ins = db.insert(t).values(v as never);
    return table === "files" || !("updated_at" in t)
      ? ins.onConflictDoNothing()
      : ins.onConflictDoUpdate({ target: t[pk], set: v as never, setWhere: sql`excluded.updated_at > ${t.updated_at}` });
  });
  for (let i = 0; i < q.length; i += 200) await db.batch(q.slice(i, i + 200) as never);
}

/**
 * Import d'un export : les lignes inconnues sont créées ; une ligne déjà présente n'est remplacée
 * que si la version du fichier est plus récente.
 */
export async function importProjectZip(
  bytes: Uint8Array, confirmMerge: (nom: string) => Promise<boolean>, progress?: (m: string) => void,
): Promise<{ id: string; nom: string } | null> {
  const zip = await JSZip.loadAsync(bytes);
  const json = zip.file("chantier.json");
  if (!json) throw new Error("Ce fichier n'est pas un export de chantier (chantier.json absent)");
  const parsed = exportBundleSchema.safeParse(JSON.parse(await json.async("string")));
  if (!parsed.success) throw new Error("Export illisible ou d'une version plus récente de l'application");
  const b = parsed.data;
  const pid = b.project.id as string;
  const existing = (await db.select().from(schema.projects).where(eq(schema.projects.id, pid)))[0];
  if (existing && !(await confirmMerge(existing.nom))) return null;

  const entries = Object.keys(zip.files).filter((n) => n.startsWith("fichiers/") && !zip.files[n].dir);
  let n = 0;
  for (const name of entries) {
    progress?.(`Fichiers ${++n}/${entries.length}`);
    const sha = await putFile(await zip.files[name].async("uint8array"));
    if (sha !== name.slice(9)) throw new Error(`Fichier corrompu dans l'export : ${name}`);
  }
  progress?.("Données");
  await upsert("files", b.files);
  await upsert("companies", b.companies);
  await upsert("checklist_templates", b.checklist_templates);
  await upsert("projects", [b.project]);
  for (const tname of PROJECT_TABLES) await upsert(tname, b.tables[tname]);
  bump();
  progress?.("Préparation des plans");
  for (const p of await listPlans(pid)) if (p.current) await ensureTiles(p.current.id, p.current.file_sha256, p.current.page_index).catch(() => {});
  bump();
  return { id: pid, nom: b.project.nom as string };
}
