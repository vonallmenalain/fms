import roh from '../data/programm.json';

/**
 * Ein Blockschlüssel («a1», «l2», «z3»). Bewusst eine gewöhnliche Zeichenkette und keine
 * Aufzählung mehr: Seit die Steuerung Bereiche anlegen und entfernen darf, steht die
 * Liste erst zur Laufzeit fest. Welche Schlüssel überhaupt vorkommen dürfen, entscheidet
 * nicht der Typ, sondern firestore.rules — siehe NEUE_BLOCK_IDS weiter unten.
 */
export type BlockId = string;
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
  event: { titel: string; datum: string; adresse: string; erwarteteBesuchende: number; infostand: string };
  anzeige: { lehrpersonKuerzel: boolean; klasse: boolean; raumlegendeAufTicket: boolean };
  regeln: { doppelwahl: string; maxPlaetzeProGeraet: number; freigabe: string };
  rahmenprogramm: { von: string; bis: string; ort: string; was: string }[];
  raumlegende: Record<string, string>;
  hinweise: string[];
  blocks: Block[];
  offerings: Angebot[];
};

/** Der Stand aus der Programmdatei — ohne die Anpassungen aus der Steuerung. */
export const BLOECKE_DATEI: Block[] = programm.blocks;
export const ANGEBOTE: Angebot[] = programm.offerings;

/**
 * Wie ein Bereich in der Oberfläche heisst — je nach Art.
 *
 * `einzahl`/`mehrzahl` steht in der Steuerung, `gast` auf der Startseite: Gegenüber den
 * Besuchenden heisst eine Lektion seit jeher «Unterrichtsbesuch», in der Steuerung ist
 * «Lektion» das kürzere Wort.
 */
export const ART_TEXT: Record<BlockArt, { einzahl: string; mehrzahl: string; gast: string }> = {
  atelier: { einzahl: 'Atelier', mehrzahl: 'Ateliers', gast: 'Ateliers' },
  lektion: { einzahl: 'Lektion', mehrzahl: 'Lektionen', gast: 'Unterrichtsbesuche' },
};

/* --------------------------------------------------- Anpassungen zur Laufzeit */

/**
 * Was die Administration unter «Steuerung → Programm & Kapazitäten» von Hand ändern darf.
 *
 * Die Programmdatei bleibt die Quelle der Wahrheit — hier liegt nur die Abweichung davon,
 * und zwar nur für das, was tatsächlich angefasst wurde. So wirkt eine spätere Korrektur
 * in data/programm.json weiterhin überall dort, wo niemand von Hand eingegriffen hat.
 * Gespeichert wird das Ganze in EINEM Dokument (config/programm), das jedes Gerät ohnehin
 * mitliest — siehe src/hooks/useProgrammAnpassungen.ts.
 *
 * Die Kapazität steht bewusst NICHT hier: Sie lebt im Zählerdokument (slots/{id}),
 * weil die Buchungstransaktion sie dort gegen Überbuchung prüft.
 */
export interface Anpassung {
  fach?: string;
  klasse?: string;
  raum?: string;
  lehrperson?: string;
  /** Nur bei Angeboten, die es in der Programmdatei nicht gibt. */
  blockId?: BlockId;
  fachKey?: string;
  neu?: boolean;
  /** Angebot aus der Programmdatei ausblenden. Die Datei selbst bleibt unberührt. */
  entfernt?: boolean;
}

/** Dasselbe für einen Bereich: Titel und Zeiten — oder ein ganz neuer Bereich. */
export interface BlockAnpassung {
  label?: string;
  von?: string;
  bis?: string;
  /** Nur bei Bereichen, die es in der Programmdatei nicht gibt. */
  art?: BlockArt;
  kapazitaet?: number;
  neu?: boolean;
  entfernt?: boolean;
}

export type Anpassungen = Record<string, Anpassung>;
export type BlockAnpassungen = Record<string, BlockAnpassung>;

/** Der Inhalt von `config/programm`, so wie ihn die Steuerung schreibt. */
export interface ProgrammAnpassungen {
  event?: { datum?: string };
  bloecke?: BlockAnpassungen;
  angebote?: Anpassungen;
}

