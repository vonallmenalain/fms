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
  if (istGewaehlt) return { zustand: 'aktiv', frei: null };
  if (fachSchonGewaehlt) return { zustand: 'gewaehlt-anders', frei: null };
  if (!stand) return { zustand: 'unbekannt', frei: null };
  const frei = Math.max(0, stand.kapazitaet - stand.belegt);
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

  const beschriftung = [
    angebot.fach, meta,
    zustand === 'aktiv' ? 'ausgewählt' :
    zustand === 'voll' ? 'ausgebucht' :
    zustand === 'gewaehlt-anders' ? 'dieses Fach hast du bereits gewählt' :
    frei !== null ? `${frei} freie Plätze` : '',
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
    >
      <span className="karte-fach">{angebot.fach}</span>
      <span className="karte-meta">{meta}</span>
      <span className="karte-plaetze" aria-hidden="true">
        {frei !== null && zustand !== 'voll' && <b>{frei}</b>}
        {zustand === 'aktiv' ? '✓ gewählt' : TEXT[zustand]}
      </span>
    </button>
  );
}
