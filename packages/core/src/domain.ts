/** Référentiels métier : types, statuts, priorités, couleurs. */

export const TICKET_TYPES = {
  reserve: { label: "Réserve", court: "R" },
  observation: { label: "Observation", court: "O" },
  tache: { label: "Tâche", court: "T" },
} as const;
export type TicketType = keyof typeof TICKET_TYPES;

export const STATUTS = {
  ouvert: { label: "Ouvert", couleur: "#d64545", ordre: 0 },
  transmis: { label: "Transmis à l'entreprise", couleur: "#e08a1e", ordre: 1 },
  leve: { label: "Levé (déclaré)", couleur: "#2f7dd1", ordre: 2 },
  clos: { label: "Contrôlé / clos", couleur: "#2e9a5b", ordre: 3 },
} as const;
export type Statut = keyof typeof STATUTS;
export const STATUT_LIST = Object.keys(STATUTS) as Statut[];
export const STATUTS_OUVERTS: Statut[] = ["ouvert", "transmis", "leve"];

/** Transitions proposées depuis un statut (toutes restent possibles manuellement). */
export const TRANSITIONS: Record<Statut, Statut[]> = {
  ouvert: ["transmis", "leve", "clos"],
  transmis: ["leve", "ouvert"],
  leve: ["clos", "ouvert"],
  clos: ["ouvert"],
};

export const PRIORITES = {
  basse: { label: "Basse", ordre: 0 },
  normale: { label: "Normale", ordre: 1 },
  haute: { label: "Haute", ordre: 2 },
} as const;
export type Priorite = keyof typeof PRIORITES;

export const CHECK_ETATS = {
  a_faire: { label: "À vérifier", symbole: "○" },
  ok: { label: "Conforme", symbole: "✓" },
  nok: { label: "Non conforme", symbole: "✗" },
  na: { label: "Sans objet", symbole: "—" },
} as const;
export type CheckEtat = keyof typeof CHECK_ETATS;

/** Palette des lots (distinctes, lisibles sur plan). */
export const LOT_COLORS = [
  "#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e",
  "#17becf", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22",
  "#0b3c5d", "#a83279",
];

/** Lots courants en bâtiment (proposés à la création d'un chantier). */
export const LOTS_TYPES = [
  "Gros œuvre", "Charpente / couverture", "Menuiseries extérieures", "Plâtrerie / isolation",
  "Menuiseries intérieures", "Électricité", "Plomberie / sanitaire", "Chauffage / ventilation",
  "Carrelage / faïence", "Peinture", "Sols souples", "VRD / espaces verts",
];

export function isEnRetard(t: { echeance: string | null; statut: string }, today = new Date()): boolean {
  if (!t.echeance || t.statut === "clos" || t.statut === "leve") return false;
  return t.echeance < today.toISOString().slice(0, 10);
}
