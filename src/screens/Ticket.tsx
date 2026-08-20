import { Kopf } from '../ui/Bausteine';
import {
  ANGEBOTE, BLOECKE, angebot, angeboteFuer, programm, zeitraum, metaZeile, datumLang, type BlockId,
} from '../programm';
import { useAlleSlotsEinmalig, type Staende } from '../hooks/useSlots';
import type { Buchung } from '../buchung';

export function Ticket({
  buchung, onAendern, onNeuBeginnen, nurAnsicht,
}: {
  buchung: Buchung;
  onAendern: (b: BlockId) => void;
  onNeuBeginnen?: () => void;
  nurAnsicht?: boolean;
}) {
  const rahmen = programm.rahmenprogramm[0];
  const anzahl = Object.values(buchung.wahl).filter(Boolean).length;
  const { staende, zeitpunkt, laedt, aktualisieren } = useAlleSlotsEinmalig(!nurAnsicht);

  return (
    <div className="seite">
      <Kopf klein />

      <div className="stapel">
        <h1>Deine Auswahl</h1>
        <p className="lauftext">
          {datumLang()}
          {buchung.plaetze > 1 && <> · <b>gültig für {buchung.plaetze} Personen</b></>}
        </p>
      </div>

      {anzahl === 0 && (
        <div className="hinweis hinweis--warnung">
          <b>Du hast noch nichts gewählt.</b> Tippe unten auf einen Block, um ein Atelier oder
          eine Lektion auszusuchen.
        </div>
      )}

      <div className="ticket">
        {rahmen && (
          <div className="ticket-karte" data-leer="1">
            <span className="ticket-zeit">{rahmen.von}<br />{rahmen.bis}</span>
            <span className="ticket-block">Für alle</span>
            <span className="ticket-fach">Begrüssung</span>
            <span className="ticket-ort">{rahmen.ort}</span>
          </div>
        )}

        {BLOECKE.map((b) => {
          const a = angebot(buchung.wahl[b.id]);
          return (
            <button
              key={b.id}
              type="button"
              className="ticket-karte"
              data-leer={a ? '0' : '1'}
              onClick={() => onAendern(b.id)}
              disabled={nurAnsicht}
              style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: nurAnsicht ? 'default' : 'pointer', width: '100%' }}
              aria-label={a ? `${b.label}, ${a.fach}, ${metaZeile(a)}, ${zeitraum(b)} — ändern` : `${b.label} — noch nichts gewählt, jetzt wählen`}
            >
              <span className="ticket-zeit">{b.von}<br />{b.bis}</span>
              {/* Das Blocklabel steht jetzt auf jeder Karte — sonst sieht man dem Ticket
                  nicht an, welche Zeile ein Atelier und welche ein Unterrichtsbesuch ist. */}
              <span className="ticket-block">{b.label}</span>
              <span className="ticket-fach">
                {a ? a.fach : <span style={{ color: 'var(--grau-hell)', fontWeight: 500 }}>nichts gewählt</span>}
              </span>
              <span className="ticket-ort">
                {a ? metaZeile(a) : 'noch offen'}
                {!nurAnsicht && <span style={{ color: 'var(--gruen-dunkel)', fontWeight: 600 }}>{a ? '  ·  ändern' : '  ·  wählen'}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="hinweis">
        <b>Mach jetzt einen Screenshot.</b> Dann hast du deine Auswahl auch ohne Internet dabei.
        Diese Seite lässt sich auf diesem Handy jederzeit wieder öffnen.
      </div>

      <hr className="trenner" />

      <div className="stapel">
        <h3>Zimmer finden</h3>
        <p className="klein">
          <b>GN</b> = {programm.raumlegende.GN}<br />
          <b>GS</b> = {programm.raumlegende.GS}
        </p>
        <p className="klein">{programm.raumlegende.hinweis}</p>
        {programm.hinweise.map((h) => <p key={h} className="klein">{h}</p>)}
        <p className="klein">Fragen? Info-Stand: {programm.event.infostand}.</p>
      </div>

      {!nurAnsicht && staende && (
        <>
          <hr className="trenner" />
          <Auslastung staende={staende} zeitpunkt={zeitpunkt} laedt={laedt} onAktualisieren={aktualisieren} />
        </>
      )}

      {!nurAnsicht && onNeuBeginnen && (
        <>
          <hr className="trenner" />
          <button type="button" className="knopf knopf--still" onClick={onNeuBeginnen}>
            Alle Plätze freigeben und neu beginnen
          </button>
        </>
      )}
    </div>
  );
}

/** Ist dieses Angebot voll? Fehlt der Zähler, ist noch nichts darauf gebucht. */
function istAusgebucht(staende: Staende, angebotId: string, kapazitaet: number): boolean {
  const stand = staende[angebotId];
  const platz = stand?.kapazitaet || kapazitaet;
  return platz > 0 && (stand?.belegt ?? 0) >= platz;
}

/**
 * «Wie voll ist es schon?» — die Zahl, nach der am Besuchsmorgen alle fragen.
 * Momentaufnahme statt Live-Zähler, siehe useAlleSlotsEinmalig.
 */
function Auslastung({
  staende, zeitpunkt, laedt, onAktualisieren,
}: {
  staende: Staende;
  zeitpunkt: Date | null;
  laedt: boolean;
  onAktualisieren: () => void;
}) {
  const gesamt = ANGEBOTE.length;
  const voll = ANGEBOTE.filter((a) => istAusgebucht(staende, a.id, a.kapazitaet)).length;

  return (
    <div className="stapel">
      <h3>Wie voll ist es schon?</h3>
      <p className="klein">
        {voll === 0
          ? <>Aktuell ist <b>noch kein Angebot</b> ausgebucht — alle {gesamt} haben noch freie Plätze.</>
          : <><b>{voll} von {gesamt} Angeboten</b> sind ausgebucht.</>}
      </p>

      <ul className="auslastung">
        {BLOECKE.map((b) => {
          const angebote = angeboteFuer(b.id);
          const vollImBlock = angebote.filter((a) => istAusgebucht(staende, a.id, a.kapazitaet)).length;
          return (
            <li key={b.id} data-alles-voll={vollImBlock === angebote.length ? '1' : '0'}>
              <span>{b.label}</span>
              <span className="zahl">
                {vollImBlock === 0
                  ? `alle ${angebote.length} frei`
                  : `${vollImBlock} von ${angebote.length} ausgebucht`}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mini">
        Momentaufnahme{zeitpunkt && <> von {uhrzeit(zeitpunkt)}</>}
        {' · '}
        <button type="button" className="textknopf" onClick={onAktualisieren} disabled={laedt}>
          {laedt ? 'wird geladen …' : 'aktualisieren'}
        </button>
      </p>
    </div>
  );
}

const uhrzeit = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} Uhr`;
