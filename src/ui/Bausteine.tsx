import { useEffect, useRef } from 'react';
import { blockIds, type BlockId } from '../programm';

export function Kopf({ klein, claim, onHome }: { klein?: boolean; claim?: boolean; onHome?: () => void }) {
  const bild = (
    <img
      className={klein ? 'logo logo--klein' : 'logo'}
      src="/fms-neufeld.png"
      width={640}
      height={132}
      alt="fms Neufeld"
    />
  );
  return (
    <div className="kopf">
      {/* Das Logo führt zurück auf die Startseite — dorthin, wo man loslegt bzw. seine
          Auswahl ansieht. Auf der Startseite selbst gibt es nichts zu tun: Dann bleibt es
          ein Bild und kein toter Knopf. */}
      {onHome ? (
        <button
          type="button"
          className={klein ? 'logo-knopf logo-knopf--klein' : 'logo-knopf'}
          onClick={onHome}
          aria-label="Zur Startseite"
        >
          {bild}
        </button>
      ) : bild}
      {claim && <p className="claim">der ort für alltagsheld:innen</p>}
    </div>
  );
}

export function Fortschritt({ aktuell, entschieden }: { aktuell: BlockId; entschieden: Set<BlockId> }) {
  const ids = blockIds();
  const nr = ids.indexOf(aktuell) + 1;
  return (
    <div className="fortschritt">
      <div className="fortschritt-zeile">
        <h3>Schritt {nr} von {ids.length}</h3>
      </div>
      <div className="fortschritt-balken" aria-hidden="true">
        {ids.map((b) => (
          <i key={b} data-an={b === aktuell ? 'teil' : entschieden.has(b) ? '1' : '0'} />
        ))}
      </div>
    </div>
  );
}

export function Meldung({ text, onWeg }: { text: string; onWeg: () => void }) {
  // `onWeg` kommt als frisch erzeugte Funktion herein und wäre als Abhängigkeit ein
  // Dauerlauf: Auf der Auswahlseite zeichnet jede fremde Buchung den Bildschirm neu, der
  // Zeitgeber begänne jedes Mal von vorn — und die Meldung bliebe im Andrang ewig stehen.
  // Darum hängt der Zeitgeber nur am Text; die Funktion liegt daneben in einem Merker.
  const weg = useRef(onWeg);
  weg.current = onWeg;
  useEffect(() => {
    const t = setTimeout(() => weg.current(), 4200);
    return () => clearTimeout(t);
  }, [text]);
  return <div className="meldung" role="status">{text}</div>;
}

export function Banner({ text }: { text: string }) {
  return <div className="banner" role="status">{text}</div>;
}

export function Laden({ text = 'Einen Moment …' }: { text?: string }) {
  return (
    <div className="seite">
      <Kopf />
      <p className="lauftext">{text}</p>
    </div>
  );
}
