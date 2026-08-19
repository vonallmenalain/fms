import { useEffect } from 'react';
import { BLOCK_IDS, type BlockId } from '../programm';

export function Kopf({ klein, claim }: { klein?: boolean; claim?: boolean }) {
  return (
    <div className="kopf">
      <img
        className="logo"
        src="/fms-neufeld.png"
        width={640}
        height={132}
        alt="fms Neufeld"
        style={klein ? { width: 130 } : undefined}
      />
      {claim && <p className="claim">der ort für alltagsheld:innen</p>}
    </div>
  );
}

export function Fortschritt({ aktuell, entschieden }: { aktuell: BlockId; entschieden: Set<BlockId> }) {
  const nr = BLOCK_IDS.indexOf(aktuell) + 1;
  return (
    <div className="fortschritt">
      <div className="fortschritt-zeile">
        <h3>Schritt {nr} von {BLOCK_IDS.length}</h3>
      </div>
      <div className="fortschritt-balken" aria-hidden="true">
        {BLOCK_IDS.map((b) => (
          <i key={b} data-an={b === aktuell ? 'teil' : entschieden.has(b) ? '1' : '0'} />
        ))}
      </div>
    </div>
  );
}

export function Meldung({ text, onWeg }: { text: string; onWeg: () => void }) {
  useEffect(() => {
    const t = setTimeout(onWeg, 4200);
    return () => clearTimeout(t);
  }, [text, onWeg]);
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
