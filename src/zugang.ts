import {
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail,
  signInWithCustomToken, signInWithEmailAndPassword, type User,
} from 'firebase/auth';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * Zwei Rollen für den Betreuungsbereich.
 *
 * `betreuung` — Übersicht ansehen und Anmeldungen für Gäste ohne Handy erfassen.
 *   Das sind Lehrpersonen und FMS-Schüler:innen, die am Morgen mithelfen.
 * `admin` — zusätzlich die Steuerung: Freigabeschalter, Meldung an alle, Kapazitäten,
 *   Zurücksetzen und das Vergeben von Zugängen.
 *
 * Durchgesetzt wird das in firestore.rules, nicht hier: Dieser Bildschirm läuft im
 * Browser und kann dort verändert werden.
 */
export type Rolle = 'admin' | 'betreuung';

export const ROLLEN_TEXT: Record<Rolle, string> = {
  admin: 'Administration',
  betreuung: 'Betreuung',
};

/** Einladung, abgelegt unter der Mailadresse — eine uid gibt es vorher noch nicht. */
export interface Zugang {
  email: string;
  name: string;
  rolle: Rolle;
  /** «Jetzt anmelden» im Mail — ein Link für alle Geräte. Nur für `betreuung` wirksam. */
  link?: boolean;
  /** «Login erstellen» im Mail — einmal ein Passwort festlegen. */
  passwort?: boolean;
  erstelltAm?: string;
  erstelltVon?: string | null;
}

/**
 * Wie sich eine eingeladene Person anmelden darf. Beides steht in der Einladung und
 * bestimmt, welche Knöpfe die Einladungsmail bekommt (einladungsLinks in
 * netlify/lib/mail.mjs) — und was die Zugangsfunktionen auf dem Server zulassen.
 *
 * `link` gibt es nur für die Betreuung: Der Link gilt, solange die Einladung besteht, auf
 * jedem Gerät. Für die Administration wäre das ein Dauerschlüssel im Postfach — sie
 * meldet sich mit Passwort oder Google an.
 */
export interface Anmeldewege {
  link: boolean;
  passwort: boolean;
}

export const STANDARD_WEGE = (rolle: Rolle): Anmeldewege => ({ link: rolle === 'betreuung', passwort: true });

/** Freigeschaltetes Konto, angelegt beim ersten Anmelden. */
export interface Konto {
  rolle: Rolle;
  name: string;
  email: string | null;
  seit: string;
}

export const mailSchluessel = (mail: string): string => mail.trim().toLowerCase();

const istRolle = (w: unknown): w is Rolle => w === 'admin' || w === 'betreuung';

/**
 * Rolle dieses Kontos ermitteln — und beim ersten Anmelden freischalten.
 * Gibt `null` zurück, wenn niemand diese Adresse eingeladen hat.
 */
export async function zugangKlaeren(u: User): Promise<Rolle | null> {
  const kontoRef = doc(db, 'admins', u.uid);
  const konto = await getDoc(kontoRef).catch(() => null);

  if (konto?.exists()) {
    const rolle = (konto.data() as Partial<Konto>).rolle;
    if (istRolle(rolle)) return rolle;
    // Altlast ohne Rollenfeld: nachtragen, soweit die Rules es zulassen (Erstzugang).
    // Klappt das nicht, gilt die kleinere Rolle — nie die grössere.
    try { await updateDoc(kontoRef, { rolle: 'admin' }); return 'admin'; }
    catch { return 'betreuung'; }
  }

  const einladung = u.email
    ? await getDoc(doc(db, 'zugang', mailSchluessel(u.email))).catch(() => null)
    : null;
  const daten = einladung?.exists() ? (einladung.data() as Zugang) : null;
  // Ohne Einladung bleibt nur der Erstzugang aus den Rules — der Versuch scheitert
  // für alle anderen Adressen an der Datenbank, nicht erst am Bildschirm.
  const rolle: Rolle = daten && istRolle(daten.rolle) ? daten.rolle : 'admin';

  try {
    await setDoc(kontoRef, {
      rolle,
      name: daten?.name || u.displayName || u.email || 'Betreuung',
      email: u.email ?? null,
      seit: new Date().toISOString(),
    });
    return rolle;
  } catch {
    return null;
  }
}

