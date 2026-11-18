import { drizzle } from "drizzle-orm/sqlite-proxy";
import { migrate, schema } from "@chantier/core";
import { dbBatch, dbExec, dbScript, type Stmt } from "../platform";

export const db = drizzle(
  async (sql, params, method) => {
    const rows = await dbExec({ sql, params, method } as Stmt);
    return { rows: (rows ?? undefined) as never };
  },
  async (queries) => {
    const res = await dbBatch(queries.map((q) => ({ sql: q.sql, params: q.params, method: q.method }) as Stmt));
    return res.map((rows) => ({ rows: (rows ?? undefined) as never }));
  },
  { schema },
);

export type DB = typeof db;

export async function initDatabase(): Promise<number> {
  return migrate(
    async () => {
      const r = (await dbExec({ sql: "PRAGMA user_version", params: [], method: "get" })) as number[] | null;
      return r ? Number(r[0]) : 0;
    },
    (sql) => dbScript(sql),
  );
}

// ------------------------------------------------------- réactivité minimale

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

/** À appeler après toute écriture : les vues abonnées se rechargent. */
export function bump() {
  version++;
  listeners.forEach((l) => l());
}
export function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const dataVersion = () => version;
