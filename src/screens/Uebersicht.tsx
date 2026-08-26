import { alleBloecke, alleAngebote, angeboteFuer, metaZeile, zeitraum } from '../programm';
import { useAlleSlots } from '../hooks/useSlots';
import type { Buchung } from '../buchung';

/**
 * Die Live-Übersicht: wie viele Plätze in welchem Angebot belegt sind.
 *
 * Zwei Aufrufer, ein Bildschirm. Die Betreuung sieht sie unter «/admin → Übersicht» und
 * bekommt `buchungen` mit — daraus kommen die Kennzahlen, die nur aus den Anmeldungen
 * ablesbar sind (wie viele Geräte, wie viele davon vom Info-Stand). Die öffentliche
 * Ansicht unter `/uebersicht` übergibt `null`: Sie liest ausschliesslich die Zähler, die
 * ohne Anmeldung lesbar sind (firestore.rules), und zeigt statt der Gerätezahlen, wie
 * viel insgesamt noch frei ist.
 *
 * Es gibt hier nichts zu ändern — dieser Bildschirm liest nur.
 */
export function Uebersicht({ buchungen }: { buchungen: (Buchung & { id: string })[] | null }) {
  const staende = useAlleSlots();
  const angebote = alleAngebote();

  const personen = buchungen?.reduce((n, b) => n + (b.plaetze || 0), 0) ?? 0;
  const ohneHandy = buchungen?.filter((b) => b.quelle === 'admin').reduce((n, b) => n + b.plaetze, 0) ?? 0;

  const plaetzeGebucht = Object.values(staende).reduce((n, s) => n + s.belegt, 0);
  const kapazitaet = angebote.reduce((n, a) => n + (staende[a.id]?.kapazitaet ?? a.kapazitaet), 0);
  const ausgebucht = angebote.filter(
    (a) => (staende[a.id]?.belegt ?? 0) >= (staende[a.id]?.kapazitaet ?? a.kapazitaet),
  ).length;

  return (
    <div className="stapel">
      <dl className="kennzahlen">
        {buchungen && (
          <>
            <div className="kennzahl"><dt>Anmeldungen</dt><dd>{buchungen.length}</dd></div>
            <div className="kennzahl"><dt>Personen</dt><dd>{personen}</dd></div>
          </>
        )}
        <div className="kennzahl"><dt>belegte Plätze</dt><dd>{plaetzeGebucht}</dd></div>
        <div className="kennzahl"><dt>freie Plätze</dt><dd>{Math.max(0, kapazitaet - plaetzeGebucht)}</dd></div>
        {buchungen
          ? <div className="kennzahl"><dt>davon ohne Handy</dt><dd>{ohneHandy}</dd></div>
          : <div className="kennzahl"><dt>ausgebuchte Angebote</dt><dd>{ausgebucht} von {angebote.length}</dd></div>}
      </dl>

      <div className="raster raster--bloecke">
        {alleBloecke().map((b) => (
          <div className="saeule" key={b.id}>
            <h3>{b.label} <span className="zahl" style={{ fontWeight: 500 }}>· {zeitraum(b)}</span></h3>
            {[...angeboteFuer(b.id)]
              .sort((x, y) => (staende[y.id]?.belegt ?? 0) - (staende[x.id]?.belegt ?? 0))
              .map((a) => {
                const s = staende[a.id];
                const belegt = s?.belegt ?? 0;
                const kap = s?.kapazitaet ?? a.kapazitaet;
                return (
                  <div className="balkenzeile" key={a.id} data-voll={belegt >= kap ? '1' : '0'}>
                    <span className="bz-fach">{a.fach}</span>
                    <span className="bz-meta">{metaZeile(a)}{a.lehrperson ? ` · ${a.lehrperson}` : ''}</span>
                    <span className="bz-zahl">{belegt}/{kap}</span>
                    <span className="bz-balken"><i style={{ width: `${Math.min(100, (belegt / kap) * 100)}%` }} /></span>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