/** Einladen. Wirkt beim nächsten Anmelden der Person. */
export async function zugangSetzen(
  mail: string, name: string, rolle: Rolle, von: string | null,
  wege: Anmeldewege = STANDARD_WEGE(rolle),
): Promise<void> {
  const schluessel = mailSchluessel(mail);
  await setDoc(doc(db, 'zugang', schluessel), {
    email: schluessel,
    name: name.trim() || schluessel,
    rolle,
    link: rolle === 'betreuung' && wege.link,
    passwort: wege.passwort,
    erstelltAm: new Date().toISOString(),
    erstelltVon: von,
  });
}

/** Rolle oder Anmeldewege einer Einladung ändern. Wer Administration wird, verliert den Link. */
export async function zugangAendern(
  mail: string, felder: Partial<Pick<Zugang, 'rolle' | 'link' | 'passwort' | 'name'>>,
): Promise<void> {
  const neu = { ...felder };
  if (neu.rolle === 'admin') neu.link = false;
  await updateDoc(doc(db, 'zugang', mailSchluessel(mail)), neu);
}

/** Rolle einer bereits freigeschalteten Person nachziehen. */
export async function kontoRolleSetzen(uid: string, rolle: Rolle): Promise<void> {
  await updateDoc(doc(db, 'admins', uid), { rolle });
}

/** Einladung zurückziehen. Das freigeschaltete Konto muss separat gelöscht werden. */
export async function zugangEntfernen(mail: string): Promise<void> {
  await deleteDoc(doc(db, 'zugang', mailSchluessel(mail)));
}

export async function kontoEntfernen(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'admins', uid));
}

/* --------------------------------------------------- Konto selbst erstellen */

/**
 * Konto mit E-Mail und selbst gesetztem Passwort anlegen.
 *
 * Zugang bringt das für sich allein noch keinen: Freigeschaltet wird nur, wessen Adresse
 * unter «Steuerung → Zugänge» eingetragen ist (siehe `zugangKlaeren`) — wer ein Konto
 * anlegt, ohne eingeladen zu sein, landet auf «Kein Zugang».
 *
 * Und erst, wenn die Adresse bestätigt ist: `firestore.rules` verlangt `email_verified`.
 * Ohne diese Prüfung könnte sonst jemand ein Konto auf eine fremde, eingeladene Adresse
 * anlegen und damit deren Rolle übernehmen. Darum geht die Bestätigungsmail sofort raus.
 */
export async function kontoErstellen(mail: string, passwort: string): Promise<void> {
  const { user } = await createUserWithEmailAndPassword(auth, mailSchluessel(mail), passwort);
  await bestaetigungSenden(user);
}

/**
 * Bestätigungsmail (nochmals) verschicken.
 *
 * Erste Wahl ist die eigene Mail: `netlify/functions/bestaetigung.mjs` lässt sich
 * denselben Einmal-Link von Firebase geben und verschickt ihn in der Gestaltung der
 * App von unserer eigenen Domain (siehe docs/08-bestaetigungsmail.md).
 *
 * Klappt das nicht — Schlüssel fehlt, Resend gestört, oder es läuft gerade der
 * Entwicklungsserver ohne Funktionen —, verschickt Firebase die Mail wie bisher
 * selbst. Sie sieht dann nüchtern aus, aber niemand bleibt vor der Tür stehen.
 */
export async function bestaetigungSenden(u: User): Promise<MailErgebnis> {
  const idToken = await u.getIdToken();
  const eigen = await mailSchnittstelle('/api/bestaetigung', { idToken },
    ['gesendet', 'schon-bestaetigt', 'gesperrt']);
  if (eigen) return { weg: 'eigen', ...eigen };
  await sendEmailVerification(u, { url: `${window.location.origin}/admin` });
  return { weg: 'firebase' };
}

