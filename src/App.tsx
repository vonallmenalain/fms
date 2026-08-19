import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { AnmeldeAndrangFehler, benutzerBereit, bestehenderBenutzer } from './firebase';
import { BLOCK_IDS, programm, type BlockId } from './programm';
import { useAppConfig } from './hooks/useAppConfig';
import { useBuchung } from './hooks/useBuchung';
import { useSlots } from './hooks/useSlots';
import { setzePlaetze, waehle } from './buchung';
import { AusgebuchtFehler, RechteFehler } from './wiederholung';
import { angebot } from './programm';
import { Banner, Laden, Meldung } from './ui/Bausteine';
import { Start } from './screens/Start';
import { Auswahl } from './screens/Auswahl';
import { Ticket } from './screens/Ticket';
import { useRoute } from './hooks/useRoute';

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

  const [schritt, setSchritt] = useState<Schritt>('start');
  const [plaetze, setPlaetzeLokal] = useState(1);
  const [ausTicket, setAusTicket] = useState(false);
  const [laeuftFuer, setLaeuftFuer] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const startGesetzt = useRef(false);

  // Beim Laden NUR nachsehen, ob dieses Gerät schon eine Sitzung hat — kein Netzaufruf,
  // keine Neuanmeldung. Angemeldet wird erst beim ersten Buchen (siehe firebase.ts).
  useEffect(() => {
    bestehenderBenutzer()
      .then((u) => {
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
      if (Object.values(buchung.wahl).some(Boolean)) setSchritt('ticket');
    }
  }, [buchungGeladen, buchung]);

  useEffect(() => {
    if (buchung && buchung.plaetze !== plaetze) setPlaetzeLokal(buchung.plaetze);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buchung?.plaetze]);

  const blockSchritt = schritt !== 'start' && schritt !== 'ticket' ? (schritt as BlockId) : null;
  const { staende, geladen: slotsGeladen } = useSlots(blockSchritt, config.liveZaehler);

  const weiter = useCallback((von: BlockId) => {
    if (ausTicket) { setAusTicket(false); setSchritt('ticket'); return; }
    const i = BLOCK_IDS.indexOf(von);
    setSchritt(i + 1 < BLOCK_IDS.length ? BLOCK_IDS[i + 1] : 'ticket');
    window.scrollTo(0, 0);
  }, [ausTicket]);

  const zurueck = useCallback((von: BlockId) => {
    if (ausTicket) { setAusTicket(false); setSchritt('ticket'); return; }
    const i = BLOCK_IDS.indexOf(von);
    setSchritt(i > 0 ? BLOCK_IDS[i - 1] : 'start');
    window.scrollTo(0, 0);
  }, [ausTicket]);

  const waehlen = useCallback(async (blockId: BlockId, angebotId: string | null) => {
    const schonGewaehlt = buchung?.wahl?.[blockId] ?? null;
    if (angebotId && schonGewaehlt === angebotId) { weiter(blockId); return; }

    setLaeuftFuer(angebotId);
    try {
      // Anmeldung erst hier — das verteilt die Anmeldungen über die Auswahlzeit.
      const u = benutzer ?? (await benutzerBereit());
      if (!benutzer) setBenutzer(u);
      await waehle(u.uid, blockId, angebotId, plaetze);
      if (angebotId) weiter(blockId);
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
          setSchritt('start');
        }
      } else {
        setMeldung('Das hat nicht geklappt. Bitte versuche es noch einmal.');
      }
    } finally {
      setLaeuftFuer(null);
    }
  }, [benutzer, buchung, plaetze, weiter, config.anmeldungOffen]);

  const plaetzeAendern = useCallback((n: number) => {
    setPlaetzeLokal(n);   // vor der ersten Buchung nur lokal — es gibt noch kein Dokument
    if (benutzer && buchung) setzePlaetze(benutzer.uid, n).catch(() => undefined);
  }, [benutzer, buchung]);

  const neuBeginnen = useCallback(async () => {
    if (!benutzer || !buchung) return;
    for (const b of BLOCK_IDS) {
      if (buchung.wahl[b]) await waehlenStill(benutzer.uid, b);
    }
    setSchritt('start');
    setMeldung('Alle Plätze wurden freigegeben.');
  }, [benutzer, buchung]);

  // Auf die Buchung warten wir nur, wenn dieses Gerät überhaupt schon angemeldet ist.
  if (!authGeprueft || (benutzer && !buchungGeladen)) return <Laden />;

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
          onStart={() => setSchritt(BLOCK_IDS[0])}
          onTicket={() => setSchritt('ticket')}
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
          ausTicket={ausTicket}
          onWahl={(id) => waehlen(blockSchritt, id)}
          onUeberspringen={() => weiter(blockSchritt)}
          onZurueck={() => zurueck(blockSchritt)}
        />
      )}

      {schritt === 'ticket' && buchung && (
        <Ticket
          buchung={buchung}
          onAendern={(b) => { setAusTicket(true); setSchritt(b); window.scrollTo(0, 0); }}
          onNeuBeginnen={neuBeginnen}
        />
      )}
      {schritt === 'ticket' && !buchung && (
        <div className="seite">
          <div className="hinweis hinweis--warnung">Es ist noch keine Anmeldung vorhanden.</div>
          <button type="button" className="knopf knopf--haupt" onClick={() => setSchritt('start')}>
            Zur Anmeldung
          </button>
        </div>
      )}

      {meldung && <Meldung text={meldung} onWeg={() => setMeldung(null)} />}

      <p className="mini mitte nicht-drucken" style={{ padding: '8px 16px 24px' }}>
        {programm.event.titel} · <a href="/admin" style={{ color: 'inherit' }}>Für Lehrpersonen</a>
      </p>
    </>
  );
}

/** Freigeben ohne Weiterspringen — für «alles zurücksetzen». */
async function waehlenStill(uid: string, blockId: BlockId) {
  try { await waehle(uid, blockId, null, 1); } catch { /* egal, best effort */ }
}
