/** Mise en page des rapports PDF (@react-pdf/renderer). */
import { Buffer } from "buffer";
import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { CHECK_ETATS, STATUTS, PRIORITES, TICKET_TYPES, formatDateFr, type CheckEtat, type Statut } from "@chantier/core";
import sans400 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff?url";
import sans600 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff?url";
import mono400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff?url";

// react-pdf attend Buffer (environnement Node) pour certains formats d'image
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;

Font.register({ family: "Plex", fonts: [{ src: sans400 }, { src: sans600, fontWeight: 600 }] });
Font.register({ family: "PlexMono", src: mono400 });
Font.registerHyphenationCallback((w) => [w]);

const INK = "#17202a", MUTED = "#6b7480", LINE = "#d9d6ce", ACCENT = "#e8590c";

const st = StyleSheet.create({
  page: { fontFamily: "Plex", fontSize: 9, color: INK, padding: "28 32 40 32" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `2 solid ${ACCENT}`, paddingBottom: 8, marginBottom: 12 },
  logo: { width: 90, height: 40, objectFit: "contain" },
  h1: { fontSize: 16, fontWeight: 600 },
  h2: { fontSize: 11, fontWeight: 600, marginTop: 12, marginBottom: 6, paddingBottom: 3, borderBottom: `1 solid ${LINE}` },
  muted: { color: MUTED },
  small: { fontSize: 8 },
  row: { flexDirection: "row" },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  info: { width: "50%", marginBottom: 3 },
  label: { color: MUTED, fontSize: 7.5, textTransform: "uppercase" },
  ticket: { borderTop: `1 solid ${LINE}`, paddingTop: 8, marginTop: 8 },
  tHead: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  num: { fontFamily: "PlexMono", fontSize: 11, marginRight: 8 },
  title: { fontSize: 11, fontWeight: 600, flex: 1 },
  badge: { fontSize: 7.5, paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 6, color: "#fff" },
  meta: { flexDirection: "row", flexWrap: "wrap", marginBottom: 4 },
  metaItem: { marginRight: 12, marginBottom: 2 },
  imgs: { flexDirection: "row", gap: 6, marginTop: 4 },
  plan: { width: 250, height: 156, border: `1 solid ${LINE}` },
  photo: { width: 120, height: 156, objectFit: "cover", border: `1 solid ${LINE}` },
  table: { borderTop: `1 solid ${LINE}` },
  tr: { flexDirection: "row", borderBottom: `0.5 solid ${LINE}`, paddingVertical: 3 },
  th: { fontWeight: 600, color: MUTED, fontSize: 7.5 },
  footer: { position: "absolute", bottom: 18, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

export interface Identity { societe: string; conducteur: string; telephone: string; email: string; logo?: string | null }
export interface ProjectInfo { nom: string; reference?: string | null; adresse?: string | null; moa?: string | null }
export interface RTicket {
  numero: number; titre: string; type: string; statut: string; priorite: string; description?: string | null; localisation?: string | null;
  lot?: string | null; lotColor?: string | null; entreprise?: string | null; echeance?: string | null; retard?: boolean;
  plan?: string | null; planImg?: string | null; photos: { src: string; legende?: string | null }[]; mesures: string[];
  derniersCommentaires: string[]; created_at: string;
}
export interface RChecklist { nom: string; items: { libelle: string; etat: string; note?: string | null }[] }

function Header({ id, project, title, subtitle }: { id: Identity; project: ProjectInfo; title: string; subtitle?: string }) {
  return (
    <View style={st.head} fixed>
      <View style={{ flex: 1 }}>
        <Text style={st.h1}>{title}</Text>
        <Text style={{ fontSize: 11, marginTop: 2 }}>{project.nom}{project.reference ? ` — ${project.reference}` : ""}</Text>
        {subtitle && <Text style={[st.muted, { marginTop: 2 }]}>{subtitle}</Text>}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {id.logo ? <Image src={id.logo} style={st.logo} /> : null}
        {id.societe ? <Text style={{ fontWeight: 600 }}>{id.societe}</Text> : null}
        {id.conducteur ? <Text style={st.muted}>{id.conducteur}</Text> : null}
        {(id.telephone || id.email) ? <Text style={[st.muted, st.small]}>{[id.telephone, id.email].filter(Boolean).join(" · ")}</Text> : null}
      </View>
    </View>
  );
}

function Footer({ project }: { project: ProjectInfo }) {
  return (
    <View style={st.footer} fixed>
      <Text>{project.nom} — édité le {formatDateFr(new Date().toISOString(), true)}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

const sColor = (s: string) => STATUTS[s as Statut]?.couleur ?? MUTED;
const sLabel = (s: string) => STATUTS[s as Statut]?.label ?? s;

function TicketBlock({ t }: { t: RTicket }) {
  return (
    <View style={st.ticket} wrap={false}>
      <View style={st.tHead}>
        <Text style={st.num}>#{t.numero}</Text>
        <Text style={st.title}>{t.titre}</Text>
        <Text style={[st.badge, { backgroundColor: sColor(t.statut) }]}>{sLabel(t.statut)}</Text>
      </View>
      <View style={st.meta}>
        <Text style={st.metaItem}><Text style={st.muted}>Type : </Text>{TICKET_TYPES[t.type as keyof typeof TICKET_TYPES]?.label ?? t.type}</Text>
        {t.lot ? <Text style={st.metaItem}><Text style={st.muted}>Lot : </Text>{t.lot}</Text> : null}
        {t.entreprise ? <Text style={st.metaItem}><Text style={st.muted}>Entreprise : </Text>{t.entreprise}</Text> : null}
        {t.localisation ? <Text style={st.metaItem}><Text style={st.muted}>Localisation : </Text>{t.localisation}</Text> : null}
        {t.plan ? <Text style={st.metaItem}><Text style={st.muted}>Plan : </Text>{t.plan}</Text> : null}
        <Text style={st.metaItem}><Text style={st.muted}>Priorité : </Text>{PRIORITES[t.priorite as keyof typeof PRIORITES]?.label ?? t.priorite}</Text>
        {t.echeance ? <Text style={[st.metaItem, t.retard ? { color: "#c73a3a", fontWeight: 600 } : {}]}><Text style={st.muted}>Échéance : </Text>{formatDateFr(t.echeance)}{t.retard ? " (dépassée)" : ""}</Text> : null}
        <Text style={st.metaItem}><Text style={st.muted}>Constaté le : </Text>{formatDateFr(t.created_at)}</Text>
      </View>
      {t.description ? <Text style={{ marginBottom: 4 }}>{t.description}</Text> : null}
      {t.mesures.length ? <Text style={{ marginBottom: 3 }}><Text style={st.muted}>Mesures : </Text>{t.mesures.join(" ; ")}</Text> : null}
      {t.derniersCommentaires.map((c, i) => <Text key={i} style={[st.small, st.muted]}>— {c}</Text>)}
      {(t.planImg || t.photos.length) ? (
        <View style={st.imgs}>
          {t.planImg ? <Image src={t.planImg} style={st.plan} /> : null}
          {t.photos.slice(0, t.planImg ? 2 : 4).map((p, i) => <Image key={i} src={p.src} style={st.photo} />)}
        </View>
      ) : null}
    </View>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <View style={st.info}><Text style={st.label}>{label}</Text><Text>{value || "—"}</Text></View>;
}

function SummaryTable({ tickets }: { tickets: RTicket[] }) {
  return (
    <View style={st.table}>
      <View style={st.tr}>
        <Text style={[st.th, { width: 34 }]}>N°</Text><Text style={[st.th, { flex: 1 }]}>Titre</Text><Text style={[st.th, { width: 90 }]}>Lot</Text>
        <Text style={[st.th, { width: 100 }]}>Entreprise</Text><Text style={[st.th, { width: 80 }]}>Statut</Text><Text style={[st.th, { width: 58 }]}>Échéance</Text>
      </View>
      {tickets.map((t) => (
        <View key={t.numero} style={st.tr} wrap={false}>
          <Text style={{ width: 34, fontFamily: "PlexMono" }}>#{t.numero}</Text><Text style={{ flex: 1 }}>{t.titre}</Text>
          <Text style={{ width: 90 }}>{t.lot ?? "—"}</Text><Text style={{ width: 100 }}>{t.entreprise ?? "—"}</Text>
          <Text style={{ width: 80, color: sColor(t.statut) }}>{sLabel(t.statut)}</Text>
          <Text style={{ width: 58, color: t.retard ? "#c73a3a" : INK }}>{t.echeance ? formatDateFr(t.echeance) : "—"}</Text>
        </View>
      ))}
    </View>
  );
}

function ChecklistBlock({ c }: { c: RChecklist }) {
  return (
    <View wrap={false} style={{ marginBottom: 8 }}>
      <Text style={{ fontWeight: 600, marginBottom: 3 }}>{c.nom}</Text>
      {c.items.map((i, k) => (
        <View key={k} style={[st.row, { marginBottom: 1.5 }]}>
          <Text style={{ width: 80, color: i.etat === "nok" ? "#c73a3a" : i.etat === "ok" ? "#2e9a5b" : MUTED }}>{CHECK_ETATS[i.etat as CheckEtat]?.label ?? i.etat}</Text>
          <Text style={{ flex: 1 }}>{i.libelle}{i.note ? ` — ${i.note}` : ""}</Text>
        </View>
      ))}
    </View>
  );
}

export function CompanyReport({ id, project, entreprise, contact, tickets }: { id: Identity; project: ProjectInfo; entreprise: string; contact?: string | null; tickets: RTicket[] }) {
  const open = tickets.filter((t) => t.statut !== "clos").length;
  return (
    <Document title={`Points à traiter — ${entreprise}`} author={id.conducteur || id.societe}>
      <Page size="A4" style={st.page}>
        <Header id={id} project={project} title="Liste des points à traiter" subtitle={`${entreprise}${contact ? ` — ${contact}` : ""}`} />
        <View style={st.infoGrid}>
          <Info label="Adresse du chantier" value={project.adresse} />
          <Info label="Maître d'ouvrage" value={project.moa} />
          <Info label="Points listés" value={`${tickets.length} dont ${open} non clos`} />
          <Info label="Date" value={formatDateFr(new Date().toISOString())} />
        </View>
        <Text style={st.h2}>Récapitulatif</Text>
        <SummaryTable tickets={tickets} />
        <Text style={st.h2} break>Détail des points</Text>
        {tickets.map((t) => <TicketBlock key={t.numero} t={t} />)}
        <Footer project={project} />
      </Page>
    </Document>
  );
}

export function VisitReport({ id, project, visite, crees, modifies, ouverts, checklists }: {
  id: Identity; project: ProjectInfo;
  visite: { date: string; titre?: string | null; participants?: string | null; meteo?: string | null; notes?: string | null };
  crees: RTicket[]; modifies: RTicket[]; ouverts: RTicket[]; checklists: RChecklist[];
}) {
  return (
    <Document title={`Compte rendu de visite du ${formatDateFr(visite.date)}`} author={id.conducteur || id.societe}>
      <Page size="A4" style={st.page}>
        <Header id={id} project={project} title="Compte rendu de visite de chantier" subtitle={`${formatDateFr(visite.date)}${visite.titre ? ` — ${visite.titre}` : ""}`} />
        <View style={st.infoGrid}>
          <Info label="Adresse" value={project.adresse} />
          <Info label="Maître d'ouvrage" value={project.moa} />
          <Info label="Météo" value={visite.meteo} />
          <Info label="Rédacteur" value={id.conducteur} />
        </View>
        {visite.participants ? (<><Text style={st.h2}>Participants</Text><Text>{visite.participants}</Text></>) : null}
        {visite.notes ? (<><Text style={st.h2}>Observations générales</Text><Text>{visite.notes}</Text></>) : null}
        {checklists.length ? (<><Text style={st.h2}>Contrôles</Text>{checklists.map((c, i) => <ChecklistBlock key={i} c={c} />)}</>) : null}
        <Text style={st.h2}>Nouveaux points constatés ({crees.length})</Text>
        {crees.length ? crees.map((t) => <TicketBlock key={t.numero} t={t} />) : <Text style={st.muted}>Aucun.</Text>}
        <Text style={st.h2}>Points mis à jour ({modifies.length})</Text>
        {modifies.length ? modifies.map((t) => <TicketBlock key={t.numero} t={t} />) : <Text style={st.muted}>Aucun.</Text>}
        <Text style={st.h2} break>Points restant ouverts sur le chantier ({ouverts.length})</Text>
        <SummaryTable tickets={ouverts} />
        <Footer project={project} />
      </Page>
    </Document>
  );
}

export function GlobalReport({ id, project, tickets, parLot, parEntreprise }: {
  id: Identity; project: ProjectInfo; tickets: RTicket[];
  parLot: { nom: string; counts: Record<string, number> }[]; parEntreprise: { nom: string; counts: Record<string, number>; retard: number }[];
}) {
  const statuts = Object.keys(STATUTS);
  const table = (rows: { nom: string; counts: Record<string, number>; retard?: number }[], withRetard: boolean) => (
    <View style={st.table}>
      <View style={st.tr}>
        <Text style={[st.th, { flex: 1 }]}>{withRetard ? "Entreprise" : "Lot"}</Text>
        {statuts.map((s) => <Text key={s} style={[st.th, { width: 62, textAlign: "right" }]}>{sLabel(s).split(" ")[0]}</Text>)}
        {withRetard && <Text style={[st.th, { width: 50, textAlign: "right" }]}>Retard</Text>}
      </View>
      {rows.map((r) => (
        <View key={r.nom} style={st.tr}>
          <Text style={{ flex: 1 }}>{r.nom}</Text>
          {statuts.map((s) => <Text key={s} style={{ width: 62, textAlign: "right", fontFamily: "PlexMono" }}>{r.counts[s] ?? 0}</Text>)}
          {withRetard && <Text style={{ width: 50, textAlign: "right", fontFamily: "PlexMono", color: r.retard ? "#c73a3a" : INK }}>{r.retard ?? 0}</Text>}
        </View>
      ))}
    </View>
  );
  return (
    <Document title={`État du chantier — ${project.nom}`}>
      <Page size="A4" style={st.page}>
        <Header id={id} project={project} title="État du chantier" subtitle={`au ${formatDateFr(new Date().toISOString())}`} />
        <View style={st.infoGrid}>
          <Info label="Adresse" value={project.adresse} />
          <Info label="Maître d'ouvrage" value={project.moa} />
          <Info label="Total des points" value={String(tickets.length)} />
          <Info label="Non clos" value={String(tickets.filter((t) => t.statut !== "clos").length)} />
        </View>
        <Text style={st.h2}>Par lot</Text>
        {table(parLot, false)}
        <Text style={st.h2}>Par entreprise</Text>
        {table(parEntreprise, true)}
        <Text style={st.h2} break>Points non clos</Text>
        <SummaryTable tickets={tickets.filter((t) => t.statut !== "clos")} />
        <Footer project={project} />
      </Page>
    </Document>
  );
}