/**
 * Welcher Weg hat die Mail verschickt?
 *
 * `eigen` — unsere Gestaltung, Absender auf `alae.app`, verschickt über Resend.
 * `firebase` — der Rückfall: Firebase verschickt selbst, nüchtern und von
 *   `noreply@fmsbesuchstag.firebaseapp.com`.
 *
 * Der Rückfall ist Absicht (niemand soll vor der Tür stehen bleiben), aber er darf nicht
 * stillschweigend geschehen: Sonst sieht eine unvollständige Einrichtung genau gleich aus
 * wie der Normalfall — man wartet auf die schöne Mail und bekommt immer die von Firebase.
 */
export type MailWeg = 'eigen' | 'firebase';

/**
 * Was aus einer Mail geworden ist.
 *
 * `stand` und `grund` füllt der Server nur, wenn er ehrlich antworten durfte — beim
 * Einladen schickt die Administration ihr ID-Token mit. Ohne das bleibt die Antwort
 * bewusst nichtssagend, damit sich nicht durchprobieren lässt, wer Zugang hat.
 */
export interface MailErgebnis {
  weg: MailWeg;
  /** `gesendet`, `nicht-eingeladen`, `gesperrt`, `schon-bestaetigt` — oder `erledigt`. */
  stand?: string;
  /** Wortlaut des Servers, wenn der eigene Versand scheiterte. */
  grund?: string;
}

/** Was die Schnittstelle beim Scheitern in die Browserkonsole schreibt. */
function rueckfallGrund(status: number, rumpf: string): string {
  if (status === 503) {
    return 'Auf dem Server fehlt ein Schlüssel (RESEND_API_KEY, MAIL_ABSENDER oder '
      + 'FIREBASE_SERVICE_ACCOUNT). Netlify → Site configuration → Environment variables, '
      + 'danach Deploys → Trigger deploy.';
  }
  if (status === 502) {
    return 'Der Server hat die Mail nicht loswerden können — meist lehnt Resend ab '
      + '(Domain nicht verifiziert, Schlüssel ungültig, Absender passt nicht zur Domain). '
      + 'Den genauen Grund nennt Netlify → Logs → Functions.';
  }
  if (status === 404 || rumpf.startsWith('<')) {
    return 'Die Funktion ist unter diesem Pfad nicht erreichbar — läuft hier der '
      + 'Entwicklungsserver (npm run dev) statt netlify dev, oder fehlt der /api/*-Umweg '
      + 'in netlify.toml?';
  }
  return 'Unerwartete Antwort der Schnittstelle.';
}

/**
 * Eine der drei Mail-Schnittstellen aufrufen (siehe netlify/functions/).
 * Liefert `true`, sobald sie den Fall erledigt hat — dann ist der Rückfall auf
 * Firebase weder nötig noch erwünscht.
 */
type Antwort = { stand?: string; grund?: string } | null;

async function mailSchnittstelle(
  pfad: string, rumpf: object, erledigt: string[],
): Promise<Antwort> {
  const gescheitert = (status: number, text: string, grund?: string) => {
    console.warn(`[mail] ${pfad} hat nicht übernommen (HTTP ${status || 0}) — die Mail geht `
      + `darum über Firebase.\n${grund ?? rueckfallGrund(status, text)}\nAntwort: ${text.slice(0, 200)}`);
    return null;
  };

  let antwort: Response;
  try {
    antwort = await fetch(pfad, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rumpf),
    });
  } catch (fehler) {
    console.warn(`[mail] ${pfad} war nicht erreichbar — die Mail geht über Firebase.`, fehler);
    return null;
  }

  // Zu schnell hintereinander: Die vorige Mail ist eben erst rausgegangen —
  // ein Rückfall auf Firebase würde jetzt nur eine zweite Mail erzeugen.
  if (antwort.status === 429) return { stand: 'gesperrt' };

  const text = await antwort.text().catch(() => '');
  let daten: { stand?: string; grund?: string } = {};
  // Ohne Funktionen (npm run dev) beantwortet der Entwicklungsserver den Aufruf
  // mit der Startseite — Status 200, aber HTML. Erst die Marke im Rumpf beweist,
  // dass wirklich die Funktion geantwortet hat.
  try { daten = JSON.parse(text); } catch { /* kein JSON — gilt als Fehlschlag */ }

  if (!antwort.ok) return gescheitert(antwort.status, text, daten.grund);
  if (erledigt.includes(daten.stand ?? '')) return daten;
  return gescheitert(antwort.status, text, daten.grund);
}

