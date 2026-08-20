import type { Angebot } from '../programm';
import { metaZeile } from '../programm';
import type { SlotStand } from '../hooks/useSlots';

export type Zustand = 'frei' | 'knapp' | 'voll' | 'aktiv' | 'gewaehlt-anders' | 'unbekannt';

export function zustandVon(
  stand: SlotStand | undefined,
  plaetze: number,
  istGewaehlt: boolean,
  fachSchonGewaehlt: boolean,
): { zustand: Zustand; frei: number | null } {
  // Die freien Plätze werden IMMER mitgerechnet — auch für die eigene Wahl und für ein
  // Fach, das in der anderen Runde schon belegt ist. Wer zurück in einen Block geht, will
  // sehen, wie es dort inzwischen aussieht, ohne den Platz erst aufgeben zu müssen.
  const frei = stand ? Math.max(0, stand.kapazitaet - stand.belegt) : null;
  if (istGewaehlt) return { zustand: 'aktiv', frei };
  if (fachSchonGewaehlt) return { zustand: 'gewaehlt-anders', frei };
  if (frei === null) return { zustand: 'unbekannt', frei: null };
  if (frei < plaetze) return { zustand: 'voll', frei };
  if (frei <= 5) return { zustand: 'knapp', frei };
  return { zustand: 'frei', frei };
}

const TEXT: Record<Zustand, string> = {
  aktiv: 'gewählt',
  'gewaehlt-anders': 'schon gewählt',
  voll: 'ausgebucht',
  frei: 'frei',
  knapp: 'frei',
  unbekannt: '—',
};

export function AngebotsKarte({
  angebot, stand, plaetze, istGewaehlt, fachSchonGewaehlt, laedt, onWahl,
}: {
  angebot: Angebot;
  stand: SlotStand | undefined;
  plaetze: number;
  istGewaehlt: boolean;
  fachSchonGewaehlt: boolean;
  laedt: boolean;
  onWahl: () => void;
}) {
  const { zustand, frei } = zustandVon(stand, plaetze, istGewaehlt, fachSchonGewaehlt);
  const gesperrt = zustand === 'voll' || zustand === 'gewaehlt-anders';
  const meta = metaZeile(angebot);

  // Bei «gewählt» und «schon gewählt» steht die Platzzahl zusätzlich in einer zweiten Zeile.
  const zweiZeilig = (zustand === 'aktiv' || zustand === 'gewaehlt-anders') && frei !== null;

  const beschriftung = [
    angebot.fach, meta,
    laedt ? 'wird gebucht' :
    zustand === 'aktiv' ? 'ausgewählt, nochmals tippen zum Abwählen' :
    zustand === 'voll' ? 'ausgebucht' :
    zustand === 'gewaehlt-anders' ? 'dieses Fach hast du bereits gewählt' : '',
    !laedt && frei !== null && zustand !== 'voll' ? `${frei} freie Plätze` : '',
  ].filter(Boolean).join(', ');

  return (
    <button
      type="button"
      className="karte"
      data-zustand={zustand}
      data-laedt={laedt ? '1' : '0'}
      disabled={gesperrt || laedt}
      onClick={onWahl}
      aria-label={beschriftung}
      aria-busy={laedt}
    >
      <span className="karte-fach">{angebot.fach}</span>
      <span className="karte-meta">{meta}</span>
      <span className="karte-plaetze" aria-hidden="true">
        {laedt ? <span className="laderad" /> : zweiZeilig ? (
          <>
            <span className="karte-marke">{zustand === 'aktiv' ? '✓ gewählt' : TEXT[zustand]}</span>
            <span className="karte-frei">{frei} frei</span>
          </>
        ) : (
          <>
            {frei !== null && zustand !== 'voll' && <b>{frei}</b>}
            {TEXT[zustand]}
          </>
        )}
      </span>
    </button>
  );
}
