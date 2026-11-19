/** Référentiels métier : types, statuts, priorités, couleurs. */

export const TICKET_TYPES = {
  reserve: { label: "Réserve", court: "R" },
  observation: { label: "Observation", court: "O" },
  tache: { label: "Tâche", court: "T" },
} as const;
export type TicketType = keyof typeof TICKET_TYPES;

export const STATUTS = {
  ouvert: { label: "Ouvert", court: "Ouvert", action: "Rouvrir", couleur: "#d64545", ordre: 0 },
  transmis: { label: "Transmis à l'entreprise", court: "Transmis", action: "Transmettre", couleur: "#e08a1e", ordre: 1 },
  fabrication: { label: "Envoyé en fabrication", court: "Fabrication", action: "Envoyé en fabrication", couleur: "#8b5cf6", ordre: 2 },
  pret_a_poser: { label: "Prêt à poser", court: "Prêt à poser", action: "Prêt à poser", couleur: "#0e9f9a", ordre: 3 },
  pose: { label: "Posé", court: "Posé", action: "Posé", couleur: "#4361c2", ordre: 4 },
  leve: { label: "Levé (déclaré)", court: "Levé", action: "Déclarer levé", couleur: "#2f7dd1", ordre: 5 },
  clos: { label: "Contrôlé / clos", court: "Contrôlé", action: "Contrôler et clore", couleur: "#2e9a5b", ordre: 6 },
} as const;
export type Statut = keyof typeof STATUTS;
export const STATUT_LIST = Object.keys(STATUTS) as Statut[];
/** Statuts non clos (filtres par défaut, rapports « points à traiter »). */
export const STATUTS_OUVERTS: Statut[] = ["ouvert", "transmis", "fabrication", "pret_a_poser", "pose", "leve"];
/** Statuts où l'entreprise doit encore agir : seuls ceux-ci peuvent être « en retard ». */
export const STATUTS_EN_ATTENTE: Statut[] = ["ouvert", "transmis", "fabrication", "pret_a_poser"];

/** Statuts proposés en un clic depuis un statut (tous restent atteignables). */
export const TRANSITIONS: Record<Statut, Statut[]> = {
  ouvert: ["transmis", "fabrication", "pret_a_poser", "pose", "leve", "clos"],
  transmis: ["fabrication", "pret_a_poser", "pose", "leve", "clos", "ouvert"],
  fabrication: ["pret_a_poser", "pose", "leve", "clos", "ouvert"],
  pret_a_poser: ["pose", "leve", "clos", "ouvert"],
  pose: ["leve", "clos", "ouvert"],
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
  if (!t.echeance || !STATUTS_EN_ATTENTE.includes(t.statut as Statut)) return false;
  return t.echeance < today.toISOString().slice(0, 10);
}
