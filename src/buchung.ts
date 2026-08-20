import {
  collection, doc, runTransaction, serverTimestamp, type Transaction, type DocumentReference,
} from 'firebase/firestore';
import { db } from './firebase';
import { angebot, block, type BlockId, type Wahl, BLOCK_IDS } from './programm';
import { AusgebuchtFehler, RechteFehler, mitWiederholung, nacheinander } from './wiederholung';

export interface Buchung {
  plaetze: number;
  wahl: Record<BlockId, string | null>;
  quelle: 'gast' | 'admin';
  notiz: string | null;
  erstelltAm?: unknown;
  geaendertAm?: unknown;
}

export const leereWahl = (): Record<BlockId, string | null> =>
  Object.fromEntries(BLOCK_IDS.map((b) => [b, null])) as Record<BlockId, string | null>;

export const neueBuchung = (plaetze: number, quelle: 'gast' | 'admin' = 'gast'): Buchung => ({
  plaetze,
  wahl: leereWahl(),
  quelle,
  notiz: null,
});

const istRechteFehler = (f: unknown): boolean =>
  typeof f === 'object' && f !== null && (f as { code?: string }).code === 'permission-denied';

/** Zählerstand lesen; fehlt das Dokument, gilt es als leer (Selbstheilung ohne Seed). */
async function leseSlot(tx: Transaction, ref: DocumentReference, angebotId: string) {
  const snap = await tx.get(ref);
  const a = angebot(angebotId);
  if (snap.exists()) {
    const d = snap.data() as { belegt: number; kapazitaet: number };
    return { belegt: d.belegt ?? 0, kapazitaet: d.kapazitaet ?? a?.kapazitaet ?? 0, neu: false };
  }
  return { belegt: 0, kapazitaet: a?.kapazitaet ?? block(a!.blockId).kapazitaet, neu: true };
}

/**
 * Zählerstand schreiben. Bei einem bestehenden Dokument wird ausschliesslich `belegt`
 * angefasst — so können die Security Rules hart erzwingen, dass Gäste weder Kapazität
 * noch Blockzuordnung verändern. Nur wenn das Dokument fehlt (kein Seed), wird es
 * vollständig angelegt.
 */
function schreibeSlot(
  tx: Transaction,
  ref: DocumentReference,
  angebotId: string,
  stand: { neu: boolean; kapazitaet: number },
  belegt: number,
) {
  if (stand.neu) {
    tx.set(ref, { belegt, kapazitaet: stand.kapazitaet, block: angebot(angebotId)!.blockId });
  } else {
    tx.update(ref, { belegt });
  }
}

/**
 * Eine Wahl setzen, ändern oder freigeben — alles in einer Transaktion:
 * alten Platz freigeben, neuen belegen, Buchung aktualisieren. Ganz oder gar nicht.
 *
 * WICHTIG: Firestore verlangt ALLE Lesevorgänge vor ALLEN Schreibvorgängen. Die drei
 * Abschnitte unten sind deshalb strikt getrennt.
 */
