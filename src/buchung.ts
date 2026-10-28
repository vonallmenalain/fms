import {
  collection, doc, runTransaction, serverTimestamp, type Transaction, type DocumentReference,
} from 'firebase/firestore';
import { db } from './firebase';
import { angebot, blockIds, type BlockId, type Wahl } from './programm';
import {
  AusgebuchtFehler, NichtMehrDaFehler, RechteFehler, mitWiederholung, nacheinander,
} from './wiederholung';
import { protokolliere, type Vorgangsnotiz } from './protokoll';
import { gemerktesGeraet, vergissGeraet } from './geraet';

export interface Buchung {
  plaetze: number;
  wahl: Record<BlockId, string | null>;
  quelle: 'gast' | 'admin';
  /** Name bei Anmeldungen vom Info-Stand, freiwillig. Der Feldname stammt aus der ersten
   *  Fassung («Notiz») und bleibt, damit Rules und bestehende Daten weiter passen. */
  notiz: string | null;
  erstelltAm?: unknown;
  geaendertAm?: unknown;
}

export const leereWahl = (): Record<BlockId, string | null> =>
  Object.fromEntries(blockIds().map((b) => [b, null])) as Record<BlockId, string | null>;

/**
 * Auswahl aus einem Formular → vollständige Wahl. Ein abgewählter Block kommt dort als
 * `undefined` an — und `undefined` lehnt Firestore ab: Wer am Info-Stand einen Block
 * wählte und wieder auf «— nichts —» stellte, konnte vorher nicht speichern.
 */
export const wahlAus = (auswahl: Partial<Record<BlockId, string | null>>): Record<BlockId, string | null> =>
  Object.fromEntries(blockIds().map((b) => [b, auswahl[b] || null])) as Record<BlockId, string | null>;

export const neueBuchung = (plaetze: number, quelle: 'gast' | 'admin' = 'gast'): Buchung => ({
  plaetze,
  wahl: leereWahl(),
  quelle,
  notiz: null,
});

/** Zeigen zwei Stände dieselbe Anmeldung? Zeitstempel zählen nicht. */
export function gleicheBuchung(a: Buchung | null, b: Buchung | null): boolean {
  if (!a || !b) return a === b;
  const bloecke = new Set([...Object.keys(a.wahl ?? {}), ...Object.keys(b.wahl ?? {})]) as Set<BlockId>;
  return a.plaetze === b.plaetze
    && [...bloecke].every((k) => (a.wahl?.[k] ?? null) === (b.wahl?.[k] ?? null));
}

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
  // Kein Angebot bedeutet: Es gibt hier nichts mehr zu buchen — Kapazität 0 statt einer
  // erfundenen Zahl. Die Prüfung weiter unten weist den Versuch dann als ausgebucht ab.
  return { belegt: 0, kapazitaet: a?.kapazitaet ?? 0, neu: true };
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
  if (!stand.neu) { tx.update(ref, { belegt }); return; }
  // Fehlt der Zähler UND kennt das Programm das Angebot nicht mehr (Bereich entfernt),
  // gibt es nichts anzulegen: Ein Zähler ohne Angebot wäre bloss eine erfundene Zahl.
  const blockId = angebot(angebotId)?.blockId;
  if (blockId) tx.set(ref, { belegt, kapazitaet: stand.kapazitaet, block: blockId });
}

/**
 * Eine Wahl setzen, ändern oder freigeben — alles in einer Transaktion:
 * alten Platz freigeben, neuen belegen, Buchung aktualisieren. Ganz oder gar nicht.
 *
 * WICHTIG: Firestore verlangt ALLE Lesevorgänge vor ALLEN Schreibvorgängen. Die drei
 * Abschnitte unten sind deshalb strikt getrennt.
 *
 * Gibt die Anmeldung so zurück, wie sie danach gespeichert ist. Der Bildschirm zeigt
 * genau das sofort an, statt auf den Live-Listener zu warten — siehe hooks/useBuchung.ts.
 */
