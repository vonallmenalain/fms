import { Kopf } from '../ui/Bausteine';
import { angebotsSatz, blockIds, datumLang } from '../programm';
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
  // Die Steuerung darf alle Bereiche entfernen. Dann gibt es nichts zu wählen — und
  // «Los geht’s» führte ins Leere. Lieber ehrlich sagen, dass noch nichts bereitsteht.
  const hatProgramm = blockIds().length > 0;

  return (
    <div className="seite">
      <Kopf claim />

      <div className="stapel">
        <h1>Anmeldung Besuchsmorgen</h1>
        <p className="lauftext">{datumLang()}</p>
      </div>

      {/* Aus dem laufenden Programm gerechnet: Wer in der Steuerung einen Bereich
          hinzufügt oder streicht, muss diesen Satz nicht von Hand nachführen. */}
      {angebotsSatz() && (
        <div className="stapel">
          <p>Du kannst <b>{angebotsSatz()}</b> auswählen.</p>
        </div>
      )}

      {!hatTicket && (
        <div className="stapel">
          <h3 id="gruppe-frage">Anzahl Personen</h3>
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
            Ihr könnt euch als Gruppe <b>mit einem Handy</b> anmelden.
          </p>
        </div>
      )}

      {!hatProgramm ? (
        <div className="hinweis hinweis--warnung">
          <b>Das Programm wird gerade vorbereitet.</b> Bitte in ein paar Minuten nochmals
          nachsehen — die Seite kann offen bleiben.
        </div>
      ) : config.anmeldungOffen ? (
        <button type="button" className="knopf knopf--haupt knopf--breit" onClick={hatTicket ? onTicket : onStart}>
          {hatTicket ? 'Meine Auswahl ansehen' : 'Los geht’s'}
        </button>
      ) : (
        <div className="hinweis hinweis--warnung">
          <b>Die Anmeldung ist noch nicht offen.</b> Sie wird während der Begrüssung in der Aula
          freigeschaltet. Lass diese Seite einfach offen.
        </div>
      )}

      {hatProgramm && hatTicket && config.anmeldungOffen && (
        <p className="mini mitte">Du hast bereits eine Anmeldung auf diesem Gerät.</p>
      )}
    </div>
  );
}
