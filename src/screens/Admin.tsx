import { useCallback, useEffect, useState } from 'react';
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword,
  signInWithPopup, signOut, type User,
} from 'firebase/auth';
import {
  collection, doc, getDocs, setDoc, updateDoc, writeBatch, onSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import {
  ANGEBOTE, BLOECKE, angebot, angeboteFuer, metaZeile, zeitraum,
  type BlockId,
} from '../programm';
import { useAlleSlots } from '../hooks/useSlots';
import { useAppConfig } from '../hooks/useAppConfig';
import { erfasseAdminBuchung, type Buchung } from '../buchung';
import { AusgebuchtFehler } from '../wiederholung';
import { Kopf, Meldung } from '../ui/Bausteine';
import {
  ROLLEN_TEXT, anmeldelinkSenden, bestaetigungPruefen, bestaetigungSenden, gemerkteMail,
  kontoEntfernen, kontoErstellen, kontoRolleSetzen, linkAnmeldung, mailSchluessel,
  mitLinkAnmelden, passwortZuruecksetzen, zugangEntfernen, zugangKlaeren, zugangSetzen,
  type Konto, type Rolle, type Zugang,
} from '../zugang';

type Reiter = 'uebersicht' | 'erfassen' | 'steuerung';

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
      <div className="admin-kopf nicht-drucken">
        <div className="reihe">
          <img src="/fms-neufeld.png" alt="fms Neufeld" style={{ width: 110, height: 'auto' }} />
          <strong>Betreuung</strong>
        </div>
        <div className="reihe">
          <span className="mini">{benutzer.email} · {ROLLEN_TEXT[rolle]}</span>
          <button className="knopf knopf--still" onClick={() => signOut(auth).then(onRaus)}>Abmelden</button>
        </div>
      </div>

      <div className="reiter nicht-drucken" role="tablist">
        {reiterListe.map(([id, text]) => (
          <button key={id} role="tab" aria-selected={offen === id} onClick={() => setReiter(id)}>{text}</button>
        ))}
      </div>

      {offen === 'uebersicht' && <Uebersicht />}
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

/* ------------------------------------------------------------------ Übersicht */

function Uebersicht() {
  const staende = useAlleSlots();
  const [buchungen, setBuchungen] = useState<Buchung[]>([]);

  useEffect(() => onSnapshot(collection(db, 'bookings'), (s) =>
    setBuchungen(s.docs.map((d) => d.data() as Buchung))), []);

  const personen = buchungen.reduce((n, b) => n + (b.plaetze || 0), 0);
  const plaetzeGebucht = Object.values(staende).reduce((n, s) => n + s.belegt, 0);
  const ohneHandy = buchungen.filter((b) => b.quelle === 'admin').reduce((n, b) => n + b.plaetze, 0);

  const csv = () => {
    const zeilen = [['Block', 'Zeit', 'Fach', 'Klasse', 'Zimmer', 'Lehrperson', 'Belegt', 'Kapazitaet']];
    for (const b of BLOECKE) {
      for (const a of angeboteFuer(b.id)) {
        const s = staende[a.id];
        zeilen.push([b.label, zeitraum(b), a.fach, a.klasse ?? '', a.raum, a.lehrperson ?? '',
          String(s?.belegt ?? 0), String(a.kapazitaet)]);
      }
    }
    const text = zeilen.map((z) => z.map((f) => `"${f.replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `besuchsmorgen-belegung.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stapel">
      <dl className="kennzahlen">
        <div className="kennzahl"><dt>Anmeldungen</dt><dd>{buchungen.length}</dd></div>
        <div className="kennzahl"><dt>Personen</dt><dd>{personen}</dd></div>
        <div className="kennzahl"><dt>belegte Plätze</dt><dd>{plaetzeGebucht}</dd></div>
        <div className="kennzahl"><dt>davon ohne Handy</dt><dd>{ohneHandy}</dd></div>
      </dl>

      <div className="knopfzeile nicht-drucken">
        <button className="knopf knopf--rand" onClick={() => window.print()}>Drucken</button>
        <button className="knopf knopf--rand" onClick={csv}>CSV herunterladen</button>
      </div>

      <div className="raster raster--vier">
        {BLOECKE.map((b) => (
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
    if (!confirm('Wirklich ALLE Anmeldungen löschen und alle Zähler auf 0 setzen?')) return;
    setLaeuft(true);
    try {
      const bu = await getDocs(collection(db, 'bookings'));
      // Ein Firestore-Stapel fasst höchstens 500 Vorgänge. Bei 120 Gästen wäre das kein
      // Thema — nach ein paar Proberunden ohne Zurücksetzen schon, und dann scheiterte
      // ausgerechnet der Knopf, der wieder aufräumen soll. Also in Portionen.
      let stapel = writeBatch(db);
      const abschicken: Promise<void>[] = [];
      let offen = 0;
      const dazu = (fn: (b: ReturnType<typeof writeBatch>) => void) => {
        fn(stapel);
        if (++offen === 400) { abschicken.push(stapel.commit()); stapel = writeBatch(db); offen = 0; }
      };
      bu.docs.forEach((d) => dazu((b) => b.delete(d.ref)));
      ANGEBOTE.forEach((a) => dazu((b) =>
        b.set(doc(db, 'slots', a.id), { belegt: 0, kapazitaet: a.kapazitaet, block: a.blockId })));
      if (offen) abschicken.push(stapel.commit());
      await Promise.all(abschicken);
      melde(`Alles zurückgesetzt — ${bu.size} Anmeldungen gelöscht.`);
    } catch {
      melde('Das Zurücksetzen hat nicht geklappt. Bitte nochmals versuchen.');
    } finally { setLaeuft(false); }
  };

  const kapazitaetAendern = async (id: string, wert: number) => {
    await updateDoc(doc(db, 'slots', id), { kapazitaet: wert });
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

      <div className="stapel">
        <h3>Kapazitäten</h3>
        <p className="mini">
          Die Zahl gilt ab sofort. Kleiner als «Belegt» zu setzen nimmt niemandem den Platz weg —
          es kommt nur nichts mehr dazu.
        </p>
        {BLOECKE.map((b) => (
          <div className="stapel" key={b.id}>
            <h4 className="blocktitel">{b.label} <span className="zahl">· {zeitraum(b)}</span></h4>
            <div className="roller">
              <table className="tabelle">
                <thead><tr><th>Angebot</th><th>Belegt</th><th>Kapazität</th></tr></thead>
                <tbody>
                  {angeboteFuer(b.id).map((a) => (
                    <tr key={a.id}>
                      <td>{a.fach}{a.klasse ? ` · ${a.klasse}` : ''} <span className="mini">{a.raum}</span></td>
                      <td className="zahl">{staende[a.id]?.belegt ?? 0}</td>
                      <td>
                        <input type="number" min={0} max={99}
                          defaultValue={staende[a.id]?.kapazitaet ?? a.kapazitaet}
                          style={{ width: 72, minHeight: 36, padding: '4px 8px' }}
                          onBlur={(e) => kapazitaetAendern(a.id, Number(e.target.value))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

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
          Löscht alle Anmeldungen und setzt alle Zähler auf 0.
        </p>
      </div>
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
          const weg = await anmeldelinkSenden(adresse, false);
          // Sagt offen, welcher Weg es war: Kommt der Link von Firebase statt in unserer
          // Gestaltung, ist der eigene Versand gestört — das darf nicht unbemerkt bleiben.
          melde(weg === 'eigen'
            ? `${adresse} eingeladen — Anmeldelink verschickt.`
            : `${adresse} eingeladen — Anmeldelink verschickt, aber über Firebase statt über `
              + 'alae.app: Der eigene Versand hat nicht geantwortet. Grund in der '
              + 'Browserkonsole und in Netlify → Logs → Functions.');
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
