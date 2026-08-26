import { Banner } from '../ui/Bausteine';
import { datumLang, programm } from '../programm';
import { useAppConfig } from '../hooks/useAppConfig';
import { Uebersicht } from './Uebersicht';

/**
 * Die Übersicht für die Lehrpersonen — ohne Anmeldung, ohne Schreibrechte.
 *
 * Erreichbar unter `/uebersicht` und bewusst NIRGENDS verlinkt: Der Link wird von der
 * Administration weitergegeben (Steuerung → «Link für Lehrpersonen»), auf der
 * Anmeldeseite der Gäste taucht er nicht auf.
 *
 * Es gibt hier keinen einzigen Knopf, der etwas verändert, und die Seite meldet auch
 * niemanden an: Sie liest ausschliesslich die Zähler und das Steuerungsdokument, und
 * beides ist laut firestore.rules für alle lesbar. Wer den Link hat, kann also sehen,
 * wie voll die Angebote sind — mehr nicht.
 */
export default function OeffentlicheUebersicht() {
  const { config } = useAppConfig();

  return (
    <div className="seite seite--weit">
      <div className="admin-kopf">
        <div className="reihe">
          <img src="/fms-neufeld.png" alt="fms Neufeld" style={{ width: 110, height: 'auto' }} />
          <strong>Übersicht</strong>
        </div>
        <span className="mini">
          Nur zum Ansehen · Anmeldung {config.anmeldungOffen ? 'offen' : 'geschlossen'}
        </span>
      </div>

      {config.banner && <Banner text={config.banner} />}

      <p className="lauftext">
        Wer sich bisher für welches Angebot angemeldet hat. Die Zahlen aktualisieren sich
        von selbst — die Seite muss nicht neu geladen werden.
      </p>

      <Uebersicht buchungen={null} />

      <footer className="fusszeile mini">
        <p>{programm.event.titel} · {datumLang()}</p>
        <p className="zusammen">
          WebApp von{' '}
          <a href="https://alae.app" target="_blank" rel="noopener noreferrer">Alä</a>
        </p>
      </footer>
    </div>
  );
}
