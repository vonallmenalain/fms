import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword,
  signInWithPopup, signOut, type User,
} from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, onSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import {
  ANGEBOTE, BLOECKE, angebot, angeboteFuer, metaZeile, programm, zeitraum,
  type BlockId,
} from '../programm';
import { useAlleSlots } from '../hooks/useSlots';
import { useAppConfig } from '../hooks/useAppConfig';
import { erfasseAdminBuchung, type Buchung } from '../buchung';
import { AusgebuchtFehler } from '../wiederholung';
import { Kopf, Meldung } from '../ui/Bausteine';

type Reiter = 'uebersicht' | 'erfassen' | 'steuerung';

export default function Admin({ onRaus }: { onRaus: () => void }) {
  const [benutzer, setBenutzer] = useState<User | null | undefined>(undefined);
  const [istAdmin, setIstAdmin] = useState<boolean | null>(null);
  const [reiter, setReiter] = useState<Reiter>('uebersicht');
  const [meldung, setMeldung] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, (u) => setBenutzer(u && !u.isAnonymous ? u : null)), []);

  // Beim ersten Anmelden das eigene admins/{uid}-Dokument anlegen; danach greift exists().
  useEffect(() => {
    if (!benutzer) { setIstAdmin(null); return; }
    const ref = doc(db, 'admins', benutzer.uid);
    getDoc(ref)
      .then(async (s) => {
        if (s.exists()) { setIstAdmin(true); return; }
        await setDoc(ref, {
          name: benutzer.displayName || benutzer.email || 'Lehrperson',
          email: benutzer.email ?? null,
          seit: new Date().toISOString(),
        });
        setIstAdmin(true);
      })
      .catch(() => setIstAdmin(false));
  }, [benutzer]);

  if (benutzer === undefined) return <div className="seite"><p className="lauftext">Einen Moment …</p></div>;
  if (!benutzer) return <Anmelden onRaus={onRaus} />;
  if (istAdmin === false) {
    return (
      <div className="seite">
        <Kopf klein />
        <div className="hinweis hinweis--fehler">
          <b>Kein Zugang.</b> Das Konto {benutzer.email} ist nicht als Betreuung freigeschaltet.
        </div>
        <button className="knopf knopf--rand" onClick={() => signOut(auth)}>Abmelden</button>
      </div>
    );
  }
  if (istAdmin === null) return <div className="seite"><p className="lauftext">Zugang wird geprüft …</p></div>;

  return (
    <div className="seite seite--weit">
      <div className="admin-kopf nicht-drucken">
        <div className="reihe">
          <img src="/fms-neufeld.png" alt="fms Neufeld" style={{ width: 110, height: 'auto' }} />
          <strong>Betreuung</strong>
        </div>
        <div className="reihe">
          <span className="mini">{benutzer.email}</span>
          <button className="knopf knopf--still" onClick={() => signOut(auth).then(onRaus)}>Abmelden</button>
        </div>
      </div>

      <div className="reiter nicht-drucken" role="tablist">
        {([
          ['uebersicht', 'Übersicht'],
          ['erfassen', '+ Anmeldung erfassen'],
          ['steuerung', 'Steuerung'],
        ] as [Reiter, string][]).map(([id, text]) => (
          <button key={id} role="tab" aria-selected={reiter === id} onClick={() => setReiter(id)}>{text}</button>
        ))}
      </div>

      {reiter === 'uebersicht' && <Uebersicht />}
      {reiter === 'erfassen' && <Erfassen melde={setMeldung} />}
      {reiter === 'steuerung' && <Steuerung melde={setMeldung} />}

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
    case 'auth/invalid-email':
      return { text: 'E-Mail oder Passwort stimmen nicht.' };
    case 'auth/too-many-requests':
      return { text: 'Zu viele Versuche. Bitte einen Moment warten und nochmals versuchen.' };
    case 'auth/network-request-failed':
      return { text: 'Keine Verbindung. Bitte Netz prüfen und nochmals versuchen.' };
    default:
      return { text: 'Anmeldung fehlgeschlagen.', hinweis: code || undefined };
  }
}

