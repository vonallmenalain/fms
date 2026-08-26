import roh from '../data/programm.json';

export type BlockId = 'a1' | 'a2' | 'l1' | 'l2';
export type BlockArt = 'atelier' | 'lektion';

export interface Block {
  id: BlockId;
  art: BlockArt;
  label: string;
  von: string;
  bis: string;
  kapazitaet: number;
}

export interface Angebot {
  id: string;
  blockId: BlockId;
  fach: string;
  fachKey: string;
  lehrperson: string;
  raum: string;
  raumKurz?: string;
  klasse?: string;
  kapazitaet: number;
}

export type Wahl = Partial<Record<BlockId, string | null>>;

export const programm = roh as unknown as {
  version: string;
  event: { titel: string; datum: string; wochentag: string; adresse: string; erwarteteBesuchende: number; infostand: string };
  anzeige: { lehrpersonKuerzel: boolean; klasse: boolean; raumlegendeAufTicket: boolean };
  regeln: { doppelwahl: string; maxPlaetzeProGeraet: number; freigabe: string };
  rahmenprogramm: { von: string; bis: string; ort: string; was: string }[];
  raumlegende: Record<string, string>;
  hinweise: string[];
  blocks: Block[];
  dedupeGruppen: { id: string; blocks: BlockId[]; regel: string }[];
  offerings: Angebot[];
};

export const BLOECKE: Block[] = programm.blocks;
export const BLOCK_IDS: BlockId[] = BLOECKE.map((b) => b.id);

/** Der Stand aus der Programmdatei — ohne die Anpassungen aus der Steuerung. */
export const ANGEBOTE: Angebot[] = programm.offerings;

/* --------------------------------------------------- Anpassungen zur Laufzeit */

/**
 * Was die Administration unter «Steuerung → Programm & Kapazitäten» von Hand ändern
 * darf: Titel, Klasse, Zimmer und Lehrpersonen-Kürzel eines Angebots.
 *
 * Die Programmdatei bleibt die Quelle der Wahrheit — hier liegt nur die Abweichung
 * davon, und zwar nur für die Angebote, die tatsächlich angefasst wurden. So wirkt eine
 * spätere Korrektur in data/programm.json weiterhin überall dort, wo niemand von Hand
 * eingegriffen hat. Gespeichert wird das Ganze in EINEM Dokument (config/programm),
 * das jedes Gerät ohnehin mitliest — siehe src/hooks/useProgrammAnpassungen.ts.
 *
 * Die Kapazität steht bewusst NICHT hier: Sie lebt im Zählerdokument (slots/{id}),
 * weil die Buchungstransaktion sie dort gegen Überbuchung prüft.
 */
export interface Anpassung {
  fach?: string;
  klasse?: string;
  raum?: string;
  lehrperson?: string;
}

export type Anpassungen = Record<string, Anpassung>;

let anpassungen: Anpassungen = {};

/**
 * Zählt bei jeder Änderung hoch. React hört über useSyncExternalStore darauf zu — ohne
 * das bliebe ein umbenanntes Angebot auf dem Schirm stehen, bis jemand neu lädt.
 */
let stand = 0;
const hoerer = new Set<() => void>();

let nachId = new Map<string, Angebot>();
let nachBlock = new Map<BlockId, Angebot[]>();

const sauber = (wert: string | undefined): string | undefined =>
  typeof wert === 'string' ? wert.trim() : undefined;

/**
 * Angebot aus der Programmdatei mit der Anpassung überlagern.
 *
 * Ein leeres Feld heisst «nichts anzeigen» (etwa eine Lektion ohne Klasse) — beim Fach
 * gilt das nicht: Ein Angebot ohne Titel wäre auf der Karte eine leere Zeile, darum
 * fällt es dort auf die Programmdatei zurück.
 */
function mitAnpassung(a: Angebot, p: Anpassung | undefined): Angebot {
  if (!p) return a;
  const fach = sauber(p.fach);
  const klasse = sauber(p.klasse);
  const raum = sauber(p.raum);
  const lehrperson = sauber(p.lehrperson);
  return {
    ...a,
    fach: fach || a.fach,
    klasse: klasse === undefined ? a.klasse : (klasse || undefined),
    raum: raum === undefined ? a.raum : raum,
    lehrperson: lehrperson === undefined ? a.lehrperson : lehrperson,
  };
}