export function waehle(
  buchungId: string,
  blockId: BlockId,
  neuesAngebot: string | null,
  vorgabePlaetze: number,
  quelle: 'gast' | 'admin' = 'gast',
): Promise<Buchung> {
  // Was die Transaktion getan hat, für das Protokoll. In einem Merkerobjekt, weil die
  // Transaktion bei Andrang mehrmals durchläuft — es zählt ausschliesslich der letzte,
  // erfolgreiche Durchgang.
  const merker: { notiz: Vorgangsnotiz | null } = { notiz: null };

  return nacheinander(() =>
    mitWiederholung(async () => {
      let ergebnis: Buchung;
      try {
        ergebnis = await runTransaction(db, async (tx): Promise<Buchung> => {
          merker.notiz = null;
          const buchungRef = doc(db, 'bookings', buchungId);

          // ---------- 1. Lesen ----------
          const buchungSnap = await tx.get(buchungRef);
          const vorhanden = buchungSnap.exists();
          const buchung: Buchung = vorhanden
            ? (buchungSnap.data() as Buchung)
            : neueBuchung(vorgabePlaetze, quelle);
          // Solange nichts gebucht ist, gibt der Bildschirm die Gruppengrösse vor: Der
          // Schreibvorgang von der Startseite darf noch unterwegs sein, ohne dass hier
          // eine überholte Zahl gebucht wird. Danach zählt der Wert aus der Datenbank —
          // die Security Rules erzwingen dasselbe.
          const nochNichtsGewaehlt = !Object.values(buchung.wahl ?? {}).some(Boolean);
          const plaetze = nochNichtsGewaehlt && neuesAngebot ? vorgabePlaetze : buchung.plaetze;
          const altesAngebot = buchung.wahl?.[blockId] ?? null;

          if (altesAngebot === neuesAngebot) return { ...buchung, wahl: { ...leereWahl(), ...buchung.wahl } };

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

          const wahlDanach = { ...leereWahl(), ...buchung.wahl, [blockId]: neuesAngebot };
          tx.set(
            buchungRef,
            {
              ...buchung,
              plaetze,
              wahl: wahlDanach,
              ...(vorhanden ? {} : { erstelltAm: serverTimestamp() }),
              geaendertAm: serverTimestamp(),
            },
            { merge: true },
          );

          merker.notiz = {
            vorgang: neuesAngebot ? (altesAngebot ? 'gewechselt' : 'gebucht') : 'freigegeben',
            block: blockId,
            angebot: neuesAngebot,
            vorher: altesAngebot,
            plaetze,
            slots: Object.values(wahlDanach).filter(Boolean).length,
          };
          return { ...buchung, plaetze, wahl: wahlDanach };
        });
      } catch (fehler) {
        if (istRechteFehler(fehler)) throw new RechteFehler();
        throw fehler;
      }
      // Erst hier, nach der bestätigten Transaktion, und ohne `await`: Das Protokoll darf
      // die Buchung weder verzögern noch scheitern lassen. Siehe src/protokoll.ts.
      if (merker.notiz) protokolliere(buchungId, quelle, merker.notiz);
      return ergebnis;
    }),
  );
}

/**
 * Zuletzt getippte Gruppengrösse. Wer schnell 1-2-3-4 durchtippt, löst sonst vier
 * Schreibvorgänge nacheinander aus; nur der letzte ist gemeint, die übrigen verzögern
 * bloss den nächsten Buchungsvorgang.
 */
let letzterPlaetzeWunsch: { id: string; wert: number } | null = null;

/** Gruppengrösse ändern — nur solange nichts gebucht ist (die Rules erzwingen das ebenfalls). */
export function setzePlaetze(buchungId: string, plaetze: number): Promise<void> {
  letzterPlaetzeWunsch = { id: buchungId, wert: plaetze };
  return nacheinander(() =>
    mitWiederholung(async () => {
      // Überholt: Es ist bereits ein neuerer Wert getippt worden.
      const wunsch = letzterPlaetzeWunsch;
      if (!wunsch || wunsch.id !== buchungId || wunsch.wert !== plaetze) return;
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
  for (const b of blockIds()) {
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
      const ids = blockIds().map((b) => auswahl[b] ?? null);

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
        wahl: wahlAus(auswahl),
        erstelltAm: serverTimestamp(),
        geaendertAm: serverTimestamp(),
      });
    });
  });

  // Eine Zeile für die ganze Erfassung — sie ist ja auch EIN Vorgang am Info-Stand,
  // nicht vier. `block` und `angebot` bleiben darum leer; was gewählt wurde, steht in
  // der Anmeldung selbst.
  protokolliere(buchungRef.id, 'admin', {
    vorgang: 'erfasst',
    block: null,
    angebot: null,
    vorher: null,
    plaetze,
    slots: blockIds().filter((b) => auswahl[b]).length,
  });

  return { id: buchungRef.id };
}

