import { describe, it, expect } from "vitest";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { eq } from "drizzle-orm";
import { MIGRATIONS, migrate, schema, uuid, nowIso } from "../src";

describe("schéma Drizzle ↔ migrations SQL", () => {
  it("chaque table du schéma accepte un aller-retour complet", async () => {
    const SQL = await initSqlJs();
    const raw = new SQL.Database();
    await migrate(async () => raw.exec("PRAGMA user_version")[0].values[0][0] as number, async (s) => { raw.exec(s); });
    expect(raw.exec("PRAGMA user_version")[0].values[0][0]).toBe(MIGRATIONS.length);

    const db = drizzle(async (sql, params, method) => {
      const st = raw.prepare(sql);
      st.bind(params as never);
      const rows: unknown[][] = [];
      while (st.step()) rows.push(st.get());
      st.free();
      return { rows: method === "get" ? (rows[0] as never) : (rows as never) };
    }, { schema });

    const ts = { created_at: nowIso(), updated_at: nowIso() };
    const pid = uuid();
    await db.insert(schema.projects).values({ id: pid, nom: "Résidence Les Tilleuls", ...ts });
    await db.insert(schema.tickets).values({
      id: uuid(), project_id: pid, numero: 1, type: "reserve", titre: "Fissure", statut: "ouvert",
      priorite: "normale", x: 0.5, y: 0.25, ...ts,
    });
    await db.insert(schema.planCalibrations).values({
      id: uuid(), plan_version_id: uuid(), methode: "deux_points", metres_par_point: 0.0353,
      zone: JSON.stringify({ x0: 0, y0: 0, x1: 0.5, y1: 0.5 }), ...ts,
    });
    const p = await db.select().from(schema.projects).where(eq(schema.projects.id, pid));
    expect(p[0].nom).toBe("Résidence Les Tilleuls");
    expect(p[0].archive).toBe(false);
    const t = await db.select().from(schema.tickets);
    expect(t[0].y).toBe(0.25);
    // toutes les tables déclarées existent bien en SQL avec les mêmes colonnes
    const { getTableName, is } = await import("drizzle-orm");
    const { SQLiteTable } = await import("drizzle-orm/sqlite-core");
    const names: string[] = [];
    for (const table of Object.values(schema)) {
      if (!is(table, SQLiteTable)) continue;
      names.push(getTableName(table));
      await db.select().from(table).limit(1);
    }
    expect(names.length).toBe(17);
  });
});
