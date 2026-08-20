import { Kopf } from '../ui/Bausteine';
import { datumLang } from '../programm';
import type { AppConfig } from '../hooks/useAppConfig';

export function Start({
  config, plaetze, setPlaetze, plaetzeSperren, hatTicket, onStart, onTicket,
}: {
  config: AppConfig;
  plaetze: number;
  setPlaetze: (n: number) => void;
  plaetzeSperren: boolean;
  hatTicket: boolean;
  onStart: () => void;
  onTicket: () => void;
}) {
  const max = Math.min(4, Math.max(1, config.maxPlaetzeProGeraet));
  const anzahlen = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <div className="seite">
      <Kopf claim />

      <div className="stapel">
        <h1>Anmeldung Besuchsmorgen</h1>
        <p className="lauftext">{datumLang()}</p>
      </div>

      <div className="stapel">
        <p>Du wählst:</p>
        <ul className="punkte">
          <li>zwei <b>Ateliers</b></li>
          <li>zwei <b>Unterrichtsbesuche</b></li>
        </ul>
      </div>

      {!hatTicket && (
        <div className="stapel">
          <h3 id="gruppe-frage">Für wie viele Personen meldest du an?</h3>
          <div className="wahlgruppe" role="group" aria-labelledby="gruppe-frage">
            {anzahlen.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={n === plaetze}
                disabled={plaetzeSperren}
                onClick={() => setPlaetze(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mini">
            Seid ihr als Gruppe unterwegs, könnt ihr euch auf <b>einem</b> Handy gemeinsam anmelden.
            Ihr besucht dann dieselben Ateliers und Lektionen.
          </p>
        </div>
      )}

      {config.anmeldungOffen ? (
        <button type="button" className="knopf knopf--haupt knopf--breit" onClick={hatTicket ? onTicket : onStart}>
          {hatTicket ? 'Meine Auswahl ansehen' : 'Los geht’s'}
        </button>
      ) : (
        <div className="hinweis hinweis--warnung">
          <b>Die Anmeldung ist noch nicht offen.</b> Sie wird während der Begrüssung in der Aula
          freigeschaltet. Lass diese Seite einfach offen.
        </div>
      )}

      {hatTicket && config.anmeldungOffen && (
        <p className="mini mitte">Du hast bereits eine Anmeldung auf diesem Gerät.</p>
      )}
    </div>
  );
}
