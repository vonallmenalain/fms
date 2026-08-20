import { useEffect, useState } from 'react';
import { Kopf } from '../ui/Bausteine';
import { BLOECKE, angebot, programm, zeitraum, metaZeile, datumLang, type BlockId } from '../programm';
import type { Buchung } from '../buchung';

export function Ticket({
  buchung, onAendern, onNeuBeginnen, gibtFrei, nurAnsicht,
}: {
  buchung: Buchung;
  onAendern: (b: BlockId) => void;
  onNeuBeginnen?: () => void;
  gibtFrei?: boolean;
  nurAnsicht?: boolean;
}) {
  const rahmen = programm.rahmenprogramm[0];
  const anzahl = Object.values(buchung.wahl).filter(Boolean).length;
  // Freigeben ist nicht rückgängig zu machen — ein einzelner Fehltipp würde alle vier
  // Plätze verlieren. Darum erst die Rückfrage, dann die Tat.
  const [fragtFreigabe, setFragtFreigabe] = useState(false);

  // Ist alles freigegeben, verschwindet der Bereich ohnehin — die Rückfrage darf dann
  // nicht als Rest stehen bleiben, falls dieser Bildschirm sichtbar bleibt.
  useEffect(() => { if (anzahl === 0) setFragtFreigabe(false); }, [anzahl]);

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

      {!nurAnsicht && onNeuBeginnen && (
        <>
          <hr className="trenner" />
          {fragtFreigabe ? (
            <div className="hinweis hinweis--warnung stapel">
              <p><b>Möchtest du wirklich alle Plätze freigeben?</b> Deine Ateliers und
                Unterrichtsbesuche werden dann für andere frei — das lässt sich nicht
                rückgängig machen.</p>
              <div className="knopfzeile knopfzeile--gestapelt">
                <button type="button" className="knopf knopf--gefahr"
                  onClick={onNeuBeginnen} disabled={gibtFrei} aria-busy={gibtFrei}>
                  {gibtFrei && <span className="laderad laderad--knopf" aria-hidden="true" />}
                  {gibtFrei ? 'Plätze werden freigegeben …' : 'Ja, alle freigeben'}
                </button>
                <button type="button" className="knopf knopf--rand"
                  onClick={() => setFragtFreigabe(false)} disabled={gibtFrei}>
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="knopf knopf--still"
              onClick={() => setFragtFreigabe(true)}>
              Alle Plätze freigeben und neu beginnen
            </button>
          )}
        </>
      )}
    </div>
  );
}
