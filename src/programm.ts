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
export const ANGEBOTE: Angebot[] = programm.offerings;

const nachId = new Map(ANGEBOTE.map((a) => [a.id, a]));
const nachBlock = new Map<BlockId, Angebot[]>(
  BLOCK_IDS.map((id) => [id, ANGEBOTE.filter((a) => a.blockId === id)]),
);

export const angebot = (id: string | null | undefined): Angebot | undefined =>
  id ? nachId.get(id) : undefined;

export const angeboteFuer = (blockId: BlockId): Angebot[] => nachBlock.get(blockId) ?? [];

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
