/**
 * Format d'export d'un chantier (.zip) : `chantier.json` + `fichiers/<sha256>`.
 * Sert à l'archivage, au transfert entre postes et à l'import futur dans le produit collaboratif.
 */
import { z } from "zod";
import { PROJECT_TABLES } from "./schema";

export const EXPORT_FORMAT = "jalon/chantier";
export const EXPORT_VERSION = 1;

const row = z.record(z.string(), z.unknown());

export const exportBundleSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().max(EXPORT_VERSION),
  exported_at: z.string(),
  project: row,
  /** Entreprises référencées par le chantier (carnet global) */
  companies: z.array(row),
  /** Modèles de checklists utilisés */
  checklist_templates: z.array(row).default([]),
  files: z.array(row),
  tables: z.object(Object.fromEntries(PROJECT_TABLES.map((t) => [t, z.array(row)])) as Record<
    (typeof PROJECT_TABLES)[number],
    z.ZodArray<typeof row>
  >),
});
export type ExportBundle = z.infer<typeof exportBundleSchema>;
