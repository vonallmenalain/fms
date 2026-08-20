import { Fortschritt } from '../ui/Bausteine';
import { AngebotsKarte } from '../ui/AngebotsKarte';
import {
  BLOCK_IDS, angebot, angeboteFuer, block, schonGewaehltesFach, zeitraum,
  type BlockId, type Wahl,
} from '../programm';
import type { Staende } from '../hooks/useSlots';
import type { Buchung } from '../buchung';

export function Auswahl({
  blockId, staende, geladen, buchung, plaetze, laeuftFuer, onWahl, onUeberspringen, onZurueck, ausTicket,
}: {
  blockId: BlockId;
  staende: Staende;
  geladen: boolean;
  buchung: Buchung | null;
  plaetze: number;
  laeuftFuer: string | null;
  onWahl: (angebotId: string) => void;
  onUeberspringen: () => void;
  onZurueck: () => void;
  ausTicket: boolean;
}) {
  const b = block(blockId);
  const angebote = angeboteFuer(blockId);
  const wahl: Wahl = buchung?.wahl ?? {};
  const gewaehlt = wahl[blockId] ?? null;
  const entschieden = new Set(
    (Object.keys(wahl) as BlockId[]).filter((k) => wahl[k] !== null && wahl[k] !== undefined),
  );

  // Merkzettel über der Liste: alles, was auf diesem Gerät schon gewählt ist — der
  // aktuelle Block eingeschlossen. Genau dort will man ja nachsehen, ob die eben
  // getippte Wahl auch wirklich sitzt.
  const uebersicht = BLOCK_IDS
    .map((id) => ({ blk: block(id), a: angebot(wahl[id]) }))
    .filter(({ blk, a }) => !!a || blk.id === blockId);

  return (
    <div className="seite">
      <Fortschritt aktuell={blockId} entschieden={entschieden} />

      <ul className="bisher lauftext">
        {uebersicht.map(({ blk, a }) => (
          <li key={blk.id} data-aktuell={blk.id === blockId ? '1' : '0'}>
            {blk.label} – {a ? a.fach : <span className="offen">wählst du gerade</span>}
          </li>
        ))}
      </ul>

      <div className="stapel">
        <h1>{b.label}</h1>
        <p className="lauftext zahl">
          {zeitraum(b)} · {b.art === 'atelier' ? 'wähle ein Atelier' : 'wähle eine Lektion'}
        </p>
      </div>

      {!geladen && <p className="mini">Freie Plätze werden geladen …</p>}

      <div className="liste">
        {angebote.map((a) => (
          <AngebotsKarte
            key={a.id}
            angebot={a}
            stand={staende[a.id]}
            plaetze={plaetze}
            istGewaehlt={gewaehlt === a.id}
            fachSchonGewaehlt={schonGewaehltesFach(a, wahl)}
            laedt={laeuftFuer === a.id}
            onWahl={() => onWahl(a.id)}
          />
        ))}
      </div>

      {plaetze > 1 && (
        <p className="mini">
          Du meldest <b>{plaetze} Personen</b> an — Angebote mit weniger als {plaetze} freien
          Plätzen sind deshalb gesperrt.
        </p>
      )}

      <div className="knopfzeile" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="knopf knopf--still" onClick={onZurueck}>← Zurück</button>
        <button type="button" className="knopf knopf--still" onClick={onUeberspringen}>
          {gewaehlt ? (ausTicket ? 'Fertig' : 'Weiter') : 'Diesen Block überspringen'}
        </button>
      </div>
    </div>
  );
}
