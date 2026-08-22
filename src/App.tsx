import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { AnmeldeAndrangFehler, benutzerBereit, bestehenderBenutzer } from './firebase';
import { BLOCK_IDS, programm, type BlockId } from './programm';
import { useAppConfig } from './hooks/useAppConfig';
import { useBuchung } from './hooks/useBuchung';
import { useSlots } from './hooks/useSlots';
import { setzePlaetze, uebernimmGeraeteAnmeldung, waehle } from './buchung';
import { AusgebuchtFehler, RechteFehler } from './wiederholung';
import { angebot } from './programm';
import { Banner, Laden, Meldung } from './ui/Bausteine';
import { Start } from './screens/Start';
import { Auswahl } from './screens/Auswahl';
import { Ticket } from './screens/Ticket';
import { useRoute } from './hooks/useRoute';
import { useVerlauf } from './hooks/useVerlauf';

const Admin = lazy(() => import('./screens/Admin'));

type Schritt = 'start' | BlockId | 'ticket';

export default function App() {
  const [pfad, gehe] = useRoute();
  if (pfad.startsWith('/admin')) {
    return (
      <Suspense fallback={<Laden text="Admin-Bereich wird geladen …" />}>
        <Admin onRaus={() => gehe('/')} />
      </Suspense>
    );
  }
  return <GastApp />;
}