/**
 * Eine am Info-Stand erfasste Anmeldung ändern — Gruppengrösse, Wahl und Name in EINER
 * Transaktion. Jeder bisherige Platz wird mit der bisherigen Gruppengrösse freigegeben,
 * jeder neue mit der neuen belegt; bleibt ein Angebot gleich, verrechnet sich beides zu
 * einer einzigen Änderung des Zählers.
 *
 * Die Dokument-ID bleibt dieselbe, damit das Protokoll die Anmeldung weiterhin als ein
 * und denselben «Client» führt. Ins Protokoll kommt je geändertem Block eine Zeile — wie
 * bei einem Gast, der umbucht.
 */
export async function aendereErfassteAnmeldung(
  buchungId: string,
  auswahl: Partial<Record<BlockId, string | null>>,
  plaetze: number,
  notiz: string,
): Promise<void> {
  const merker: { vorher: Buchung | null } = { vorher: null };
  const wahl = wahlAus(auswahl);

  await mitWiederholung(async () => {
    await runTransaction(db, async (tx) => {
      merker.vorher = null;
      const buchungRef = doc(db, 'bookings', buchungId);

      // ---------- Lesen ----------
      const snap = await tx.get(buchungRef);
      if (!snap.exists()) throw new NichtMehrDaFehler();
      const alt = snap.data() as Buchung;
      const differenz = new Map<string, number>();
      const bloecke = new Set([...Object.keys(alt.wahl ?? {}), ...blockIds()]) as Set<BlockId>;
      for (const b of bloecke) {
        const bisher = alt.wahl?.[b];
        if (bisher) differenz.set(bisher, (differenz.get(bisher) ?? 0) - alt.plaetze);
        const neu = wahl[b];
        if (neu) differenz.set(neu, (differenz.get(neu) ?? 0) + plaetze);
      }
      const staende = await Promise.all(
        [...differenz].filter(([, d]) => d !== 0).map(async ([id, d]) =>
          ({ id, d, ...(await leseSlot(tx, doc(db, 'slots', id), id)) })),
      );

      // ---------- Prüfen ----------
      for (const s of staende) {
        if (s.d > 0 && s.belegt + s.d > s.kapazitaet) throw new AusgebuchtFehler(s.id);
      }

      // ---------- Schreiben ----------
      for (const s of staende) {
        // Fehlt der Zähler eines Angebots, das freigegeben wird, gibt es nichts freizugeben.
        if (s.neu && s.d < 0) continue;
        schreibeSlot(tx, doc(db, 'slots', s.id), s.id, s, Math.max(0, s.belegt + s.d));
      }
      tx.update(buchungRef, { plaetze, wahl, notiz: notiz.trim() || null, geaendertAm: serverTimestamp() });
      merker.vorher = alt;
    });
  });

  const alt = merker.vorher;
  if (!alt) return;
  const slots = Object.values(wahl).filter(Boolean).length;
  for (const b of blockIds()) {
    const vorher = alt.wahl?.[b] ?? null;
    const angebotId = wahl[b];
    if (vorher === angebotId) continue;
    protokolliere(buchungId, 'admin', {
      vorgang: angebotId ? (vorher ? 'gewechselt' : 'gebucht') : 'freigegeben',
      block: b, angebot: angebotId, vorher, plaetze, slots,
    });
  }
}

/**
 * Eine Anmeldung löschen und die Plätze dabei wieder freigeben — in EINER Transaktion.
 *
 * Für die Administration im Protokollbereich. Das blosse Löschen des Dokuments wäre ein
 * Fehler: Die Zähler in `slots` wüssten nichts davon, und die Invariante L1 aus
 * docs/05 §6 («Summe der Zähler = Summe der gebuchten Plätze») wäre gebrochen — die
 * Plätze blieben für immer belegt, ohne dass jemand darauf sitzt.
 */
export async function loescheAnmeldung(buchungId: string): Promise<void> {
  await mitWiederholung(async () => {
    await runTransaction(db, async (tx) => {
      const buchungRef = doc(db, 'bookings', buchungId);

      // ---------- Lesen ----------
      const snap = await tx.get(buchungRef);
      if (!snap.exists()) return;                    // schon weg, nichts zu tun
      const b = snap.data() as Buchung;
      const ids = blockIds().map((k) => b.wahl?.[k] ?? null).filter(Boolean) as string[];
      const staende = await Promise.all(
        ids.map(async (id) => ({ id, ...(await leseSlot(tx, doc(db, 'slots', id), id)) })),
      );

      // ---------- Schreiben ----------
      for (const s of staende) {
        // Fehlt der Zähler ganz, gibt es auch nichts freizugeben — ihn dafür neu
        // anzulegen hiesse, einen Platzstand zu erfinden.
        if (s.neu) continue;
        tx.update(doc(db, 'slots', s.id), { belegt: Math.max(0, s.belegt - (b.plaetze || 0)) });
      }
      tx.delete(buchungRef);
    });
  });
}

