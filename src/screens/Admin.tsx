import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword,
  signInWithPopup, signOut, type User,
} from 'firebase/auth';
import {
  collection, deleteField, doc, getDocs, setDoc, writeBatch, onSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import {
  BLOCK_IDS, BLOECKE, alleAngebote, angebot, angeboteFuer, anpassungFuer, anzahlAnpassungen,
  basisAngebot, block, zeitraum,
  type Angebot, type Anpassung, type BlockId,
} from '../programm';
import { useAlleSlots, type Staende } from '../hooks/useSlots';
import { useAppConfig } from '../hooks/useAppConfig';
import { useBuchungen } from '../hooks/useBuchung';
import { useProtokoll } from '../hooks/useProtokoll';
import { erfasseAdminBuchung, loescheAnmeldung, type Buchung } from '../buchung';
import { VORGANG_TEXT, type LogEintrag } from '../protokoll';
import { AusgebuchtFehler } from '../wiederholung';
import { Kopf, Meldung } from '../ui/Bausteine';
import { Uebersicht } from './Uebersicht';
import {
  ROLLEN_TEXT, anmeldelinkSenden, bestaetigungPruefen, bestaetigungSenden, gemerkteMail,
  kontoEntfernen, kontoErstellen, kontoRolleSetzen, linkAnmeldung, mailSchluessel,
  mitLinkAnmelden, passwortZuruecksetzen, zugangEntfernen, zugangKlaeren, zugangSetzen,
  type MailErgebnis,
  type Konto, type Rolle, type Zugang,
} from '../zugang';

type Reiter = 'uebersicht' | 'erfassen' | 'steuerung';

/* ------------------------------------------------------------------ Helfer */

/**
 * Firestore-Zeitstempel als Datum. Er ist so lange leer, bis der Server den
 * Schreibvorgang bestätigt hat — auf dem eigenen Gerät sieht man deshalb kurz nichts.
 */
function alsDatum(wert: unknown): Date | null {
  // Millisekunden: So kommen zusammengerechnete Zeiten aus der Geräteliste herein.
  if (typeof wert === 'number') return wert ? new Date(wert) : null;
  const t = wert as { toDate?: () => Date } | null | undefined;
  return typeof t?.toDate === 'function' ? t.toDate() : null;
}

const uhrzeit = (wert: unknown): string => {
  const d = alsDatum(wert);
  return d ? d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
};

const zeitZahl = (wert: unknown): number => alsDatum(wert)?.getTime() ?? 0;

/** Angebot als lesbare Kurzform. Unbekannte IDs werden gezeigt, nicht verschluckt. */
const angebotKurz = (id: string | null | undefined): string => {
  if (!id) return '—';
  const a = angebot(id);
  return a ? `${a.fach}${a.klasse ? ` · ${a.klasse}` : ''}` : id;
};

/**
 * Eine ganze Sammlung löschen, in Portionen.
 *
 * Ein Firestore-Stapel fasst höchstens 500 Vorgänge. Bei 120 Gästen wäre das kein Thema —
 * nach ein paar Proberunden ohne Zurücksetzen schon, und dann scheiterte ausgerechnet der
 * Knopf, der wieder aufräumen soll. Beim Protokoll gilt das doppelt: Es wächst mit jedem
 * Vorgang, nicht mit jedem Gerät.
 */
async function sammlungLeeren(name: string): Promise<number> {
  const snap = await getDocs(collection(db, name));
  const abschicken: Promise<void>[] = [];
  for (let i = 0; i < snap.docs.length; i += 400) {
    const stapel = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((d) => stapel.delete(d.ref));
    abschicken.push(stapel.commit());
  }
  await Promise.all(abschicken);
  return snap.size;
}

export default function Admin({ onRaus }: { onRaus: () => void }) {
  const [benutzer, setBenutzer] = useState<User | null | undefined>(undefined);
  // undefined = noch nicht geprüft, null = kein Zugang
  const [rolle, setRolle] = useState<Rolle | null | undefined>(undefined);
  const [reiter, setReiter] = useState<Reiter>('uebersicht');
  const [meldung, setMeldung] = useState<string | null>(null);
  // Zählt hoch, sobald die E-Mail-Bestätigung geprüft wurde. `benutzer` bleibt dabei
  // dasselbe Objekt — ohne diesen Merker zeichnete React den Bildschirm nicht neu.
  const [mailStand, setMailStand] = useState(0);
  const mailGeprueft = useCallback(() => setMailStand((n) => n + 1), []);

  useEffect(() => onAuthStateChanged(auth, (u) => setBenutzer(u && !u.isAnonymous ? u : null)), []);

  // Rolle klären und beim ersten Anmelden freischalten — siehe src/zugang.ts.
  useEffect(() => {
    if (!benutzer) { setRolle(undefined); return; }
    let weg = false;
    setRolle(undefined);
    zugangKlaeren(benutzer).then((r) => { if (!weg) setRolle(r); });
    return () => { weg = true; };
  }, [benutzer, mailStand]);

  if (benutzer === undefined) return <div className="seite"><p className="lauftext">Einen Moment …</p></div>;
  if (!benutzer) return <Anmelden onRaus={onRaus} />;
  if (rolle === undefined) return <div className="seite"><p className="lauftext">Zugang wird geprüft …</p></div>;
  // Ein frisch erstelltes Passwort-Konto scheitert nicht am fehlenden Zugang, sondern an
  // der unbestätigten Adresse: firestore.rules verlangt `email_verified`. Die Prüfung
  // steht bewusst NACH zugangKlaeren — wer bereits freigeschaltet ist, kommt weiterhin
  // hinein, auch wenn die Adresse (etwa aus der Firebase-Konsole) nie bestätigt wurde.
  if (rolle === null && !benutzer.emailVerified) {
    return <MailBestaetigen benutzer={benutzer} onGeprueft={mailGeprueft} onRaus={onRaus} />;
  }
  if (rolle === null) {
    return (
      <div className="seite">
        <Kopf klein />
        <div className="hinweis hinweis--fehler">
          <b>Kein Zugang.</b> Das Konto {benutzer.email} ist nicht freigeschaltet.
          Bitte bei der Administration des Besuchsmorgens melden — sie kann diese Adresse
          unter «Steuerung → Zugänge» eintragen.
        </div>
        <div className="knopfzeile">
          <button className="knopf knopf--rand" onClick={() => signOut(auth)}>Abmelden</button>
          <button className="knopf knopf--still" onClick={onRaus}>Zurück zur Startseite</button>
        </div>
      </div>
    );
  }

  const istAdmin = rolle === 'admin';
  const reiterListe: [Reiter, string][] = [
    ['uebersicht', 'Übersicht'],
    ['erfassen', '+ Anmeldung erfassen'],
    ...(istAdmin ? [['steuerung', 'Steuerung'] as [Reiter, string]] : []),
  ];
  // Rolle nachträglich verkleinert? Dann darf der offene Reiter nicht stehen bleiben.
  const offen: Reiter = reiterListe.some(([id]) => id === reiter) ? reiter : 'uebersicht';

  return (
    <div className="seite seite--weit">
      <div className="admin-kopf">
        <div className="reihe">
          <img src="/fms-neufeld.png" alt="fms Neufeld" style={{ width: 110, height: 'auto' }} />
          <strong>Betreuung</strong>
        </div>
        <div className="reihe">
          <span className="mini">{benutzer.email} · {ROLLEN_TEXT[rolle]}</span>
          <button className="knopf knopf--still" onClick={() => signOut(auth).then(onRaus)}>Abmelden</button>
        </div>
      </div>

      {/* «Hauptseite» steht bewusst NEBEN den Reitern und nicht als einer: Es wechselt
          nicht die Ansicht, es verlässt den Bereich. Wer als Betreuungsperson selbst eine
          Anmeldung hat, kommt hier zu ihr zurück und kann sie ändern oder freigeben —
          siehe uebernimmGeraeteAnmeldung in src/buchung.ts. */}
      <div className="reiter-zeile">
        <div className="reiter" role="tablist">
          {reiterListe.map(([id, text]) => (
            <button key={id} role="tab" aria-selected={offen === id} onClick={() => setReiter(id)}>{text}</button>
          ))}
        </div>
        <button className="knopf knopf--still knopf--klein" onClick={onRaus}>
          Hauptseite ↗
        </button>
      </div>

      {offen === 'uebersicht' && <AdminUebersicht />}
      {offen === 'erfassen' && <Erfassen melde={setMeldung} />}
      {offen === 'steuerung' && istAdmin && <Steuerung melde={setMeldung} ich={benutzer} />}

      {meldung && <Meldung text={meldung} onWeg={() => setMeldung(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Anmelden */

/** Firebase-Fehlercodes in eine Meldung übersetzen, die sagt, was zu tun ist. */
function anmeldeFehlerText(code: string): { text: string; hinweis?: string } {
  switch (code) {
    case 'auth/unauthorized-domain':
      return {
        text: 'Diese Adresse ist in Firebase noch nicht für die Google-Anmeldung freigegeben.',
        hinweis: `Firebase Console → Authentication → Settings → Authorized domains → «${location.hostname}» hinzufügen. `
          + 'Anonyme Anmeldung und E-Mail/Passwort sind davon nicht betroffen.',
      };
    case 'auth/operation-not-allowed':
      return {
        text: 'Diese Anmeldeart ist im Firebase-Projekt nicht aktiviert.',
        hinweis: 'Firebase Console → Authentication → Sign-in method → Anbieter aktivieren.',
      };
    case 'auth/popup-blocked':
      return { text: 'Der Browser hat das Anmeldefenster blockiert. Bitte Pop-ups für diese Seite erlauben.' };
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return { text: 'Das Anmeldefenster wurde geschlossen. Bitte nochmals versuchen.' };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return { text: 'E-Mail oder Passwort stimmen nicht.' };
    case 'auth/invalid-email':
      return { text: 'Diese E-Mail-Adresse sieht nicht richtig aus.' };
    case 'auth/email-already-in-use':
      return {
        text: 'Für diese Adresse gibt es bereits ein Konto.',
        hinweis: 'Bitte oben mit dem bestehenden Passwort anmelden — oder einen '
          + 'Anmeldelink per E-Mail schicken lassen.',
      };
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return { text: 'Das Passwort ist zu schwach — bitte mindestens 6 Zeichen wählen.' };
    case 'auth/missing-password':
      return { text: 'Bitte ein Passwort eingeben.' };
    case 'auth/admin-restricted-operation':
      return {
        text: 'Neue Konten sind im Firebase-Projekt zurzeit gesperrt.',
        hinweis: 'Firebase Console → Authentication → Settings → User actions → '
          + '«Create (sign-up)» erlauben.',
      };
    case 'auth/unauthorized-continue-uri':
      return {
        text: 'Firebase darf die Bestätigungsmail nicht auf diese Adresse zurückführen.',
        hinweis: `Firebase Console → Authentication → Settings → Authorized domains → «${location.hostname}» hinzufügen.`,
      };
    case 'auth/too-many-requests':
      return { text: 'Zu viele Versuche. Bitte einen Moment warten und nochmals versuchen.' };
    case 'auth/network-request-failed':
      return { text: 'Keine Verbindung. Bitte Netz prüfen und nochmals versuchen.' };
    default:
      return { text: 'Anmeldung fehlgeschlagen.', hinweis: code || undefined };
  }
}

type AnmeldeModus = 'anmelden' | 'konto';

/**
 * Anmeldebildschirm der Betreuung — zwei Ansichten.
 *
 * `anmelden` ist der Normalfall und bleibt schlank: E-Mail, Passwort, Google. Wer noch
 * kein Konto hat, wechselt über einen Knopf nach `konto` — dort stehen die drei Wege, ein
 * Konto anzulegen. Vorher standen alle Wege gleichzeitig da; die Anmeldung sah dadurch
 * aus wie ein Formular mit vier Möglichkeiten, von denen keine die naheliegende war.
 *
 * Ein Konto zu erstellen öffnet keinen Zugang: Freigeschaltet wird nur, wer unter
 * «Steuerung → Zugänge» eingetragen ist — siehe zugangKlaeren und firestore.rules.
 */
function Anmelden({ onRaus }: { onRaus: () => void }) {
  const [modus, setModus] = useState<AnmeldeModus>('anmelden');
  const [mail, setMail] = useState(() => (linkAnmeldung() ? gemerkteMail() : ''));
  const [pw, setPw] = useState('');
  const [fehler, setFehler] = useState<{ text: string; hinweis?: string } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [linkGesendet, setLinkGesendet] = useState(false);
  const [pwGesendet, setPwGesendet] = useState(false);
  // Über einen Anmeldelink hereingekommen? Dann zählt nur noch, ihn einzulösen.
  const [ueberLink] = useState(linkAnmeldung);

  const melden = async (vorgang: () => Promise<unknown>) => {
    setLaeuft(true); setFehler(null);
    try { await vorgang(); }
    catch (f) {
      const code = (f as { code?: string })?.code ?? '';
      setFehler(anmeldeFehlerText(code));
      console.error('Anmeldung fehlgeschlagen:', code, f);
    }
    finally { setLaeuft(false); }
  };

  // Beim Wechsel bleibt nur die Adresse stehen — eine Fehlermeldung oder ein «Link
  // verschickt» aus der anderen Ansicht gehörte sonst plötzlich zu etwas anderem.
  const wechsle = (m: AnmeldeModus) => {
    setModus(m); setFehler(null); setLinkGesendet(false); setPwGesendet(false);
  };

  const fehlerKasten = fehler && (
    <div className="hinweis hinweis--fehler">
      <b>{fehler.text}</b>
      {fehler.hinweis && <><br /><span className="klein">{fehler.hinweis}</span></>}
    </div>
  );

  const google = (
    <button className="knopf knopf--rand knopf--breit" disabled={laeuft}
      onClick={() => melden(() => signInWithPopup(auth, new GoogleAuthProvider()))}>
      Mit Google anmelden
    </button>
  );

  const zurStartseite = (
    <button className="knopf knopf--still" onClick={onRaus}>Zurück zur Startseite</button>
  );

  // Die Adresse steht nur auf dem Gerät bereit, das den Link angefordert hat. Kommt der
  // Link aus einer Einladung, muss sie hier nochmals eingetippt werden — so verlangt es
  // Firebase, damit ein abgefangener Link allein nicht genügt.
  if (ueberLink) {
    return (
      <div className="seite">
        <Kopf />
        <h1>Betreuung</h1>
        <p className="lauftext">Bitte zur Bestätigung die eingeladene E-Mail-Adresse eingeben.</p>
        <form className="stapel" onSubmit={(e) => { e.preventDefault(); melden(() => mitLinkAnmelden(mail)); }}>
          <div className="feld">
            <label htmlFor="linkmail">E-Mail</label>
            <input id="linkmail" type="email" autoComplete="username" value={mail}
              onChange={(e) => setMail(e.target.value)} required autoFocus />
          </div>
          {fehlerKasten}
          <button className="knopf knopf--haupt knopf--breit" disabled={laeuft}>Anmelden</button>
        </form>
        {zurStartseite}
      </div>
    );
  }

  if (modus === 'konto') {
    return (
      <div className="seite">
        <Kopf />
        <h1>Konto erstellen</h1>
        <div className="hinweis">
          <b>Nur freigeschaltete Adressen erhalten Zugang.</b> Ein Konto allein genügt nicht —
          die E-Mail-Adresse muss in der Administration bereits eine Rolle erhalten haben.
          Bitte genau die Adresse verwenden, unter der du eingetragen wurdest.
        </div>

        <form className="stapel" onSubmit={(e) => { e.preventDefault(); melden(() => kontoErstellen(mail, pw)); }}>
          <div className="feld">
            <label htmlFor="neu-mail">E-Mail</label>
            <input id="neu-mail" type="email" autoComplete="username" value={mail}
              onChange={(e) => setMail(e.target.value)} required autoFocus />
          </div>
          <div className="feld">
            <label htmlFor="neu-pw">Passwort festlegen</label>
            <input id="neu-pw" type="password" autoComplete="new-password" minLength={6}
              value={pw} onChange={(e) => setPw(e.target.value)} required />
            <span className="mini">Mindestens 6 Zeichen.</span>
          </div>
          {fehlerKasten}
          <button className="knopf knopf--haupt knopf--breit" disabled={laeuft}>Konto erstellen</button>
        </form>

        <hr className="trenner" />

        <p className="mini">Oder ohne Passwort:</p>

        {/* Ohne Passwort: ein Einmal-Link an die Adresse — verschickt wird er nur an
            eingeladene oder bereits freigeschaltete Adressen, und die Meldung sagt
            bewusst nicht, welcher Fall vorlag (siehe anmeldelinkSenden). */}
        {linkGesendet ? (
          <div className="hinweis">
            <b>Bitte das Postfach prüfen.</b> Ist {mail} für den Betreuungsbereich freigeschaltet,
            liegt der Anmeldelink dort (auch im Spam-Ordner nachsehen). Bitte auf diesem Gerät öffnen.
          </div>
        ) : (
          <button className="knopf knopf--rand knopf--breit" disabled={laeuft || !mail}
            onClick={() => melden(() => anmeldelinkSenden(mail, true).then(() => setLinkGesendet(true)))}>
            Anmeldelink per E-Mail schicken
          </button>
        )}

        {google}

        <button className="knopf knopf--still" onClick={() => wechsle('anmelden')}>
          ← Zurück zum Anmelden
        </button>
        {zurStartseite}
      </div>
    );
  }

  return (
    <div className="seite">
      <Kopf />
      <h1>Betreuung</h1>
      <p className="lauftext">Nur für Betreuungspersonen am Besuchsmorgen.</p>

      <form className="stapel" onSubmit={(e) => { e.preventDefault(); melden(() => signInWithEmailAndPassword(auth, mail, pw)); }}>
        <div className="feld">
          <label htmlFor="mail">E-Mail</label>
          <input id="mail" type="email" autoComplete="username" value={mail} onChange={(e) => setMail(e.target.value)} required />
        </div>
        <div className="feld">
          <label htmlFor="pw">Passwort</label>
          <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </div>
        {fehlerKasten}
        <button className="knopf knopf--haupt knopf--breit" disabled={laeuft}>Anmelden</button>
      </form>

      {/* Passwort vergessen: Der Server verschickt nur, wenn es zu dieser Adresse ein
          freigeschaltetes Konto mit Passwort gibt — die Meldung sagt das offen, statt
          Versand zu behaupten (siehe passwortZuruecksetzen). */}
      {pwGesendet ? (
        <div className="hinweis">
          <b>Bitte das Postfach prüfen.</b> Gibt es zu {mail} ein Konto mit Passwort, liegt
          der Link zum Neusetzen dort (auch im Spam-Ordner nachsehen).
        </div>
      ) : (
        <button className="knopf knopf--still" disabled={laeuft || !mail}
          onClick={() => melden(() => passwortZuruecksetzen(mail).then(() => setPwGesendet(true)))}>
          Passwort vergessen?
        </button>
      )}

      {google}

      <hr className="trenner" />

      <button className="knopf knopf--rand knopf--breit" disabled={laeuft}
        onClick={() => wechsle('konto')}>
        Konto erstellen
      </button>

      {zurStartseite}
    </div>
  );
}

/* -------------------------------------------------------- E-Mail bestätigen */

/**
 * Zwischenschritt für frisch erstellte Passwort-Konten: Bis die Adresse bestätigt ist,
 * lehnt die Datenbank die Freischaltung ab (`email_verified` in firestore.rules). Ohne
 * diesen Bildschirm stünde dort «Kein Zugang» — richtig wäre «noch nicht bestätigt».
 *
 * Google- und Link-Anmeldungen kommen hier nie vorbei: Bei ihnen gilt die Adresse
 * bereits als bestätigt.
 */
function MailBestaetigen(
  { benutzer, onGeprueft, onRaus }:
  { benutzer: User; onGeprueft: () => void; onRaus: () => void },
) {
  const [laeuft, setLaeuft] = useState(false);
  const [nochmals, setNochmals] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);

  const pruefen = async (still: boolean) => {
    if (!still) { setLaeuft(true); setHinweis(null); }
    try {
      if (await bestaetigungPruefen()) onGeprueft();
      else if (!still) setHinweis('Die Adresse ist noch nicht bestätigt. Bitte zuerst den Link im E-Mail öffnen.');
    } catch {
      if (!still) setHinweis('Das hat nicht geklappt. Bitte nochmals versuchen.');
    } finally {
      if (!still) setLaeuft(false);
    }
  };

  // Wer den Bestätigungslink öffnet, landet über «Weiter» wieder hier. Dann soll es von
  // selbst weitergehen, statt noch einen Knopf zu verlangen — der Stand steht aber nur
  // nach einem Neuladen beim Server fest, darum die stille Prüfung beim Aufbau.
  useEffect(() => { pruefen(true); }, [onGeprueft]);   // eslint-disable-line react-hooks/exhaustive-deps

  const nochmalsSchicken = () =>
    bestaetigungSenden(benutzer)
      .then(() => { setNochmals(true); setHinweis(null); })
      .catch((f) => setHinweis(anmeldeFehlerText((f as { code?: string })?.code ?? '').text));

  return (
    <div className="seite">
      <Kopf klein />
      <h1>E-Mail bestätigen</h1>
      <div className="hinweis">
        <b>Wir haben dir eine E-Mail an {benutzer.email} geschickt.</b> Bitte den Link darin
        öffnen — auch im Spam-Ordner nachsehen — und danach hier weitermachen.
      </div>

      {hinweis && <div className="hinweis hinweis--warnung">{hinweis}</div>}

      <button className="knopf knopf--haupt knopf--breit" disabled={laeuft} aria-busy={laeuft}
        onClick={() => pruefen(false)}>
        {laeuft && <span className="laderad laderad--knopf" aria-hidden="true" />}
        {laeuft ? 'Wird geprüft …' : 'Ich habe bestätigt'}
      </button>

      <button className="knopf knopf--rand knopf--breit" disabled={laeuft || nochmals}
        onClick={nochmalsSchicken}>
        {nochmals ? 'E-Mail nochmals verschickt' : 'E-Mail nochmals schicken'}
      </button>

      <div className="knopfzeile">
        <button className="knopf knopf--still" onClick={() => signOut(auth)}>Abmelden</button>
        <button className="knopf knopf--still" onClick={onRaus}>Zurück zur Startseite</button>
      </div>
    </div>
  );
}

/** Was aus dem Anmeldelink geworden ist — im Klartext für die Administration. */
function mailStandText(adresse: string, post: MailErgebnis): string {
  if (post.weg === 'firebase') {
    return 'Anmeldelink verschickt, aber über Firebase statt über alae.app: Der eigene '
      + `Versand hat nicht geantwortet.${post.grund ? ` ${post.grund}` : ''} Mehr steht in der `
      + 'Browserkonsole und in Netlify → Logs → Functions.';
  }
  switch (post.stand) {
    case 'gesendet':
      return `Anmeldelink an ${adresse} verschickt.`;
    case 'nicht-eingeladen':
      return 'aber kein Anmeldelink verschickt — der Server findet die Adresse weder unter '
        + 'den Zugängen noch unter den Konten. Bitte die Schreibweise prüfen.';
    case 'gesperrt':
      return 'aber kein zweiter Anmeldelink verschickt: An diese Adresse ging vor weniger '
        + 'als 30 Sekunden schon einer. Der erste gilt.';
    default:
      return 'Anmeldelink verschickt.';
  }
}

/* ------------------------------------------------------------------ Übersicht */

/**
 * Dieselbe Live-Übersicht, die auch unter `/uebersicht` ohne Anmeldung steht — hier
 * zusätzlich mit den Kennzahlen aus den Anmeldungen, die nur die Betreuung lesen darf.
 */
function AdminUebersicht() {
  const buchungen = useBuchungen();
  return <Uebersicht buchungen={buchungen} />;
}

/* ------------------------------------------------------------------ Erfassen */

function Erfassen({ melde }: { melde: (t: string) => void }) {
  const staende = useAlleSlots();
  const [plaetze, setPlaetze] = useState(1);
  const [notiz, setNotiz] = useState('');
  const [auswahl, setAuswahl] = useState<Partial<Record<BlockId, string>>>({});
  const [laeuft, setLaeuft] = useState(false);
  const [fertig, setFertig] = useState(false);

  const speichern = async () => {
    setLaeuft(true);
    try {
      await erfasseAdminBuchung(auswahl, plaetze, notiz);
      setFertig(true);
      setAuswahl({}); setNotiz(''); setPlaetze(1);
    } catch (f) {
      melde(f instanceof AusgebuchtFehler
        ? `${angebot(f.angebotId)?.fach ?? 'Ein Angebot'} ist inzwischen ausgebucht.`
        : 'Das hat nicht geklappt. Bitte nochmals versuchen.');
    } finally { setLaeuft(false); }
  };

  if (fertig) {
    return (
      <div className="stapel">
        <div className="hinweis"><b>Anmeldung erfasst.</b> Die Plätze sind reserviert.</div>
        <p className="klein">Am besten den Gästen die Auswahl kurz aufschreiben oder zeigen.</p>
        <button className="knopf knopf--haupt" onClick={() => setFertig(false)}>Nächste Anmeldung erfassen</button>
      </div>
    );
  }

  return (
    <div className="stapel" style={{ maxWidth: 560 }}>
      <p className="lauftext">Für Gäste ohne Handy. Es braucht keinen Namen — die Notiz ist nur für euch.</p>

      <div className="feld">
        <label htmlFor="anzahl">Anzahl Personen</label>
        <select id="anzahl" value={plaetze} onChange={(e) => setPlaetze(Number(e.target.value))}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {BLOECKE.map((b) => (
        <div className="feld" key={b.id}>
          <label htmlFor={`w-${b.id}`}>{b.label} <span className="zahl">({zeitraum(b)})</span></label>
          <select
            id={`w-${b.id}`}
            value={auswahl[b.id] ?? ''}
            onChange={(e) => setAuswahl((v) => ({ ...v, [b.id]: e.target.value || undefined }))}
          >
            <option value="">— nichts —</option>
            {angeboteFuer(b.id).map((a) => {
              const s = staende[a.id];
              const frei = Math.max(0, (s?.kapazitaet ?? a.kapazitaet) - (s?.belegt ?? 0));
              return (
                <option key={a.id} value={a.id} disabled={frei < plaetze}>
                  {a.fach}{a.klasse ? ` · ${a.klasse}` : ''} · {a.raum} — {frei < plaetze ? 'zu wenig Platz' : `${frei} frei`}
                </option>
              );
            })}
          </select>
        </div>
      ))}

      <div className="feld">
        <label htmlFor="notiz">Notiz (freiwillig)</label>
        {/* Dieselbe Grenze wie in firestore.rules — hier abgefangen, statt den
            Server ablehnen zu lassen, wenn jemand einen Roman hineinschreibt. */}
        <input id="notiz" maxLength={300} value={notiz} onChange={(e) => setNotiz(e.target.value)}
          placeholder="z. B. 3 SuS ohne Handy" />
      </div>

      <button className="knopf knopf--haupt knopf--breit" disabled={laeuft} onClick={speichern}>
        Anmeldung erfassen
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ Steuerung */

function Steuerung({ melde, ich }: { melde: (t: string) => void; ich: User }) {
  const { config } = useAppConfig();
  const staende = useAlleSlots();
  const [banner, setBanner] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  const setzen = async (werte: Record<string, unknown>) => {
    await setDoc(doc(db, 'config', 'app'), werte, { merge: true });
  };

  const alleFreigeben = async () => {
    if (!confirm('Wirklich ALLE Anmeldungen löschen, das Protokoll leeren und alle Zähler '
      + 'auf 0 setzen?')) return;
    setLaeuft(true);
    try {
      // Das Protokoll gehört mit zurückgesetzt: Zeilen zu Anmeldungen, die es nicht mehr
      // gibt, sind nach einer Proberunde bloss noch Verwirrung.
      const anzahlBuchungen = await sammlungLeeren('bookings');
      const anzahlProtokoll = await sammlungLeeren('log');
      const stapel = writeBatch(db);              // 38 Angebote, ein einziger Stapel reicht
      // Zurückgesetzt wird der ZÄHLER, nicht das Programm: Eine von Hand erhöhte
      // Kapazität bleibt stehen. Sie wieder auf den Stand der Programmdatei zu bringen
      // ist eine eigene Entscheidung — dafür gibt es oben «zurücksetzen» je Angebot.
      alleAngebote().forEach((a) =>
        stapel.set(
          doc(db, 'slots', a.id),
          { belegt: 0, kapazitaet: staende[a.id]?.kapazitaet ?? a.kapazitaet, block: a.blockId },
        ));
      await stapel.commit();
      melde(`Alles zurückgesetzt — ${anzahlBuchungen} Anmeldungen gelöscht, `
        + `${anzahlProtokoll} Protokollzeilen geleert.`);
    } catch {
      melde('Das Zurücksetzen hat nicht geklappt. Bitte nochmals versuchen.');
    } finally { setLaeuft(false); }
  };

  return (
    <div className="stapel" style={{ maxWidth: 720 }}>
      <div className="stapel">
        <h3>Anmeldung</h3>
        <label className="schieber">
          <input type="checkbox" checked={config.anmeldungOffen}
            onChange={(e) => setzen({ anmeldungOffen: e.target.checked })} />
          Anmeldung ist {config.anmeldungOffen ? 'OFFEN' : 'geschlossen'}
        </label>
        <p className="mini">
          Wirkt sofort auf allen Geräten und auch serverseitig — geschlossen kann niemand buchen.
        </p>
      </div>

      <hr className="trenner" />

      <div className="stapel">
        <h3>Meldung an alle Gäste</h3>
        {config.banner ? (
          <>
            <div className="hinweis">
              <b>Aktive Meldung:</b> {config.banner}
              <br /><span className="klein">Sie steht auf jedem Gerät zuoberst auf dem Bildschirm.</span>
            </div>
            <div className="knopfzeile">
              <button className="knopf knopf--rand"
                onClick={() => setzen({ banner: '' }).then(() => { setBanner(''); melde('Meldung entfernt.'); })}>
                Meldung entfernen
              </button>
            </div>
          </>
        ) : (
          <p className="mini">Zurzeit ist keine Meldung aktiv.</p>
        )}
        <div className="reihe">
          <div className="feld" style={{ flex: 1 }}>
            <input value={banner} onChange={(e) => setBanner(e.target.value)}
              placeholder={config.banner ? 'Neue Meldung — ersetzt die bestehende' : 'z. B. Sport findet in Turnhalle 2 statt'} />
          </div>
          <button className="knopf knopf--rand" style={{ alignSelf: 'end' }} disabled={!banner.trim()}
            onClick={() => setzen({ banner: banner.trim() }).then(() => melde('Meldung gesetzt.'))}>Senden</button>
        </div>
      </div>

      <hr className="trenner" />

      <LehrpersonenLink />

      <hr className="trenner" />

      <div className="stapel">
        <h3>Performance-Schalter</h3>
        <label className="schieber">
          <input type="checkbox" checked={config.liveZaehler}
            onChange={(e) => setzen({ liveZaehler: e.target.checked })} />
          Live-Zähler {config.liveZaehler ? 'an' : 'aus'}
        </label>
        <p className="mini">
          Ausschalten, falls es spürbar langsam wird: Die Platzzahlen werden dann einmalig
          geladen statt dauerhaft aktualisiert. Buchen funktioniert unverändert.
        </p>
        <div className="feld" style={{ maxWidth: 240 }}>
          <label htmlFor="maxp">Maximale Gruppengrösse</label>
          <select id="maxp" value={config.maxPlaetzeProGeraet}
            onChange={(e) => setzen({ maxPlaetzeProGeraet: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <hr className="trenner" />

      <Protokoll
        melde={melde}
        schreibt={config.protokoll}
        setSchreibt={(an) => setzen({ protokoll: an })}
      />

      <hr className="trenner" />

      <ProgrammBearbeiten melde={melde} staende={staende} />

      <hr className="trenner" />

      <Zugaenge melde={melde} ich={ich} />

      <hr className="trenner" />

      <div className="stapel">
        <h3>Wartung</h3>
        <button className="knopf knopf--gefahr" disabled={laeuft} onClick={alleFreigeben}
          style={{ alignSelf: 'start' }}>
          Alles zurücksetzen
        </button>
        <p className="mini">
          Löscht alle Anmeldungen, leert das Protokoll und setzt alle Zähler auf 0.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------- Link für die Lehrpersonen */

/** Die öffentliche Übersicht liegt immer unter demselben Pfad — siehe src/App.tsx. */
const UEBERSICHT_PFAD = '/uebersicht';

/**
 * Der Link, den die Lehrpersonen bekommen.
 *
 * Er führt auf die Live-Übersicht und sonst nirgendwohin: kein Login, kein Erfassen,
 * kein Ändern. Absichtlich nur hier zu finden — auf der Anmeldeseite der Gäste ist er
 * nicht verlinkt, damit er nicht in jeder Klasse herumgereicht wird.
 */
function LehrpersonenLink() {
  const [kopiert, setKopiert] = useState(false);
  const adresse = `${location.origin}${UEBERSICHT_PFAD}`;

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(adresse);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2500);
    } catch {
      // Ohne Zwischenablage (älterer Browser, Seite nicht über HTTPS): Adresse markieren,
      // damit sie sich wenigstens von Hand kopieren lässt.
      const feld = document.getElementById('lp-link');
      if (feld instanceof HTMLInputElement) { feld.focus(); feld.select(); }
    }
  };

  return (
    <div className="stapel">
      <h3>Link für die Lehrpersonen</h3>
      <p className="mini">
        Zeigt dieselbe Übersicht wie oben — <b>nur zum Ansehen</b>. Kein Login nötig, keine
        Möglichkeit, etwas zu ändern oder Anmeldungen zu erfassen. Auf der Anmeldeseite der
        Gäste ist er nirgends verlinkt.
      </p>
      <div className="reihe">
        <div className="feld" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="lp-link">Adresse</label>
          <input id="lp-link" readOnly value={adresse}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()} />
        </div>
        <button className="knopf knopf--rand" style={{ alignSelf: 'end' }} onClick={kopieren}>
          {kopiert ? 'Kopiert ✓' : 'Kopieren'}
        </button>
      </div>
      <p className="mini">
        <a href={UEBERSICHT_PFAD} target="_blank" rel="noopener noreferrer">Übersicht öffnen ↗</a>
      </p>
    </div>
  );
}

/* ------------------------------------------- Programm & Kapazitäten */

/** Anpassung eines Angebots ablegen — oder entfernen, wenn wieder die Programmdatei gilt. */
async function anpassungSpeichern(id: string, wert: Anpassung | null): Promise<void> {
  const ref = doc(db, 'config', 'programm');
  // `deleteField()` in einem setDoc mit merge legt das Dokument nötigenfalls an und
  // entfernt genau diesen einen Eintrag — ein updateDoc scheiterte am fehlenden Dokument.
  await setDoc(ref, { angebote: { [id]: wert ?? deleteField() } }, { merge: true });
}

/**
 * Kapazität schreiben. Sie steht im Zählerdokument und nicht bei den Anpassungen: Die
 * Buchungstransaktion prüft dort gegen Überbuchung — beide Zahlen an zwei Orten zu haben
 * hiesse, dass eine davon irgendwann die falsche ist.
 */
async function kapazitaetSpeichern(id: string, blockId: BlockId, wert: number): Promise<void> {
  await setDoc(doc(db, 'slots', id), { kapazitaet: wert, block: blockId }, { merge: true });
}

function ProgrammBearbeiten(
  { melde, staende }: { melde: (t: string) => void; staende: Staende },
) {
  const [laeuft, setLaeuft] = useState(false);
  const angepasst = anzahlAnpassungen();

  const allesZuruecksetzen = async () => {
    if (!confirm('Alle von Hand geänderten Titel, Klassen, Zimmer und Lehrpersonen '
      + 'verwerfen? Danach gilt wieder die Programmdatei. Die Kapazitäten bleiben, wie sie sind.')) return;
    setLaeuft(true);
    try {
      await setDoc(doc(db, 'config', 'programm'), { angebote: {} });
      melde('Alle Programmanpassungen verworfen.');
    } catch {
      melde('Das hat nicht geklappt. Bitte nochmals versuchen.');
    } finally { setLaeuft(false); }
  };

  return (
    <div className="stapel">
      <h3>Programm &amp; Kapazitäten</h3>
      <p className="mini">
        Titel, Klasse, Zimmer, Lehrperson und Kapazität je Angebot. Jede Änderung gilt ab
        sofort auf allen Geräten — auch bei Gästen, die gerade auswählen. Die Kapazität
        kleiner als «Belegt» zu setzen nimmt niemandem den Platz weg, es kommt nur nichts
        mehr dazu.
      </p>
      <p className="mini">
        Grundlage bleibt <code>data/programm.json</code>; hier steht nur, was davon
        abweicht. Neue Angebote anlegen oder streichen geht weiterhin nur dort — sonst
        gäbe es Anmeldungen auf Angebote, die niemand mehr kennt.
      </p>

      {angepasst > 0 && (
        <div className="reihe">
          <span className="mini">
            {angepasst === 1 ? '1 Angebot ist' : `${angepasst} Angebote sind`} von Hand angepasst.
          </span>
          <button className="knopf knopf--still knopf--klein" disabled={laeuft}
            onClick={allesZuruecksetzen}>
            Alle Anpassungen verwerfen
          </button>
        </div>
      )}

      {BLOECKE.map((b) => (
        <div className="stapel" key={b.id}>
          <h4 className="blocktitel">{b.label} <span className="zahl">· {zeitraum(b)}</span></h4>
          {angeboteFuer(b.id).map((a) => (
            <AngebotBearbeiten
              key={a.id}
              a={a}
              belegt={staende[a.id]?.belegt ?? 0}
              kapazitaet={staende[a.id]?.kapazitaet ?? a.kapazitaet}
              melde={melde}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Ein Angebot bearbeiten.
 *
 * Die Felder gehören der Maske und werden erst auf «Speichern» geschrieben: Bei fünf
 * Feldern nebeneinander würde ein Speichern bei jedem Verlassen eines Feldes fünf
 * Schreibvorgänge auslösen — und ein halb getippter Titel stünde kurz auf 150 Geräten.
 */
function AngebotBearbeiten(
  { a, belegt, kapazitaet, melde }:
  { a: Angebot; belegt: number; kapazitaet: number; melde: (t: string) => void },
) {
  const basis = basisAngebot(a.id) ?? a;
  const [fach, setFach] = useState(a.fach);
  const [klasse, setKlasse] = useState(a.klasse ?? '');
  const [raum, setRaum] = useState(a.raum);
  const [lehrperson, setLehrperson] = useState(a.lehrperson ?? '');
  const [kap, setKap] = useState(String(kapazitaet));
  const [laeuft, setLaeuft] = useState(false);

  // Ändert jemand anderes dasselbe Angebot, zieht die Maske nach. Abhängig von den
  // WERTEN, nicht vom Objekt: Sonst würde die Maske bei jeder fremden Buchung
  // zurückgesetzt, weil die Angebote dann ohnehin neu zusammengesetzt werden.
  useEffect(() => {
    setFach(a.fach);
    setKlasse(a.klasse ?? '');
    setRaum(a.raum);
    setLehrperson(a.lehrperson ?? '');
  }, [a.fach, a.klasse, a.raum, a.lehrperson]);
  useEffect(() => { setKap(String(kapazitaet)); }, [kapazitaet]);

  const zahl = Number(kap);
  const kapGueltig = kap.trim() !== '' && Number.isInteger(zahl) && zahl >= 0 && zahl <= 99;
  const kuerzel = lehrperson.trim().toUpperCase();

  const angepasst = anpassungFuer(a.id) !== undefined;
  const kapAngepasst = kapazitaet !== basis.kapazitaet;
  const geaendert = fach.trim() !== a.fach
    || klasse.trim() !== (a.klasse ?? '')
    || raum.trim() !== a.raum
    || kuerzel !== (a.lehrperson ?? '')
    || (kapGueltig && zahl !== kapazitaet);

  const speichern = async () => {
    if (!kapGueltig) { melde('Die Kapazität muss eine ganze Zahl zwischen 0 und 99 sein.'); return; }
    setLaeuft(true);
    try {
      const neu: Anpassung = {
        // Ein Angebot ohne Titel wäre auf der Karte eine leere Zeile — dann lieber der
        // Titel aus der Programmdatei.
        fach: fach.trim() || basis.fach,
        klasse: klasse.trim(),
        raum: raum.trim(),
        lehrperson: kuerzel,
      };
      // Wer von Hand wieder genau den Stand der Programmdatei eintippt, soll auch keine
      // Anpassung mehr haben — sonst überdeckte sie später eine Korrektur in der Datei.
      const wieBasis = neu.fach === basis.fach && neu.klasse === (basis.klasse ?? '')
        && neu.raum === basis.raum && neu.lehrperson === (basis.lehrperson ?? '');
      await anpassungSpeichern(a.id, wieBasis ? null : neu);
      if (zahl !== kapazitaet) await kapazitaetSpeichern(a.id, a.blockId, zahl);
      melde(`${neu.fach} gespeichert.`);
    } catch {
      melde('Das Speichern hat nicht geklappt. Bitte nochmals versuchen.');
    } finally { setLaeuft(false); }
  };

  const zuruecksetzen = async () => {
    setLaeuft(true);
    try {
      await anpassungSpeichern(a.id, null);
      if (kapAngepasst) await kapazitaetSpeichern(a.id, a.blockId, basis.kapazitaet);
      melde(`${basis.fach} steht wieder wie in der Programmdatei.`);
    } catch {
      melde('Das hat nicht geklappt. Bitte nochmals versuchen.');
    } finally { setLaeuft(false); }
  };

  const feldId = (name: string) => `${name}-${a.id}`;

  return (
    <div className="angebot" data-angepasst={angepasst || kapAngepasst ? '1' : '0'}>
      <div className="angebot-kopf">
        <span className="mini zahl">{a.id}</span>
        {(angepasst || kapAngepasst) && <span className="pz-marke">angepasst</span>}
        <span className="angebot-belegt mini">{belegt} belegt</span>
      </div>

      <div className="angebot-felder">
        <div className="feld angebot-breit">
          <label htmlFor={feldId('fach')}>Titel</label>
          <input id={feldId('fach')} value={fach} maxLength={60}
            onChange={(e) => setFach(e.target.value)} />
        </div>
        <div className="feld">
          <label htmlFor={feldId('klasse')}>Klasse</label>
          <input id={feldId('klasse')} value={klasse} maxLength={12}
            placeholder="–" onChange={(e) => setKlasse(e.target.value)} />
        </div>
        <div className="feld">
          <label htmlFor={feldId('raum')}>Zimmer</label>
          <input id={feldId('raum')} value={raum} maxLength={24}
            onChange={(e) => setRaum(e.target.value)} />
        </div>
        <div className="feld">
          <label htmlFor={feldId('lp')}>Lehrperson</label>
          {/* Drei Buchstaben, wie im Stundenplan der Schule — z. B. HET oder MOS. */}
          <input id={feldId('lp')} value={lehrperson} maxLength={3} placeholder="ABC"
            style={{ textTransform: 'uppercase' }}
            onChange={(e) => setLehrperson(e.target.value)} />
        </div>
        <div className="feld">
          <label htmlFor={feldId('kap')}>Kapazität</label>
          <input id={feldId('kap')} type="number" min={0} max={99} value={kap}
            onChange={(e) => setKap(e.target.value)} />
        </div>
      </div>

      <div className="knopfzeile">
        <button className="knopf knopf--rand knopf--klein" disabled={!geaendert || laeuft}
          onClick={speichern}>
          Speichern
        </button>
        {(angepasst || kapAngepasst) && (
          <button className="knopf knopf--still knopf--klein" disabled={laeuft}
            onClick={zuruecksetzen}>
            Auf Programmdatei zurücksetzen
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Protokoll */

type ProtokollAnsicht = 'geraete' | 'verlauf';

type Protokollzeile = LogEintrag & { id: string };

/** Eine Zeile der Geräteliste: Anmeldung und Vorgänge desselben Clients zusammengelegt. */
interface GeraeteZeile {
  client: string;
  nummer: number;
  buchung: (Buchung & { id: string }) | undefined;
  vorgaenge: Protokollzeile[];
  geraet: string;
  vomStand: boolean;
  zuerst: number;
  zuletzt: number;
}

/** Wie viele der vier Slots diese Anmeldung hält. */
const slotsVon = (b: Buchung): number => BLOCK_IDS.filter((id) => b.wahl?.[id]).length;

/**
 * Fortlaufende Nummer je Client, nach erstem Auftreten.
 *
 * Die Firebase-Kennung («iJovaGD9…») ist eindeutig, aber unlesbar und unsprechbar — am
 * Info-Stand hilft sie niemandem. «Gerät 12» ist beides. Die echte Kennung steht weiterhin
 * in der aufgeklappten Zeile, für den Fall, dass jemand in der Datenbank nachsehen muss.
 *
 * Nach ERSTEM Auftreten, nicht nach letztem: So behält eine Zeile ihre Nummer für den
 * ganzen Morgen. Eine Nummerierung, die sich bei jeder fremden Buchung verschiebt, wäre
 * schlimmer als gar keine. Aus demselben Grund zählt die erste PROTOKOLLZEILE und nicht
 * die Anmeldung, sobald es beides gibt: Eine gelöschte Anmeldung verschöbe sonst die
 * Nummern aller Geräte, die kurz danach dazugekommen sind.
 *
 * Restrisiko, bewusst in Kauf genommen: Taucht nachträglich ein Gerät mit einer früheren
 * Zeit auf, rücken die jüngeren um eins weiter. Dagegen hülfe nur ein Zähler in der
 * Datenbank — also genau das heisse Dokument, das docs/05 §5 vermeidet.
 */
function geraeteNummern(clients: { id: string; zeit: number }[]): Map<string, number> {
  const zuerst = new Map<string, number>();
  for (const { id, zeit } of clients) {
    // Ein Zeitstempel, den der Server noch nicht bestätigt hat, ist 0 — er gehört ans
    // Ende (also an die jüngste Nummer), nicht an den Anfang.
    const wert = zeit || Number.MAX_SAFE_INTEGER;
    const bisher = zuerst.get(id);
    if (bisher === undefined || wert < bisher) zuerst.set(id, wert);
  }
  return new Map(
    [...zuerst.entries()]
      // Bei gleicher Millisekunde entscheidet die Kennung — sonst hinge die Reihenfolge
      // davon ab, in welcher Folge Firestore die Dokumente geliefert hat.
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([id], i) => [id, i + 1]),
  );
}

/** Was ein Vorgang mit den Angeboten gemacht hat, in einer Zeile. */
function vorgangText(e: LogEintrag): string {
  if (e.vorgang === 'gewechselt') return `${angebotKurz(e.vorher)} → ${angebotKurz(e.angebot)}`;
  if (e.vorgang === 'erfasst') return 'alle Blöcke auf einmal';
  if (e.vorgang === 'uebernommen') return 'Anmeldung von der eigenen Gast-Kennung';
  return angebotKurz(e.angebot ?? e.vorher);
}

/** «1 Vorgang», nicht «1 Vorgänge». */
const vorgangZahl = (n: number): string => `${n} ${n === 1 ? 'Vorgang' : 'Vorgänge'}`;

/** «1 Platz», nicht «1 Plätze». */
const platzZahl = (n: number): string => `${n} ${n === 1 ? 'Platz' : 'Plätze'}`;

/** Einzelne Dokumente löschen, in Portionen zu 400 (ein Stapel fasst höchstens 500). */
async function loescheDokumente(sammlung: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 400) {
    const stapel = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => stapel.delete(doc(db, sammlung, id)));
    await stapel.commit();
  }
}

/**
 * Protokollbereich der Steuerung: welches Gerät wann wie viele Vorgänge ausgelöst hat.
 *
 * Zwei Sichten, weil zwei verschiedene Fragen dahinterstehen. «Pro Gerät» beantwortet
 * «wer ist da und was hat er»; die Anmeldedaten dafür stehen ohnehin schon in `bookings`.
 * «Verlauf» beantwortet «was ist um 08:41 passiert» und braucht die Protokollzeilen: Ein
 * Wechsel überschreibt in der Anmeldung die vorherige Wahl, aus ihr allein liesse er sich
 * nie rekonstruieren.
 *
 * Beide Sichten sind Listen aus aufklappbaren Zeilen, keine Tabellen: Die Steuerung wird
 * am Eventmorgen auf dem Handy gelesen, und eine Tabelle mit zwölf Spalten heisst dort
 * waagrecht schieben. Zugeklappt stehen drei Angaben, aufgeklappt alles.
 */
function Protokoll(
  { melde, schreibt, setSchreibt }:
  { melde: (t: string) => void; schreibt: boolean; setSchreibt: (an: boolean) => void },
) {
  const [offen, setOffen] = useState(false);

  return (
    <div className="stapel">
      <h3>Protokoll</h3>
      <p className="mini">
        Welches Gerät wann wie viele Vorgänge ausgelöst hat. Ein «Gerät» ist die anonyme
        Kennung, die Firebase beim ersten Buchen vergibt — Namen kommen im Protokoll nicht vor.
      </p>

      <label className="schieber">
        <input type="checkbox" checked={schreibt} onChange={(e) => setSchreibt(e.target.checked)} />
        Protokoll wird {schreibt ? 'geschrieben' : 'NICHT geschrieben'}
      </label>
      <p className="mini">
        Bremst den Andrang nicht: Geschrieben wird erst, <b>nachdem</b> die Buchung bestätigt
        ist, und jeder Vorgang bekommt ein eigenes Dokument — es entsteht also kein
        gemeinsamer Engpass, wie ihn ein Zähler hat. Über den ganzen Morgen sind das rund
        700 zusätzliche Schreibvorgänge, gut ein Rappen. Der Schalter ist die Reserve,
        falls trotzdem etwas klemmt; ausgeschaltet fehlt danach die Zahl der Vorgänge, die
        Anmeldungen selbst bleiben vollständig.
      </p>

      <button className="knopf knopf--rand" style={{ alignSelf: 'start' }}
        onClick={() => setOffen((o) => !o)}>
        {offen ? 'Protokoll ausblenden' : 'Protokoll anzeigen'}
      </button>

      {/* Erst beim Aufklappen laden: Ein Listener auf eine wachsende Sammlung liest beim
          Aufbau jedes Dokument einmal. Was gerade niemand ansieht, soll um 08:35 auch
          nichts kosten. */}
      {offen
        ? <ProtokollListe melde={melde} />
        : <p className="mini">Wird erst beim Aufklappen geladen.</p>}
    </div>
  );
}

function ProtokollListe({ melde }: { melde: (t: string) => void }) {
  const { eintraege, geladen, fehler } = useProtokoll();
  const buchungen = useBuchungen();
  const [ansicht, setAnsicht] = useState<ProtokollAnsicht>('geraete');
  const [laeuft, setLaeuft] = useState(false);

  const nummern = useMemo(() => {
    const ausProtokoll = new Set(eintraege.map((e) => e.client));
    return geraeteNummern([
      ...eintraege.map((e) => ({ id: e.client, zeit: zeitZahl(e.zeitpunkt) })),
      // Nur Geräte ohne Protokollzeilen brauchen ihre Anmeldung als Anhaltspunkt.
      ...buchungen.filter((b) => !ausProtokoll.has(b.id))
        .map((b) => ({ id: b.id, zeit: zeitZahl(b.erstelltAm) })),
    ]);
  }, [buchungen, eintraege]);

  /**
   * Anmeldungen und Vorgänge desselben Clients zusammenlegen. Bewusst die Vereinigung
   * beider Seiten: Ein Gerät, das gebucht und alles wieder freigegeben hat, hat keine
   * Anmeldung mehr — aber es war da, und genau das will die Administration sehen.
   */
  const zeilen = useMemo<GeraeteZeile[]>(() => {
    const nachClient = new Map<string, Protokollzeile[]>();
    for (const e of eintraege) {
      const liste = nachClient.get(e.client);
      if (liste) liste.push(e); else nachClient.set(e.client, [e]);
    }
    const clients = new Set([...buchungen.map((b) => b.id), ...nachClient.keys()]);

    return [...clients].map((client) => {
      const buchung = buchungen.find((b) => b.id === client);
      const vorgaenge = nachClient.get(client) ?? [];       // neuste zuerst, wie geladen
      const zeiten = [
        ...(buchung ? [zeitZahl(buchung.erstelltAm), zeitZahl(buchung.geaendertAm)] : []),
        ...vorgaenge.map((v) => zeitZahl(v.zeitpunkt)),
      ].filter(Boolean);
      return {
        client,
        nummer: nummern.get(client) ?? 0,
        buchung,
        vorgaenge,
        geraet: vorgaenge[0]?.geraet ?? '',
        vomStand: (buchung?.quelle ?? vorgaenge[0]?.art) === 'admin',
        zuerst: zeiten.length ? Math.min(...zeiten) : 0,
        zuletzt: zeiten.length ? Math.max(...zeiten) : 0,
      };
    // Neustes Gerät zuoberst; bei gleicher Millisekunde entscheidet die Nummer, damit
    // Liste und Nummerierung dieselbe Reihenfolge erzählen.
    }).sort((a, b) => b.zuerst - a.zuerst || b.nummer - a.nummer);
  }, [buchungen, eintraege, nummern]);

  /** Ein Vorgang, der schiefgehen kann, mit Rückmeldung — für die fünf Löschknöpfe. */
  const fuehreAus = async (vorgang: () => Promise<string>) => {
    setLaeuft(true);
    try { melde(await vorgang()); }
    catch { melde('Das hat nicht geklappt. Bitte nochmals versuchen.'); }
    finally { setLaeuft(false); }
  };

  const anmeldungLoeschen = (z: GeraeteZeile) => {
    const b = z.buchung;
    if (!b) return;
    const plaetze = slotsVon(b) * b.plaetze;
    if (!confirm(`Anmeldung von Gerät ${z.nummer} löschen? `
      + `${platzZahl(plaetze)} ${plaetze === 1 ? 'wird' : 'werden'} dabei wieder frei.`)) return;
    return fuehreAus(async () => {
      await loescheAnmeldung(b.id);
      return `Anmeldung von Gerät ${z.nummer} gelöscht — ${platzZahl(plaetze)} wieder frei.`;
    });
  };

  const vorgaengeLoeschen = (z: GeraeteZeile) => {
    if (!z.vorgaenge.length) return;
    if (!confirm(`${vorgangZahl(z.vorgaenge.length)} von Gerät ${z.nummer} aus dem Protokoll löschen? `
      + 'Die Anmeldung selbst bleibt unberührt.')) return;
    return fuehreAus(async () => {
      await loescheDokumente('log', z.vorgaenge.map((v) => v.id));
      return `Protokoll von Gerät ${z.nummer} gelöscht.`;
    });
  };

  const zeileLoeschen = (e: Protokollzeile) => {
    if (!confirm('Diese Protokollzeile löschen?')) return;
    return fuehreAus(async () => {
      await loescheDokumente('log', [e.id]);
      return 'Protokollzeile gelöscht.';
    });
  };

  const alleLeeren = () => {
    if (!confirm('Wirklich alle Protokollzeilen löschen? Die Anmeldungen bleiben unberührt.')) return;
    return fuehreAus(async () => `Protokoll geleert — ${await sammlungLeeren('log')} Zeilen gelöscht.`);
  };

  if (fehler) {
    return (
      <div className="hinweis hinweis--warnung">
        <b>Das Protokoll liess sich nicht laden.</b> Meist heisst das, dass die Security
        Rules noch nicht deployt sind — der Bereich <code>log</code> in{' '}
        <code>firestore.rules</code> gehört dazu.
      </div>
    );
  }

  return (
    <div className="stapel">
      <dl className="kennzahlen">
        <div className="kennzahl"><dt>Geräte</dt><dd>{zeilen.length}</dd></div>
        <div className="kennzahl"><dt>Vorgänge</dt><dd>{eintraege.length}</dd></div>
        <div className="kennzahl">
          <dt>davon Wechsel</dt>
          <dd>{eintraege.filter((e) => e.vorgang === 'gewechselt').length}</dd>
        </div>
        <div className="kennzahl">
          <dt>davon Freigaben</dt>
          <dd>{eintraege.filter((e) => e.vorgang === 'freigegeben').length}</dd>
        </div>
      </dl>

      <div className="reiter" role="tablist">
        {([['geraete', 'Pro Gerät'], ['verlauf', 'Verlauf']] as [ProtokollAnsicht, string][])
          .map(([id, text]) => (
            <button key={id} role="tab" aria-selected={ansicht === id}
              onClick={() => setAnsicht(id)}>{text}</button>
          ))}
      </div>

      {ansicht === 'geraete' ? (
        <>
          <p className="mini">
            Eine Zeile je Gerät, neustes zuoberst. Antippen öffnet die Einzelheiten.
            «Vorgänge» zählt jede Serveränderung: Vier Angebote buchen sind vier; alles
            freigeben und neu buchen kommt dazu.
          </p>
          {!geladen && <p className="mini">Protokoll wird geladen …</p>}
          {geladen && zeilen.length === 0 && <p className="mini">Noch keine Anmeldungen.</p>}
          <div className="protokoll-liste">
            {zeilen.map((z) => (
              <GeraeteEintrag
                key={z.client} zeile={z} laeuft={laeuft}
                onAnmeldungLoeschen={() => anmeldungLoeschen(z)}
                onVorgaengeLoeschen={() => vorgaengeLoeschen(z)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="mini">
            Jeder einzelne Vorgang, neuster zuoberst — auch Wechsel und Freigaben, die in
            der Anmeldung selbst überschrieben wurden.
          </p>
          {!geladen && <p className="mini">Protokoll wird geladen …</p>}
          {geladen && eintraege.length === 0 && (
            <p className="mini">Noch keine Vorgänge protokolliert.</p>
          )}
          <div className="protokoll-liste">
            {eintraege.map((e) => (
              <VerlaufEintrag key={e.id} eintrag={e} nummer={nummern.get(e.client) ?? 0}
                laeuft={laeuft} onLoeschen={() => zeileLoeschen(e)} />
            ))}
          </div>
          {eintraege.length >= 500 && (
            <p className="mini">
              Angezeigt sind die 500 neusten Zeilen. Ältere stehen weiterhin in der Datenbank.
            </p>
          )}
        </>
      )}

      <div className="knopfzeile">
        <button className="knopf knopf--still" disabled={laeuft} onClick={alleLeeren}>
          Protokoll leeren
        </button>
      </div>
    </div>
  );
}

/** Zeile der Geräteliste — zugeklappt vier Angaben, aufgeklappt alles. */
function GeraeteEintrag(
  { zeile, laeuft, onAnmeldungLoeschen, onVorgaengeLoeschen }:
  {
    zeile: GeraeteZeile; laeuft: boolean;
    onAnmeldungLoeschen: () => void; onVorgaengeLoeschen: () => void;
  },
) {
  const [auf, setAuf] = useState(false);
  const b = zeile.buchung;

  return (
    <div className="pz">
      <button type="button" className="pz-kopf" aria-expanded={auf} onClick={() => setAuf((o) => !o)}>
        <span className="pz-pfeil" aria-hidden="true">{auf ? '▾' : '▸'}</span>
        <span className="pz-titel">
          Gerät {zeile.nummer}
          {zeile.vomStand && <>{' '}<span className="pz-marke">Info-Stand</span></>}
        </span>
        <span className="pz-rechts">
          {zeile.vorgaenge.length ? vorgangZahl(zeile.vorgaenge.length) : 'nicht protokolliert'}
        </span>
        <span className="pz-unter">{zeile.geraet || 'Geräteart unbekannt'}</span>
        <span className="pz-zeit">{uhrzeit(zeile.zuerst)}</span>
      </button>

      {auf && (
        <div className="pz-koerper">
          <dl className="pz-felder">
            <Feld name="Kennung"><span className="zahl">{zeile.client}</span></Feld>
            <Feld name="Erster Vorgang">{uhrzeit(zeile.zuerst)}</Feld>
            <Feld name="Letzter Vorgang">{uhrzeit(zeile.zuletzt)}</Feld>
            {b && <Feld name="Personen">{b.plaetze}</Feld>}
            {b && (
              <Feld name="Belegt">
                {slotsVon(b)} von 4 Slots · {slotsVon(b) * b.plaetze} Plätze
              </Feld>
            )}
            {b && BLOECKE.map((blk) => (
              <Feld key={blk.id} name={blk.label}>{angebotKurz(b.wahl?.[blk.id])}</Feld>
            ))}
            {b?.notiz && <Feld name="Notiz">{b.notiz}</Feld>}
          </dl>

          {!b && (
            <p className="mini">
              Unter dieser Kennung steht keine Anmeldung mehr: Entweder wurde alles wieder
              freigegeben, oder sie ist in ein Konto übernommen worden.
            </p>
          )}

          {zeile.vorgaenge.length > 0 && (
            <>
              <p className="mini pz-zwischentitel">Vorgänge, neuster zuoberst</p>
              <ol className="pz-vorgaenge">
                {zeile.vorgaenge.map((v) => (
                  <li key={v.id}>
                    <span className="zahl">{uhrzeit(v.zeitpunkt)}</span>
                    {' '}{VORGANG_TEXT[v.vorgang] ?? v.vorgang}
                    <span className="mini"> · {vorgangText(v)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          <div className="knopfzeile pz-knoepfe">
            {b && (
              <button className="knopf knopf--gefahr knopf--klein" disabled={laeuft}
                onClick={onAnmeldungLoeschen}>
                Anmeldung löschen
              </button>
            )}
            {zeile.vorgaenge.length > 0 && (
              <button className="knopf knopf--still knopf--klein" disabled={laeuft}
                onClick={onVorgaengeLoeschen}>
                Protokoll dieses Geräts löschen
              </button>
            )}
          </div>
          {b && (
            <p className="mini">
              Löschen gibt {platzZahl(slotsVon(b) * b.plaetze)} wieder frei.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Zeile des Verlaufs — zugeklappt Gerät, Uhrzeit und Vorgang. */
function VerlaufEintrag(
  { eintrag, nummer, laeuft, onLoeschen }:
  { eintrag: Protokollzeile; nummer: number; laeuft: boolean; onLoeschen: () => void },
) {
  const [auf, setAuf] = useState(false);

  return (
    <div className="pz">
      <button type="button" className="pz-kopf" aria-expanded={auf} onClick={() => setAuf((o) => !o)}>
        <span className="pz-pfeil" aria-hidden="true">{auf ? '▾' : '▸'}</span>
        <span className="pz-titel">
          Gerät {nummer}
          {eintrag.art === 'admin' && <>{' '}<span className="pz-marke">Info-Stand</span></>}
        </span>
        <span className="pz-rechts">{VORGANG_TEXT[eintrag.vorgang] ?? eintrag.vorgang}</span>
        <span className="pz-unter">{vorgangText(eintrag)}</span>
        <span className="pz-zeit">{uhrzeit(eintrag.zeitpunkt)}</span>
      </button>

      {auf && (
        <div className="pz-koerper">
          <dl className="pz-felder">
            <Feld name="Kennung"><span className="zahl">{eintrag.client}</span></Feld>
            <Feld name="Geräteart">{eintrag.geraet || '—'}</Feld>
            <Feld name="Block">{eintrag.block ? block(eintrag.block).label : '—'}</Feld>
            <Feld name="Angebot">{vorgangText(eintrag)}</Feld>
            <Feld name="Personen">{eintrag.plaetze}</Feld>
            <Feld name="Slots danach">{eintrag.slots} von 4</Feld>
          </dl>
          <div className="knopfzeile pz-knoepfe">
            <button className="knopf knopf--still knopf--klein" disabled={laeuft} onClick={onLoeschen}>
              Diese Zeile löschen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Feld({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="pz-feld">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------- Zugänge */

/**
 * Zugänge vergeben. Eingeladen wird über die Mailadresse, weil es die Person zu diesem
 * Zeitpunkt noch gar nicht gibt: Beim ersten Anmelden schaltet sie sich anhand dieser
 * Einladung selbst frei — mit genau der Rolle, die hier steht. Siehe firestore.rules.
 */
function Zugaenge({ melde, ich }: { melde: (t: string) => void; ich: User }) {
  const [einladungen, setEinladungen] = useState<(Zugang & { id: string })[]>([]);
  const [konten, setKonten] = useState<(Konto & { id: string })[]>([]);
  const [mail, setMail] = useState('');
  const [name, setName] = useState('');
  const [rolle, setRolle] = useState<Rolle>('betreuung');
  const [linkSchicken, setLinkSchicken] = useState(true);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => onSnapshot(
    collection(db, 'zugang'),
    (s) => setEinladungen(s.docs.map((d) => ({ id: d.id, ...(d.data() as Zugang) }))),
    () => setEinladungen([]),
  ), []);

  useEffect(() => onSnapshot(
    collection(db, 'admins'),
    (s) => setKonten(s.docs.map((d) => ({ id: d.id, ...(d.data() as Konto) }))),
    () => setKonten([]),
  ), []);

  /** Bereits angemeldete Konten zu dieser Adresse — sie tragen die wirksame Rolle. */
  const kontenZu = (adresse: string) =>
    konten.filter((k) => k.email && mailSchluessel(k.email) === mailSchluessel(adresse));

  const einladen = async () => {
    const adresse = mailSchluessel(mail);
    if (!adresse.includes('@')) { melde('Bitte eine gültige E-Mail-Adresse eingeben.'); return; }
    setLaeuft(true);
    try {
      await zugangSetzen(adresse, name, rolle, ich.email);
      if (linkSchicken) {
        // false: Die Adresse gehört nicht diesem Gerät — sie darf hier nicht gemerkt werden.
        try {
          // true: als Administration — der Server darf ehrlich antworten, sonst wäre ein
          // ausbleibendes Mail nicht von einem stillen «nicht eingeladen» zu unterscheiden.
          const post = await anmeldelinkSenden(adresse, false, true);
          melde(`${adresse} eingeladen — ${mailStandText(adresse, post)}`);
        } catch {
          melde(`${adresse} eingetragen. Der Anmeldelink liess sich nicht verschicken — `
            + 'die Person kann sich mit Google oder über «Anmeldelink per E-Mail schicken» anmelden.');
        }
      } else {
        melde(`${adresse} eingetragen.`);
      }
      setMail(''); setName('');
    } catch {
      melde('Das hat nicht geklappt. Bitte nochmals versuchen.');
    } finally { setLaeuft(false); }
  };

  const rolleAendern = async (eintrag: Zugang & { id: string }, neu: Rolle) => {
    await zugangSetzen(eintrag.id, eintrag.name, neu, ich.email);
    // Wer schon angemeldet ist, hat sein Konto bereits — dort muss die Rolle mitziehen.
    for (const k of kontenZu(eintrag.id)) await kontoRolleSetzen(k.id, neu);
    melde(`${eintrag.id}: ${ROLLEN_TEXT[neu]}.`);
  };

  const entfernen = async (eintrag: Zugang & { id: string }) => {
    const betroffen = kontenZu(eintrag.id);
    if (!confirm(`Zugang für ${eintrag.id} entfernen?`)) return;
    await zugangEntfernen(eintrag.id);
    // Ohne das bliebe der Zugang bestehen: Freigeschaltet ist, wer ein Konto hat.
    for (const k of betroffen) await kontoEntfernen(k.id);
    melde(`Zugang für ${eintrag.id} entfernt.`);
  };

  /** Konten ohne Einladung — etwa der Erstzugang aus den Rules. */
  const ohneEinladung = konten.filter(
    (k) => !einladungen.some((e) => k.email && e.id === mailSchluessel(k.email)),
  );

  return (
    <div className="stapel">
      <h3>Zugänge</h3>
      <p className="mini">
        <b>Betreuung</b> sieht die Übersicht und erfasst Anmeldungen für Gäste ohne Handy.
        <b> Administration</b> darf zusätzlich alles auf dieser Seite — Freigabeschalter,
        Meldungen, Kapazitäten, Zurücksetzen und Zugänge.
      </p>

      <div className="reihe">
        <div className="feld" style={{ flex: 2, minWidth: 200 }}>
          <label htmlFor="z-mail">E-Mail</label>
          <input id="z-mail" type="email" value={mail} onChange={(e) => setMail(e.target.value)}
            placeholder="vorname.name@example.ch" />
        </div>
        <div className="feld" style={{ flex: 2, minWidth: 160 }}>
          <label htmlFor="z-name">Name (freiwillig)</label>
          <input id="z-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="feld" style={{ flex: 1, minWidth: 150 }}>
          <label htmlFor="z-rolle">Rolle</label>
          <select id="z-rolle" value={rolle} onChange={(e) => setRolle(e.target.value as Rolle)}>
            <option value="betreuung">{ROLLEN_TEXT.betreuung}</option>
            <option value="admin">{ROLLEN_TEXT.admin}</option>
          </select>
        </div>
      </div>
      <label className="schieber">
        <input type="checkbox" checked={linkSchicken} onChange={(e) => setLinkSchicken(e.target.checked)} />
        Anmeldelink sofort per E-Mail schicken
      </label>
      <button className="knopf knopf--haupt" style={{ alignSelf: 'start' }} disabled={laeuft || !mail}
        onClick={einladen}>
        Zugang eintragen
      </button>

      <div className="roller">
        <table className="tabelle">
          <thead><tr><th>E-Mail</th><th>Name</th><th>Rolle</th><th>Stand</th><th /></tr></thead>
          <tbody>
            {einladungen.length === 0 && (
              <tr><td colSpan={5} className="mini">Noch keine Zugänge eingetragen.</td></tr>
            )}
            {[...einladungen].sort((a, b) => a.id.localeCompare(b.id)).map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td>{e.name}</td>
                <td>
                  <select value={e.rolle} onChange={(ev) => rolleAendern(e, ev.target.value as Rolle)}
                    style={{ minHeight: 36, padding: '4px 8px' }}>
                    <option value="betreuung">{ROLLEN_TEXT.betreuung}</option>
                    <option value="admin">{ROLLEN_TEXT.admin}</option>
                  </select>
                </td>
                <td className="mini">{kontenZu(e.id).length > 0 ? 'angemeldet' : 'noch nie angemeldet'}</td>
                <td>
                  <button className="knopf knopf--still" onClick={() => entfernen(e)}>Entfernen</button>
                </td>
              </tr>
            ))}
            {ohneEinladung.map((k) => (
              <tr key={k.id}>
                <td>{k.email ?? '—'}</td>
                <td>{k.name}</td>
                <td className="mini">{ROLLEN_TEXT[k.rolle] ?? k.rolle}</td>
                <td className="mini">Erstzugang</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