function GastApp() {
  const [benutzer, setBenutzer] = useState<User | null>(null);
  const [authGeprueft, setAuthGeprueft] = useState(false);
  const { config, veraltet } = useAppConfig();
  const { buchung, geladen: buchungGeladen } = useBuchung(benutzer?.uid ?? null);

  // Jeder Bildschirmwechsel ist ein History-Eintrag — damit geht der Zurück-Knopf des
  // Handys genau einen Bildschirm zurück statt aus der App hinaus.
  const { schritt, gehe, ersetze } = useVerlauf<Schritt>('start');
  const [plaetze, setPlaetzeLokal] = useState(1);
  const [laeuftFuer, setLaeuftFuer] = useState<string | null>(null);
  const [gibtFrei, setGibtFrei] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const startGesetzt = useRef(false);
  const tippLaeuft = useRef(false);
  const aufgebaut = useRef(false);

  // Beim Laden NUR nachsehen, ob dieses Gerät schon eine Sitzung hat — kein Netzaufruf,
  // keine Neuanmeldung. Angemeldet wird erst beim ersten Buchen (siehe firebase.ts).
  useEffect(() => {
    bestehenderBenutzer()
      .then(async (u) => {
        // Eine angemeldete Betreuungsperson bringt womöglich ihre eigene Anmeldung von
        // vorhin mit — erstellt als Gast, bevor sie sich anmeldete. Sie wird HIER, vor
        // dem ersten Zeichnen, in ihr Konto geholt: Sonst stünde auf dem Schirm «noch
        // keine Anmeldung», während ihre Plätze belegt sind und niemand mehr an sie
        // herankommt. Für gewöhnliche Gäste kostet die Zeile nichts — sie sind anonym.
        if (u && !u.isAnonymous && (await uebernimmGeraeteAnmeldung(u.uid).catch(() => false))) {
          setMeldung('Deine Anmeldung von diesem Gerät gehört jetzt zu deinem Konto.');
        }
        setBenutzer(u);
        // Gab es beim Laden keine Sitzung, ist dies ein neues Gerät: dann darf die
        // Ticket-Wiederherstellung unten später nicht mehr auslösen, sonst springt sie
        // nach der ersten Buchung fälschlich ans Ende.
        if (!u) startGesetzt.current = true;
        setAuthGeprueft(true);
      })
      .catch(() => { startGesetzt.current = true; setAuthGeprueft(true); });
  }, []);

  // Bestehendes Ticket auf diesem Gerät? Dann direkt dorthin — einmalig beim Laden.
  useEffect(() => {
    if (!buchungGeladen || startGesetzt.current) return;
    startGesetzt.current = true;
    if (buchung) {
      setPlaetzeLokal(buchung.plaetze);
      // Ersetzen statt anhängen: Das ist der Einstiegsbildschirm dieses Besuchs, kein Schritt.
      if (Object.values(buchung.wahl).some(Boolean)) ersetze('ticket');
    }
  }, [buchungGeladen, buchung, ersetze]);

  // Die Gruppengrösse gehört dem Bildschirm: Sie wirkt sofort, gespeichert wird nebenbei.
  // Ohne diesen Merker holten die Rückmeldungen des Servers überholte Zwischenstände
  // zurück auf den Schirm — bei schnellem Tippen sprangen die Knöpfe mehrmals nach.
  const plaetzeWunsch = useRef<number | null>(null);

  useEffect(() => {
    if (!buchung) return;
    if (plaetzeWunsch.current !== null) {
      // Erst wenn der Server den eigenen Wunsch bestätigt, folgen wir ihm wieder.
      if (buchung.plaetze === plaetzeWunsch.current) plaetzeWunsch.current = null;
      return;
    }
    setPlaetzeLokal(buchung.plaetze);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buchung?.plaetze]);

  const blockSchritt = schritt !== 'start' && schritt !== 'ticket' ? (schritt as BlockId) : null;
  const { staende, geladen: slotsGeladen } = useSlots(blockSchritt, config.liveZaehler);

  // Die drei Knöpfe der Auswahl laufen immer der Reihe nach durch das Programm —
  // Start · Atelier 1 · Atelier 2 · Unterrichtsbesuch 1 · Unterrichtsbesuch 2 · Übersicht.
  // Bewusst NICHT über den Browser-Verlauf: Wer aus der Übersicht heraus auf «ändern»
  // getippt hat, soll mit «Zurück» trotzdem im vorherigen Block landen und nicht dort,
  // wo er hergekommen ist.
  const abschliessen = useCallback(() => { gehe('ticket'); }, [gehe]);

  const weiter = useCallback((von: BlockId) => {
    const i = BLOCK_IDS.indexOf(von);
    gehe(i + 1 < BLOCK_IDS.length ? BLOCK_IDS[i + 1] : 'ticket');
  }, [gehe]);

  const zurueck = useCallback((von: BlockId) => {
    const i = BLOCK_IDS.indexOf(von);
    gehe(i > 0 ? BLOCK_IDS[i - 1] : 'start');
  }, [gehe]);

  // Ein Tipp auf eine Karte wählt nur noch aus — weitergeblättert wird über die
  // Navigationsknöpfe. Ein zweiter Tipp auf dieselbe Karte hebt die Wahl wieder auf,
  // ein Tipp auf eine andere Karte tauscht sie (das erledigt `waehle` in einem Zug).
  const waehlen = useCallback(async (blockId: BlockId, angebotId: string | null) => {
    if (tippLaeuft.current) return;           // ein Tipp ist schon unterwegs
    const schonGewaehlt = buchung?.wahl?.[blockId] ?? null;
    const ziel = angebotId !== null && schonGewaehlt === angebotId ? null : angebotId;

    tippLaeuft.current = true;
    setLaeuftFuer(angebotId);
    try {
      // Anmeldung erst hier — das verteilt die Anmeldungen über die Auswahlzeit.
      const u = benutzer ?? (await benutzerBereit());
      if (!benutzer) setBenutzer(u);
      await waehle(u.uid, blockId, ziel, plaetze);
    } catch (fehler) {
      if (fehler instanceof AnmeldeAndrangFehler) {
        setMeldung('Gerade melden sich sehr viele gleichzeitig an. Bitte in ein paar Sekunden nochmals tippen.');
      } else if (fehler instanceof AusgebuchtFehler) {
        const a = angebot(fehler.angebotId);
        setMeldung(`${a?.fach ?? 'Das Angebot'} ist leider gerade eben ausgebucht. Bitte wähle etwas anderes.`);
      } else if (fehler instanceof RechteFehler) {
        if (config.anmeldungOffen) {
          setMeldung('Das hat der Server abgelehnt. Bitte versuche es noch einmal.');
        } else {
          setMeldung('Die Anmeldung ist im Moment geschlossen.');
          ersetze('start');
        }
      } else {
        setMeldung('Das hat nicht geklappt. Bitte versuche es noch einmal.');
      }
    } finally {
      tippLaeuft.current = false;
      setLaeuftFuer(null);
    }
  }, [benutzer, buchung, plaetze, config.anmeldungOffen, ersetze]);

  const plaetzeAendern = useCallback((n: number) => {
    setPlaetzeLokal(n);                       // sofort, ohne Netz
    if (!benutzer || !buchung) return;        // vor der ersten Buchung gibt es kein Dokument
    plaetzeWunsch.current = n;
    setzePlaetze(benutzer.uid, n).catch(() => {
      // Abgelehnt (z. B. weil inzwischen gebucht wurde): ehrlich bleiben und zurückfallen.
      plaetzeWunsch.current = null;
      setPlaetzeLokal(buchung.plaetze);
    });
  }, [benutzer, buchung]);

  const neuBeginnen = useCallback(async () => {
    if (!benutzer || !buchung || gibtFrei) return;
    // Vier Blöcke nacheinander freigeben dauert einen Moment. Ohne sichtbares Zeichen
    // wirkt die App in dieser Zeit, als hätte sie den Tipp verschluckt.
    setGibtFrei(true);
    try {
      let alleFrei = true;
      for (const b of BLOCK_IDS) {
        if (buchung.wahl[b]) alleFrei = (await waehlenStill(benutzer.uid, b)) && alleFrei;
      }
      // Ehrlich bleiben: Ist die Anmeldung inzwischen geschlossen, weist der Server die
      // Freigabe ab. Vorher meldete die App trotzdem Erfolg und warf die Person auf den
      // Start — wo ihre Auswahl weiterhin stand. Das ist schlimmer als eine Absage.
      if (alleFrei) {
        ersetze('start');
        setMeldung('Alle Plätze wurden freigegeben.');
      } else {
        setMeldung('Die Plätze liessen sich nicht freigeben. Bitte nochmals versuchen '
          + 'oder am Info-Stand melden.');
      }
    } finally {
      setGibtFrei(false);
    }
  }, [benutzer, buchung, ersetze, gibtFrei]);

  // Der Ladebildschirm gehört ausschliesslich zum ERSTEN Aufbau: Dort muss feststehen, ob
  // dieses Gerät schon ein Ticket hat, sonst blitzt die Startseite auf und springt sofort
  // weiter. Sobald einmal etwas Richtiges auf dem Schirm stand, darf er nie wieder kommen.
  //
  // Sonst passiert genau das: Beim ersten Tipp auf eine Karte meldet sich das Gerät an
  // (siehe `waehlen`), dadurch beginnt useBuchung zu laden — und die ganze Angebotsliste
  // verschwände mitten im Tippen hinter «Einen Moment …». Im Browsertest mit 150 ms
  // Mobilfunk-Latenz waren das 524 ms Leere ausgerechnet beim allerersten Tipp.
  if (!aufgebaut.current && (!authGeprueft || (benutzer && !buchungGeladen))) return <Laden />;
  aufgebaut.current = true;

  const etwasGewaehlt = buchung ? Object.values(buchung.wahl).some(Boolean) : false;

  return (
    <>
      {veraltet && <Banner text="Das Programm wurde angepasst — bitte lade die Seite neu." />}
      {config.banner && <Banner text={config.banner} />}

      {schritt === 'start' && (
        <Start
          config={config}
          plaetze={plaetze}
          setPlaetze={plaetzeAendern}
          plaetzeSperren={etwasGewaehlt}
          hatTicket={etwasGewaehlt}
          onStart={() => gehe(BLOCK_IDS[0])}
          onTicket={() => gehe('ticket')}
        />
      )}

      {blockSchritt && (
        <Auswahl
          blockId={blockSchritt}
          staende={staende}
          geladen={slotsGeladen}
          buchung={buchung}
          plaetze={plaetze}
          laeuftFuer={laeuftFuer}
          onWahl={(id) => waehlen(blockSchritt, id)}
          onWeiter={() => weiter(blockSchritt)}
          onZurueck={() => zurueck(blockSchritt)}
          onAbschliessen={abschliessen}
        />
      )}

      {schritt === 'ticket' && buchung && (
        <Ticket
          buchung={buchung}
          onAendern={gehe}
          onNeuBeginnen={neuBeginnen}
          onHome={() => gehe('start')}
          gibtFrei={gibtFrei}
        />
      )}
      {schritt === 'ticket' && !buchung && (
        <div className="seite">
          <div className="hinweis hinweis--warnung">Es ist noch keine Anmeldung vorhanden.</div>
          <button type="button" className="knopf knopf--haupt" onClick={() => ersetze('start')}>
            Zur Anmeldung
          </button>
        </div>
      )}

      {meldung && <Meldung text={meldung} onWeg={() => setMeldung(null)} />}

      {/* Zwei Zeilen, und jede Wortgruppe bleibt zusammen: «WebApp von» darf nicht auf der
          einen und «Alä» auf der nächsten Zeile stehen. */}
      <footer className="fusszeile mini nicht-drucken">
        <p>
          <a className="zusammen" href="/admin">Login Betreuungspersonen</a>
          {/* Geschütztes Leerzeichen vor dem Punkt: So kann höchstens NACH dem Trenner
              umbrochen werden — nie so, dass «·» allein auf einer Zeile steht. */}
          <span aria-hidden="true">{'\u00A0· '}</span>
          <span className="zusammen">
            WebApp von{' '}
            <a href="https://alae.app" target="_blank" rel="noopener noreferrer">Alä</a>
          </span>
        </p>
        <p>{programm.event.titel}</p>
      </footer>
    </>
  );
}

/** Freigeben ohne Weiterspringen — für «alles zurücksetzen». `false` heisst: hat nicht geklappt. */
async function waehlenStill(uid: string, blockId: BlockId): Promise<boolean> {
  try { await waehle(uid, blockId, null, 1); return true; } catch { return false; }
}