export function waehle(
  buchungId: string,
  blockId: BlockId,
  neuesAngebot: string | null,
  vorgabePlaetze: number,
  quelle: 'gast' | 'admin' = 'gast',
): Promise<void> {
  return nacheinander(() =>
    mitWiederholung(async () => {
      try {
        await runTransaction(db, async (tx) => {
          const buchungRef = doc(db, 'bookings', buchungId);

          // ---------- 1. Lesen ----------
          const buchungSnap = await tx.get(buchungRef);
          const vorhanden = buchungSnap.exists();
          const buchung: Buchung = vorhanden
            ? (buchungSnap.data() as Buchung)
            : neueBuchung(vorgabePlaetze, quelle);
          const plaetze = buchung.plaetze;
          const altesAngebot = buchung.wahl?.[blockId] ?? null;

          if (altesAngebot === neuesAngebot) return;

          const neuRef = neuesAngebot ? doc(db, 'slots', neuesAngebot) : null;
          const altRef = altesAngebot ? doc(db, 'slots', altesAngebot) : null;
          const neu = neuRef ? await leseSlot(tx, neuRef, neuesAngebot!) : null;
          const alt = altRef ? await leseSlot(tx, altRef, altesAngebot!) : null;

          // ---------- 2. Prüfen ----------
          if (neu && neuesAngebot && neu.belegt + plaetze > neu.kapazitaet) {
            throw new AusgebuchtFehler(neuesAngebot);
          }

          // ---------- 3. Schreiben ----------
          if (neuRef && neu && neuesAngebot) schreibeSlot(tx, neuRef, neuesAngebot, neu, neu.belegt + plaetze);
          if (altRef && alt && altesAngebot) schreibeSlot(tx, altRef, altesAngebot, alt, Math.max(0, alt.belegt - plaetze));

          tx.set(
            buchungRef,
            {
              ...buchung,
              wahl: { ...leereWahl(), ...buchung.wahl, [blockId]: neuesAngebot },
              ...(vorhanden ? {} : { erstelltAm: serverTimestamp() }),
              geaendertAm: serverTimestamp(),
            },
            { merge: true },
          );
        });
      } catch (fehler) {
        if (istRechteFehler(fehler)) throw new RechteFehler();
        throw fehler;
      }
    }),
  );
}

/** Gruppengrösse ändern — nur solange nichts gebucht ist (die Rules erzwingen das ebenfalls). */
export function setzePlaetze(buchungId: string, plaetze: number): Promise<void> {
  return nacheinander(() =>
    mitWiederholung(async () => {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'bookings', buchungId);
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const b = snap.data() as Buchung;
        if (Object.values(b.wahl ?? {}).some(Boolean)) {
          throw new Error('Gruppengrösse nach der ersten Buchung nicht mehr änderbar');
        }
        tx.set(ref, { plaetze, geaendertAm: serverTimestamp() }, { merge: true });
      });
    }),
  );
}

/** Alle Wahlen freigeben und die Buchung löschen — «von vorne beginnen». */
export async function alleFreigeben(buchungId: string, wahl: Wahl): Promise<void> {
  for (const b of BLOCK_IDS) {
    if (wahl[b]) await waehle(buchungId, b, null, 1);
  }
}

/**
 * Admin erfasst eine Anmeldung für Gäste ohne Handy — alle vier Blöcke in EINER Transaktion.
 * Wieder gilt: erst alle Lesevorgänge, dann alle Schreibvorgänge.
 */
export async function erfasseAdminBuchung(
  auswahl: Partial<Record<BlockId, string | null>>,
  plaetze: number,
  notiz: string,
): Promise<{ id: string }> {
  const buchungRef = doc(collection(db, 'bookings'));
  const basis = neueBuchung(plaetze, 'admin');

  await mitWiederholung(async () => {
    await runTransaction(db, async (tx) => {
      const ids = BLOCK_IDS.map((b) => auswahl[b] ?? null);

      // ---------- Lesen ----------
      const staende = await Promise.all(
        ids.map(async (id) => (id ? { id, ...(await leseSlot(tx, doc(db, 'slots', id), id)) } : null)),
      );

      // ---------- Prüfen ----------
      for (const s of staende) {
        if (s && s.belegt + plaetze > s.kapazitaet) throw new AusgebuchtFehler(s.id);
      }

      // ---------- Schreiben ----------
      for (const s of staende) {
        if (!s) continue;
        schreibeSlot(tx, doc(db, 'slots', s.id), s.id, s, s.belegt + plaetze);
      }
      tx.set(buchungRef, {
        ...basis,
        notiz: notiz.trim() || null,
        wahl: { ...leereWahl(), ...auswahl },
        erstelltAm: serverTimestamp(),
        geaendertAm: serverTimestamp(),
      });
    });
  });

  return { id: buchungRef.id };
}
