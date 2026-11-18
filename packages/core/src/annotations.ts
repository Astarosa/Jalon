/** Annotations de photos, en coordonnées relatives (0..1) à l'image d'origine. */
export type Shape =
  | { kind: "fleche"; id: string; color: string; width: number; pts: [number, number, number, number] }
  | { kind: "trait"; id: string; color: string; width: number; pts: [number, number, number, number] }
  | { kind: "ellipse"; id: string; color: string; width: number; x: number; y: number; rx: number; ry: number }
  | { kind: "rect"; id: string; color: string; width: number; x: number; y: number; w: number; h: number }
  | { kind: "main"; id: string; color: string; width: number; pts: number[] }
  | { kind: "texte"; id: string; color: string; size: number; x: number; y: number; text: string };

export const ANNOTATION_COLORS = ["#e11d2e", "#ffd400", "#00a3ff", "#16a34a", "#ffffff", "#111111"];

export function parseShapes(json: string | null | undefined): Shape[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