/**
 * Nach dem Klick auf den Bestätigungslink: Zustand vom Server holen und ein frisches
 * Token ziehen. Ohne das Zweite steht `email_verified` im mitgeführten Token weiterhin
 * auf `false` — und die Datenbank weist die Freischaltung ab, obwohl die Adresse längst
 * bestätigt ist. Liefert `true`, sobald die Adresse bestätigt ist.
 */
export async function bestaetigungPruefen(): Promise<boolean> {
  const u = auth.currentUser;
  if (!u) return false;
  await u.reload();
  if (!u.emailVerified) return false;
  await u.getIdToken(true);
  return true;
}

/* ------------------------------------------------- Einladung und Zugangscode */

/**
 * Der Zugangscode aus der Einladungsmail steht im Link: `/admin?zugang=CODE` für «Jetzt
 * anmelden», dazu `&login=1` für «Login erstellen». Beides wird hier in der App
 * eingelöst — über die Netlify-Funktionen, die den Code prüfen (netlify/lib/dienst.mjs);
 * der Browser kennt ihn nur aus dem Link.
 *
 * Warum kein Einmal-Link von Firebase mehr: Der galt genau einmal und nur in dem Browser,
 * in dem er geöffnet wurde. Wer ihn im Mailprogramm antippte, war dort angemeldet — und
 * im eigentlichen Browser nicht; beim zweiten Versuch war der Link verbraucht. Der
 * Zugangscode gilt, solange die Einladung besteht, auf jedem Gerät: Link öffnen, Adresse
 * eintippen, fertig.
 */
export interface Zugangslink {
  code: string;
  /** `&login=1`: nicht anmelden, sondern ein Passwort festlegen. */
  login: boolean;
}

export function zugangslink(): Zugangslink | null {
  const p = new URLSearchParams(window.location.search);
  const code = p.get('zugang');
  return code ? { code, login: p.get('login') === '1' } : null;
}

/** Ein Anmeldelink aus der Zeit vor dem Zugangscode — der Einmal-Link von Firebase. */
export const alterAnmeldelink = (): boolean => {
  const p = new URLSearchParams(window.location.search);
  return p.get('mode') === 'signIn' && p.has('oobCode');
};

/**
 * Den Link aus der Adresszeile putzen, sobald er eingelöst ist: Ein Neuladen soll nicht
 * nochmals den Anmeldebildschirm für den Link zeigen.
 */
const adresszeilePutzen = () => window.history.replaceState({}, '', '/admin');

/**
 * Was die Zugangs-Schnittstellen ablehnen — `code` passt in anmeldeFehlerText wie ein
 * Firebase-Code (`zugang/passt-nicht`, `zugang/nur-betreuung`, `zugang/gesperrt` …).
 */
export class ZugangFehler extends Error {
  readonly code: string;

  constructor(grund: string, nachricht: string) {
    super(nachricht);
    this.name = 'ZugangFehler';
    this.code = `zugang/${grund}`;
  }
}

async function zugangsAufruf<T>(pfad: string, rumpf: object): Promise<T> {
  let antwort: Response;
  try {
    antwort = await fetch(pfad, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rumpf),
    });
  } catch {
    throw new ZugangFehler('netz', 'Keine Verbindung');
  }
  const text = await antwort.text().catch(() => '');
  let daten: { fehler?: string; grund?: string } | null = null;
  // Ohne Funktionen (npm run dev) antwortet der Entwicklungsserver mit der Startseite —
  // Status 200, aber HTML. Erst gültiges JSON beweist, dass die Funktion geantwortet hat.
  try { daten = JSON.parse(text); } catch { daten = null; }
  if (!antwort.ok || !daten || typeof daten !== 'object') {
    console.warn(`[zugang] ${pfad} antwortete HTTP ${antwort.status}: ${text.slice(0, 200)}`);
    const grund = daten?.grund ?? (!daten || antwort.status === 404 ? 'keine-funktion' : 'server');
    throw new ZugangFehler(grund, daten?.fehler ?? 'Unerwartete Antwort der Schnittstelle');
  }
  return daten as T;
}

