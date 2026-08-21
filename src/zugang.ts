import {
  createUserWithEmailAndPassword, isSignInWithEmailLink, sendEmailVerification,
  sendPasswordResetEmail, sendSignInLinkToEmail, signInWithEmailLink, type User,
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
  erstelltAm?: string;
  erstelltVon?: string | null;
}

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

/** Einladen oder Rolle ändern. Wirkt beim nächsten Anmelden der Person. */
export async function zugangSetzen(
  mail: string, name: string, rolle: Rolle, von: string | null,
): Promise<void> {
  const schluessel = mailSchluessel(mail);
  await setDoc(doc(db, 'zugang', schluessel), {
    email: schluessel,
    name: name.trim() || schluessel,
    rolle,
    erstelltAm: new Date().toISOString(),
    erstelltVon: von,
  });
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
export async function bestaetigungSenden(u: User): Promise<void> {
  const idToken = await u.getIdToken();
  if (await mailSchnittstelle('/api/bestaetigung', { idToken }, ['gesendet', 'schon-bestaetigt'])) return;
  await sendEmailVerification(u, { url: `${window.location.origin}/admin` });
}

/**
 * Eine der drei Mail-Schnittstellen aufrufen (siehe netlify/functions/).
 * Liefert `true`, sobald sie den Fall erledigt hat — dann ist der Rückfall auf
 * Firebase weder nötig noch erwünscht.
 */
async function mailSchnittstelle(pfad: string, rumpf: object, erledigt: string[]): Promise<boolean> {
  try {
    const antwort = await fetch(pfad, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rumpf),
    });

    // Zu schnell hintereinander: Die vorige Mail ist eben erst rausgegangen —
    // ein Rückfall auf Firebase würde jetzt nur eine zweite Mail erzeugen.
    if (antwort.status === 429) return true;
    if (!antwort.ok) return false;

    // Ohne Funktionen (npm run dev) beantwortet der Entwicklungsserver den Aufruf
    // mit der Startseite — Status 200, aber HTML. Erst die Marke im Rumpf beweist,
    // dass wirklich die Funktion geantwortet hat.
    const daten = (await antwort.json()) as { stand?: string };
    return erledigt.includes(daten.stand ?? '');
  } catch {
    return false;
  }
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

/* ------------------------------------------------- Anmeldung per E-Mail-Link */

const MAIL_MERKER = 'fms-anmeldemail';

/**
 * Anmeldelink verschicken — wie die Bestätigungsmail zuerst über die eigene
 * Schnittstelle (`netlify/functions/anmeldelink.mjs`), sonst über Firebase.
 *
 * Ein Unterschied zur Bestätigungsmail: Unsere Schnittstelle schickt den Link nur an
 * Adressen, die eingeladen oder bereits freigeschaltet sind — sonst wäre sie ein offenes
 * Tor, um von unserer Domain aus beliebige Leute anzuschreiben. Sie sagt bewusst nicht,
 * welcher Fall vorlag, damit sich nicht durchprobieren lässt, wer Zugang hat. Für die
 * Person am Bildschirm ändert das nichts: Ein Link an eine nicht eingeladene Adresse
 * führte ohnehin nur auf «Kein Zugang».
 *
 * Voraussetzung in der Firebase-Konsole (für beide Wege): Authentication → Sign-in method
 * → «E-Mail-Adresse/Passwort» mit **E-Mail-Link (passwortloses Anmelden)** aktiviert, und
 * die Domain unter Authentication → Settings → Authorized domains eingetragen.
 */
export async function anmeldelinkSenden(mail: string, aufDiesemGeraet: boolean): Promise<void> {
  const adresse = mailSchluessel(mail);
  if (aufDiesemGeraet) window.localStorage.setItem(MAIL_MERKER, adresse);

  if (await mailSchnittstelle('/api/anmeldelink', { mail: adresse }, ['erledigt'])) return;

  await sendSignInLinkToEmail(auth, adresse, {
    url: `${window.location.origin}/admin`,
    handleCodeInApp: true,
  });
}

/** Wurde diese Seite über einen Anmeldelink geöffnet? */
export const linkAnmeldung = (): boolean => isSignInWithEmailLink(auth, window.location.href);

/** Auf dem Gerät, das den Link angefordert hat, kennen wir die Adresse bereits. */
export const gemerkteMail = (): string => window.localStorage.getItem(MAIL_MERKER) ?? '';

export async function mitLinkAnmelden(mail: string): Promise<void> {
  await signInWithEmailLink(auth, mailSchluessel(mail), window.location.href);
  window.localStorage.removeItem(MAIL_MERKER);
  // Den Einmal-Link aus der Adresszeile putzen: Ein Neuladen soll ihn nicht nochmals
  // einlösen (er ist dann verbraucht und ergäbe eine verwirrende Fehlermeldung).
  window.history.replaceState({}, '', '/admin');
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
export async function passwortZuruecksetzen(mail: string): Promise<void> {
  const adresse = mailSchluessel(mail);
  if (await mailSchnittstelle('/api/passwort', { mail: adresse }, ['erledigt'])) return;

  try {
    await sendPasswordResetEmail(auth, adresse, { url: `${window.location.origin}/admin` });
  } catch (fehler) {
    // Auch im Rückfall nicht verraten, ob es die Adresse gibt. Alles andere
    // (etwa eine unsinnige Adresse) darf der Bildschirm ruhig melden.
    if ((fehler as { code?: string })?.code !== 'auth/user-not-found') throw fehler;
  }
}