/**
 * Die auf diesem Gerät als Gast erstellte Anmeldung ins eigene Konto holen.
 *
 * Der Fall: Eine Betreuungsperson meldet sich morgens wie jeder Gast selbst an, meldet
 * sich danach unter /admin mit ihrer Adresse an — und Firebase ersetzt dabei die anonyme
 * Sitzung. Ihre Anmeldung läge ab da unter einer uid, die niemand mehr besitzt: eine
 * Schattenbuchung, die Plätze belegt und die nur noch die Administration wegräumen kann.
 *
 * Verschoben wird in EINER Transaktion — altes Dokument lesen, neues schreiben, altes
 * löschen. Die Zähler bleiben unberührt, weil sich an der Zahl der belegten Plätze nichts
 * ändert; ein Zwischenzustand, in dem die Anmeldung weg und die Plätze noch belegt sind,
 * kann gar nicht entstehen.
 *
 * Gibt `true` zurück, wenn tatsächlich etwas übernommen wurde.
 */
let laufendeUebernahme: Promise<boolean> | null = null;

export function uebernimmGeraeteAnmeldung(neueUid: string): Promise<boolean> {
  // React ruft Effekte im Entwicklungsmodus doppelt auf, und ein schneller Wechsel
  // zwischen Betreuung und Hauptseite kann dasselbe. Beide Aufrufe lasen sonst denselben
  // Merker, bevor der erste ihn löschte — und das Protokoll bekäme zwei Übernahmen für
  // einen Vorgang. Der zweite Aufruf hängt sich deshalb an den ersten an.
  laufendeUebernahme ??= holeGeraeteAnmeldung(neueUid)
    .finally(() => { laufendeUebernahme = null; });
  return laufendeUebernahme;
}

async function holeGeraeteAnmeldung(neueUid: string): Promise<boolean> {
  const alteUid = gemerktesGeraet();
  if (!alteUid || alteUid === neueUid) return false;

  // Merkerobjekt wie in `waehle`: Die Transaktion kann mehrmals durchlaufen, es zählt
  // ausschliesslich der letzte, erfolgreiche Durchgang.
  const merker: { geholt: { slots: number; plaetze: number } | null } = { geholt: null };
  await mitWiederholung(async () => {
    merker.geholt = null;
    await runTransaction(db, async (tx) => {
      const altRef = doc(db, 'bookings', alteUid);
      const neuRef = doc(db, 'bookings', neueUid);
      const [alt, neu] = [await tx.get(altRef), await tx.get(neuRef)];

      if (!alt.exists()) return;
      const b = alt.data() as Buchung;
      if (!Object.values(b.wahl ?? {}).some(Boolean)) return;   // leere Hülle, nichts wert

      // Das Konto hat bereits eine eigene Anmeldung. Sie zu überschreiben würde deren
      // Plätze verwaisen lassen — dann lieber gar nichts tun und die alte der
      // Administration überlassen, die sie im Protokoll löschen kann.
      if (neu.exists() && Object.values((neu.data() as Buchung).wahl ?? {}).some(Boolean)) return;

      tx.set(neuRef, { ...b, geaendertAm: serverTimestamp() });
      tx.delete(altRef);
      merker.geholt = {
        slots: Object.values(b.wahl ?? {}).filter(Boolean).length,
        plaetze: b.plaetze,
      };
    });
  });

  // Auch wenn nichts zu holen war: Der Merker hat seinen Zweck erfüllt. Bliebe er
  // stehen, erbte die nächste Person am selben Gerät fremde Anmeldungen.
  vergissGeraet();

  const geholt = merker.geholt;
  if (!geholt) return false;
  // Die Protokollzeilen der alten Kennung bleiben stehen — sie sind angeschrieben und
  // unveränderlich, das ist der Sinn eines Protokolls. Damit die Administration die
  // plötzlich vorgangslose Anmeldung trotzdem einordnen kann, bekommt die neue Kennung
  // hier ihre erste eigene Zeile.
  protokolliere(neueUid, 'gast', {
    vorgang: 'uebernommen',
    block: null,
    angebot: null,
    vorher: null,
    plaetze: geholt.plaetze,
    slots: geholt.slots,
  });
  return true;
}