/** «Jetzt anmelden»: Code und Adresse → Anmelde-Token von Firebase → angemeldet. */
export async function mitZugangscodeAnmelden(code: string, mail: string): Promise<void> {
  const { token } = await zugangsAufruf<{ token: string }>('/api/zugang-anmelden', {
    code, mail: mailSchluessel(mail),
  });
  await signInWithCustomToken(auth, token);
  adresszeilePutzen();
}

/**
 * «Login erstellen»: Code, Adresse und neues Passwort → Konto mit Passwort → angemeldet.
 * Ohne Bestätigungsmail: Der Code kam per Mail an genau diese Adresse, das genügt als
 * Nachweis — der Server setzt die Adresse als bestätigt.
 */
export async function loginErstellen(code: string, mail: string, passwort: string): Promise<void> {
  const adresse = mailSchluessel(mail);
  await zugangsAufruf('/api/login-erstellen', { code, mail: adresse, passwort });
  await signInWithEmailAndPassword(auth, adresse, passwort);
  adresszeilePutzen();
}

export interface EinladungsLinks {
  anmelden?: string;
  login?: string;
}

/**
 * Was aus der Einladung geworden ist. `stand` und `links` sind nur für die Administration
 * gefüllt (`gesendet`, `links`, `nicht-eingeladen`, `gesperrt`, `nichts-erlaubt`); alle
 * anderen bekommen `erledigt`, damit sich nicht durchprobieren lässt, wer eingeladen ist.
 */
export interface EinladungsErgebnis {
  stand: string;
  links?: EinladungsLinks;
}

/**
 * Einladungsmail verschicken — oder nur die Links holen (`senden: false`), etwa um sie
 * per Chat weiterzugeben. `erneuern` erzeugt einen neuen Zugangscode; die alten Links
 * sind damit tot. Beides nur als Administration (mit ID-Token); ohne Ausweis wird
 * verschickt, und die Antwort bleibt neutral (siehe netlify/functions/einladung.mjs).
 */
export async function einladungSenden(
  mail: string,
  optionen: { alsAdministration?: boolean; senden?: boolean; erneuern?: boolean } = {},
): Promise<EinladungsErgebnis> {
  const idToken = optionen.alsAdministration ? await auth.currentUser?.getIdToken() : undefined;
  return zugangsAufruf<EinladungsErgebnis>('/api/einladung', {
    mail: mailSchluessel(mail),
    idToken,
    senden: optionen.senden ?? true,
    erneuern: optionen.erneuern ?? false,
  });
}

/* ------------------------------------------------ Passwort zurücksetzen */

/**
 * Mail zum Zurücksetzen des Passworts auslösen.
 *
 * Wie beim Anmeldelink entscheidet der Server, ob überhaupt etwas rausgeht: nur an
 * eingeladene oder freigeschaltete Adressen, und nur wenn es dazu ein Konto mit Passwort
 * gibt. Die Antwort ist in allen Fällen dieselbe — der Bildschirm sagt darum «falls es ein
 * Konto gibt», statt Versand zu behaupten.
 *
 * Das Passwort selbst wird auf der Firebase-Seite hinter dem Link neu gesetzt; wir
 * gestalten nur die Mail.
 */
export async function passwortZuruecksetzen(mail: string): Promise<MailErgebnis> {
  const adresse = mailSchluessel(mail);
  const eigen = await mailSchnittstelle('/api/passwort', { mail: adresse }, ['erledigt', 'gesperrt']);
  if (eigen) return { weg: 'eigen', ...eigen };

  try {
    await sendPasswordResetEmail(auth, adresse, { url: `${window.location.origin}/admin` });
  } catch (fehler) {
    // Auch im Rückfall nicht verraten, ob es die Adresse gibt. Alles andere
    // (etwa eine unsinnige Adresse) darf der Bildschirm ruhig melden.
    if ((fehler as { code?: string })?.code !== 'auth/user-not-found') throw fehler;
  }
  return { weg: 'firebase' };
}