function baueAuf(): void {
  nachId = new Map(ANGEBOTE.map((a) => [a.id, mitAnpassung(a, anpassungen[a.id])]));
  const alle = [...nachId.values()];
  nachBlock = new Map(BLOCK_IDS.map((id) => [id, alle.filter((a) => a.blockId === id)]));
}

baueAuf();

/** Neue Anpassungen aus der Datenbank übernehmen und alle Bildschirme neu zeichnen. */
export function setzeAnpassungen(neu: Anpassungen | null | undefined): void {
  anpassungen = neu ?? {};
  baueAuf();
  stand++;
  for (const h of hoerer) h();
}

export function abonniereProgramm(hoerer_: () => void): () => void {
  hoerer.add(hoerer_);
  return () => { hoerer.delete(hoerer_); };
}

export const programmStand = (): number => stand;

/** Die Anpassung eines Angebots — für die Bearbeitungsmaske in der Steuerung. */
export const anpassungFuer = (id: string): Anpassung | undefined => anpassungen[id];

/** Wie viele Angebote von Hand angepasst wurden. */
export const anzahlAnpassungen = (): number => Object.keys(anpassungen).length;

/* -------------------------------------------------------------------- Zugriff */

const basisNachId = new Map(ANGEBOTE.map((a) => [a.id, a]));

/** Ein Angebot samt Anpassungen — das, was auf dem Bildschirm stehen soll. */
export const angebot = (id: string | null | undefined): Angebot | undefined =>
  id ? nachId.get(id) : undefined;

/** Dasselbe Angebot, wie es in der Programmdatei steht. */
export const basisAngebot = (id: string): Angebot | undefined => basisNachId.get(id);

export const angeboteFuer = (blockId: BlockId): Angebot[] => nachBlock.get(blockId) ?? [];

/** Alle Angebote samt Anpassungen, in der Reihenfolge der Programmdatei. */
export const alleAngebote = (): Angebot[] => [...nachId.values()];

export const block = (id: BlockId): Block => BLOECKE.find((b) => b.id === id)!;

/** Blöcke, innerhalb derer dasselbe Fach nicht zweimal gewählt werden darf (Entscheid D1/D2). */
export function dedupeGruppe(blockId: BlockId): BlockId[] {
  const gruppe = programm.dedupeGruppen.find((g) => g.blocks.includes(blockId));
  return gruppe ? gruppe.blocks : [blockId];
}

/**
 * Ist dieses Angebot gesperrt, weil dasselbe Fach in der Blockgruppe schon gewählt wurde?
 * Entscheid D1: es zählt das Fach, nicht die Klasse.
 * Entscheid D2: die Sperre wirkt nur innerhalb der Gruppe (Ateliers bzw. Lektionen).
 *
 * Massgebend ist `fachKey` aus der Programmdatei, nicht der angezeigte Titel: Ein in der
 * Steuerung umbenanntes Angebot soll die Doppelwahlsperre weder aushebeln noch neu
 * auslösen — die Zusammengehörigkeit der Fächer ist eine Frage des Programms.
 */
export function schonGewaehltesFach(a: Angebot, wahl: Wahl): boolean {
  return dedupeGruppe(a.blockId)
    .filter((b) => b !== a.blockId)
    .some((b) => angebot(wahl[b])?.fachKey === a.fachKey);
}

/** Anzeigezeile unter dem Fach: Klasse und Zimmer, ohne Lehrpersonen-Kürzel (Entscheid der Schule). */
export function metaZeile(a: Angebot): string {
  const teile = [a.klasse, a.raum].filter(Boolean) as string[];
  if (programm.anzeige.lehrpersonKuerzel && a.lehrperson) teile.push(a.lehrperson);
  return teile.join(' · ');
}

export const zeitraum = (b: Block): string => `${b.von} – ${b.bis}`;

export const datumLang = (): string => {
  const [j, m, t] = programm.event.datum.split('-').map(Number);
  const monate = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  return `${programm.event.wochentag}, ${t}. ${monate[m - 1]} ${j}`;
};