/**
 * Schlüssel, die ein neu angelegter Bereich bekommen kann.
 *
 * Kein freies Feld, sondern ein fester Vorrat: firestore.rules prüfen für JEDEN
 * Blockschlüssel einzeln, dass die gewählte Angebots-ID auch zu diesem Block gehört —
 * und die Regelsprache kennt keine Schleifen. Die Liste steht deshalb dort genauso
 * aufgezählt wie hier; beide müssen zusammenpassen.
 */
export const NEUE_BLOCK_IDS: BlockId[] = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 'z8'];

let anpassungen: Anpassungen = {};
let blockAnpassungen: BlockAnpassungen = {};
let eventDatum: string | undefined;

/**
 * Zählt bei jeder Änderung hoch. React hört über useSyncExternalStore darauf zu — ohne
 * das bliebe ein umbenanntes Angebot auf dem Schirm stehen, bis jemand neu lädt.
 */
let stand = 0;
const hoerer = new Set<() => void>();

let bloeckeListe: Block[] = [];
let blockNachId = new Map<BlockId, Block>();
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

function mitBlockAnpassung(b: Block, p: BlockAnpassung | undefined): Block {
  if (!p) return b;
  return {
    ...b,
    label: sauber(p.label) || b.label,
    von: sauber(p.von) || b.von,
    bis: sauber(p.bis) || b.bis,
    kapazitaet: typeof p.kapazitaet === 'number' ? p.kapazitaet : b.kapazitaet,
  };
}

/** Ein Bereich, den es nur in der Steuerung gibt. */
function neuerBlock(id: BlockId, p: BlockAnpassung): Block {
  return {
    id,
    art: p.art === 'lektion' ? 'lektion' : 'atelier',
    label: sauber(p.label) || id,
    von: sauber(p.von) || '',
    bis: sauber(p.bis) || '',
    kapazitaet: typeof p.kapazitaet === 'number' ? p.kapazitaet : 0,
  };
}

/** Ein Angebot, das es nur in der Steuerung gibt. */
function neuesAngebot(id: string, p: Anpassung): Angebot {
  return {
    id,
    blockId: p.blockId ?? '',
    fach: sauber(p.fach) || 'Ohne Titel',
    fachKey: p.fachKey || id,
    lehrperson: sauber(p.lehrperson) ?? '',
    raum: sauber(p.raum) ?? '',
    klasse: sauber(p.klasse) || undefined,
    kapazitaet: 0,
  };
}

/**
 * Die Bereiche werden nach Anfangszeit sortiert — die früheste zuerst.
 *
 * Das ist nicht bloss Kosmetik: Diese Reihenfolge ist zugleich der Weg durch die App
 * (Schritt 1 … n) und die Reihenfolge auf dem Ticket. Wer in der Steuerung eine Zeit
 * ändert, verschiebt den Bereich damit auch im Ablauf — genau so, wie es der Morgen
 * dann tatsächlich hergeht. Bereiche ohne Zeit landen am Schluss statt zuvorderst.
 */
function nachZeit(a: Block, b: Block): number {
  const schluessel = (x: Block) => `${x.von || '99:99'}${x.bis || '99:99'}${x.label}`;
  return schluessel(a).localeCompare(schluessel(b), 'de');
}

function baueAuf(): void {
  const ausDatei = BLOECKE_DATEI
    .filter((b) => !blockAnpassungen[b.id]?.entfernt)
    .map((b) => mitBlockAnpassung(b, blockAnpassungen[b.id]));
  const dazu = Object.entries(blockAnpassungen)
    .filter(([, p]) => p.neu && !p.entfernt)
    .map(([id, p]) => neuerBlock(id, p));
  bloeckeListe = [...ausDatei, ...dazu].sort(nachZeit);
  blockNachId = new Map(bloeckeListe.map((b) => [b.id, b]));

  const alle = [
    ...ANGEBOTE
      .filter((a) => !anpassungen[a.id]?.entfernt)
      .map((a) => mitAnpassung(a, anpassungen[a.id])),
    ...Object.entries(anpassungen)
      .filter(([, p]) => p.neu && !p.entfernt)
      .map(([id, p]) => neuesAngebot(id, p)),
  // Angebote eines entfernten Bereichs fallen mit weg: Sie hätten weder Zeit noch Ort.
  ].filter((a) => blockNachId.has(a.blockId));

  nachId = new Map(alle.map((a) => [a.id, a]));
  nachBlock = new Map(bloeckeListe.map((b) => [b.id, alle.filter((a) => a.blockId === b.id)]));
}