function Anmelden({ onRaus }: { onRaus: () => void }) {
  const [mail, setMail] = useState('');
  const [pw, setPw] = useState('');
  const [fehler, setFehler] = useState<{ text: string; hinweis?: string } | null>(null);
  const [laeuft, setLaeuft] = useState(false);

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

  return (
    <div className="seite">
      <Kopf />
      <h1>Betreuung</h1>
      <p className="lauftext">Nur für Lehrpersonen am Besuchsmorgen.</p>

      <form className="stapel" onSubmit={(e) => { e.preventDefault(); melden(() => signInWithEmailAndPassword(auth, mail, pw)); }}>
        <div className="feld">
          <label htmlFor="mail">E-Mail</label>
          <input id="mail" type="email" autoComplete="username" value={mail} onChange={(e) => setMail(e.target.value)} required />
        </div>
        <div className="feld">
          <label htmlFor="pw">Passwort</label>
          <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </div>
        {fehler && (
          <div className="hinweis hinweis--fehler">
            <b>{fehler.text}</b>
            {fehler.hinweis && <><br /><span className="klein">{fehler.hinweis}</span></>}
          </div>
        )}
        <button className="knopf knopf--haupt knopf--breit" disabled={laeuft}>Anmelden</button>
      </form>

      <button className="knopf knopf--rand knopf--breit" disabled={laeuft}
        onClick={() => melden(() => signInWithPopup(auth, new GoogleAuthProvider()))}>
        Mit Google anmelden
      </button>

      <button className="knopf knopf--still" onClick={onRaus}>← Zurück zur Anmeldung</button>
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
        <input id="notiz" value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. 3 SuS ohne Handy" />
      </div>

      <button className="knopf knopf--haupt knopf--breit" disabled={laeuft} onClick={speichern}>
        Anmeldung erfassen
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ Steuerung */

function Steuerung({ melde }: { melde: (t: string) => void }) {
  const { config } = useAppConfig();
  const staende = useAlleSlots();
  const [banner, setBanner] = useState(config.banner);
  const [laeuft, setLaeuft] = useState(false);
  useEffect(() => setBanner(config.banner), [config.banner]);

  const setzen = async (werte: Record<string, unknown>) => {
    await setDoc(doc(db, 'config', 'app'), werte, { merge: true });
  };

  const seeden = async () => {
    setLaeuft(true);
    try {
      const b = writeBatch(db);
      for (const a of ANGEBOTE) {
        b.set(doc(db, 'slots', a.id), { kapazitaet: a.kapazitaet, block: a.blockId }, { merge: true });
      }
      b.set(doc(db, 'config', 'app'), { programmVersion: programm.version }, { merge: true });
      await b.commit();
      melde(`${ANGEBOTE.length} Angebote eingespielt.`);
    } finally { setLaeuft(false); }
  };

  const alleFreigeben = async () => {
    if (!confirm('Wirklich ALLE Anmeldungen löschen und alle Zähler auf 0 setzen?')) return;
    setLaeuft(true);
    try {
      const bu = await getDocs(collection(db, 'bookings'));
      const b = writeBatch(db);
      bu.docs.forEach((d) => b.delete(d.ref));
      ANGEBOTE.forEach((a) => b.set(doc(db, 'slots', a.id), { belegt: 0, kapazitaet: a.kapazitaet, block: a.blockId }));
      await b.commit();
      melde('Alles zurückgesetzt.');
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
        <div className="reihe">
          <div className="feld" style={{ flex: 1 }}>
            <input value={banner} onChange={(e) => setBanner(e.target.value)}
              placeholder="z. B. Sport findet in Turnhalle 2 statt" />
          </div>
          <button className="knopf knopf--rand" style={{ alignSelf: 'end' }}
            onClick={() => setzen({ banner }).then(() => melde('Meldung gesetzt.'))}>Senden</button>
        </div>
      </div>

      <hr className="trenner" />

      <div className="stapel">
        <h3>Notfall-Schalter</h3>
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
        <div className="roller">
          <table className="tabelle">
            <thead><tr><th>Angebot</th><th>Belegt</th><th>Kapazität</th></tr></thead>
            <tbody>
              {ANGEBOTE.map((a) => (
                <tr key={a.id}>
                  <td>{a.fach}{a.klasse ? ` · ${a.klasse}` : ''} <span className="mini">{a.raum}</span></td>
                  <td className="zahl">{staende[a.id]?.belegt ?? 0}</td>
                  <td>
                    <input type="number" min={0} max={99} defaultValue={staende[a.id]?.kapazitaet ?? a.kapazitaet}
                      style={{ width: 72, minHeight: 36, padding: '4px 8px' }}
                      onBlur={(e) => kapazitaetAendern(a.id, Number(e.target.value))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <hr className="trenner" />

      <div className="stapel">
        <h3>Wartung</h3>
        <div className="knopfzeile">
          <button className="knopf knopf--rand" disabled={laeuft} onClick={seeden}>
            Programm einspielen ({ANGEBOTE.length} Angebote)
          </button>
          <button className="knopf knopf--gefahr" disabled={laeuft} onClick={alleFreigeben}>
            Alles zurücksetzen
          </button>
        </div>
        <p className="mini">
          «Programm einspielen» legt fehlende Angebote an und gleicht Kapazitäten ab, ohne
          bestehende Buchungen zu verlieren. «Alles zurücksetzen» löscht alle Anmeldungen —
          nach der Generalprobe.
        </p>
      </div>
    </div>
  );
}