baueAuf();

/**
 * Leergeräumte Einträge zählen nicht als Anpassung.
 *
 * Wer etwas ausblendet und gleich wieder hervorholt, hinterlässt in Firestore eine leere
 * Karte (`{ }`) — das einzelne Feld wurde gelöscht, der Eintrag bleibt. Ohne diese Zeile
 * trüge das Angebot danach für immer die Marke «angepasst», obwohl nichts abweicht.
 */
function ohneLeere<T extends object>(m: Record<string, T> | undefined): Record<string, T> {
  return Object.fromEntries(
    Object.entries(m ?? {}).filter(([, w]) => w && Object.keys(w).length > 0),
  );
}

/** Neue Anpassungen aus der Datenbank übernehmen und alle Bildschirme neu zeichnen. */
export function setzeAnpassungen(neu: ProgrammAnpassungen | null | undefined): void {
  anpassungen = ohneLeere(neu?.angebote);
  blockAnpassungen = ohneLeere(neu?.bloecke);
  eventDatum = sauber(neu?.event?.datum) || undefined;
  baueAuf();
  stand++;
  for (const h of hoerer) h();
}

export function abonniereProgramm(hoerer_: () => void): () => void {
  hoerer.add(hoerer_);
  return () => { hoerer.delete(hoerer_); };
}

export const programmStand = (): number => stand;

/** Die Anpassung eines Angebots bzw. eines Bereichs — für die Masken in der Steuerung. */
export const anpassungFuer = (id: string): Anpassung | undefined => anpassungen[id];
export const blockAnpassungFuer = (id: BlockId): BlockAnpassung | undefined => blockAnpassungen[id];

/** Wie viel von Hand angepasst wurde — Angebote, Bereiche und das Datum zusammen. */
export const anzahlAnpassungen = (): number =>
  Object.keys(anpassungen).length + Object.keys(blockAnpassungen).length + (eventDatum ? 1 : 0);

/** Ausgeblendete Bereiche und Angebote aus der Programmdatei — zum Wiedereinblenden. */
export const entfernteBloecke = (): Block[] =>
  BLOECKE_DATEI.filter((b) => blockAnpassungen[b.id]?.entfernt)
    .map((b) => mitBlockAnpassung(b, blockAnpassungen[b.id]));

export const entfernteAngebote = (): Angebot[] =>
  ANGEBOTE.filter((a) => anpassungen[a.id]?.entfernt).map((a) => mitAnpassung(a, anpassungen[a.id]));

/** Der nächste freie Schlüssel für einen neuen Bereich — oder null, wenn der Vorrat leer ist. */
export const freierBlockSchluessel = (): BlockId | null =>
  NEUE_BLOCK_IDS.find((id) => !blockAnpassungen[id]) ?? null;

/* -------------------------------------------------------------------- Zugriff */

const basisNachId = new Map(ANGEBOTE.map((a) => [a.id, a]));
const basisBlockNachId = new Map(BLOECKE_DATEI.map((b) => [b.id, b]));

/** Ein Angebot samt Anpassungen — das, was auf dem Bildschirm stehen soll. */
export const angebot = (id: string | null | undefined): Angebot | undefined =>
  id ? nachId.get(id) : undefined;

/** Dasselbe Angebot bzw. derselbe Bereich, wie er in der Programmdatei steht. */
export const basisAngebot = (id: string): Angebot | undefined => basisNachId.get(id);
export const basisBlock = (id: BlockId): Block | undefined => basisBlockNachId.get(id);

export const angeboteFuer = (blockId: BlockId): Angebot[] => nachBlock.get(blockId) ?? [];

/** Alle Angebote samt Anpassungen, Bereich für Bereich in der Reihenfolge des Morgens. */
export const alleAngebote = (): Angebot[] => [...nachId.values()];

/** Alle Bereiche, nach Anfangszeit sortiert. */
export const alleBloecke = (): Block[] => bloeckeListe;
export const blockIds = (): BlockId[] => bloeckeListe.map((b) => b.id);

/**
 * Ein Bereich — oder `undefined`, wenn es ihn nicht (mehr) gibt.
 *
 * Der zweite Fall ist echt: Die Steuerung darf Bereiche entfernen, während jemand
 * gerade darin auswählt. Die Aufrufer müssen ihn deshalb abfangen.
 */
export const block = (id: BlockId): Block | undefined => blockNachId.get(id);

/**
 * Blöcke, innerhalb derer dasselbe Fach nicht zweimal gewählt werden darf (Entscheid D1/D2).
 *
 * Massgebend ist die ART des Bereichs: Ateliers gegen Ateliers, Lektionen gegen Lektionen.
 * Früher stand dafür eine feste Gruppenliste in der Programmdatei; seit die Steuerung
 * Bereiche anlegen darf, müsste sie dort von Hand nachgeführt werden — ein neuer Bereich
 * fiele sonst still aus der Sperre heraus.
 */
export function dedupeGruppe(blockId: BlockId): BlockId[] {
  const b = block(blockId);
  if (!b) return [blockId];
  return bloeckeListe.filter((x) => x.art === b.art).map((x) => x.id);
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

export const zeitraum = (b: Block): string => (b.von && b.bis ? `${b.von} – ${b.bis}` : 'ohne Zeit');

/* ----------------------------------------------------------------- Datum */

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];

/** Das Datum des Anlasses als `JJJJ-MM-TT` — aus der Steuerung, sonst aus der Programmdatei. */
export const datumIso = (): string => eventDatum ?? programm.event.datum;

/** Das Datum, wie es in der Programmdatei steht. */
export const basisDatumIso = (): string => programm.event.datum;

export const datumAngepasst = (): boolean => eventDatum !== undefined;

/**
 * «Mittwoch, 28. Oktober 2026».
 *
 * Der Wochentag wird gerechnet und nicht gespeichert: Sonst stünde nach dem Umstellen
 * auf den nächsten Besuchstag ein Wochentag da, der nicht zum Datum passt.
 */
export const datumLang = (iso: string = datumIso()): string => {
  const [j, m, t] = iso.split('-').map(Number);
  if (!j || !m || !t || m < 1 || m > 12) return iso;
  return `${WOCHENTAGE[new Date(Date.UTC(j, m - 1, t)).getUTCDay()]}, ${t}. ${MONATE[m - 1]} ${j}`;
};

/**
 * «2 Ateliers und 2 Unterrichtsbesuche» — für die Startseite.
 *
 * Aus den Bereichen gerechnet statt fest geschrieben: Wer in der Steuerung einen Bereich
 * hinzufügt, soll das auf der Startseite nicht von Hand nachtragen müssen.
 */
export function angebotsSatz(): string {
  const teile = (['atelier', 'lektion'] as BlockArt[])
    .map((art) => ({ art, n: bloeckeListe.filter((b) => b.art === art).length }))
    .filter(({ n }) => n > 0)
    .map(({ art, n }) => `${n} ${n === 1 ? ART_TEXT[art].einzahl : ART_TEXT[art].gast}`);
  if (teile.length === 0) return '';
  return teile.length === 1 ? teile[0] : `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`;
}

/* ------------------------------------------------- Schlüssel für Neuanlagen */

/** Titel zu einem Schlüssel: «Wirtschaft und Recht» → «wirtschaft-und-recht». */
export function schluessel(text: string): string {
  const ersatz: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss' };
  const flach = text.toLowerCase().replace(/[äöüÄÖÜß]/g, (z) => ersatz[z] ?? z);
  return flach.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'angebot';
}

/**
 * Die ID eines neu angelegten Angebots.
 *
 * Sie MUSS mit dem Blockschlüssel und einem Bindestrich beginnen — firestore.rules
 * erzwingen das sowohl beim Zähler als auch bei der Wahl, damit niemand ein Angebot
 * im falschen Block bucht. Der Zufallsanhang verhindert, dass zwei gleich benannte
 * Angebote im selben Bereich auf derselben ID landen.
 */
export function neueAngebotId(blockId: BlockId, titel: string): string {
  const zufall = Math.random().toString(36).slice(2, 6);
  return `${blockId}-${schluessel(titel)}-${zufall}`;
}
