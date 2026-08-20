import {
  isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink, type User,
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

/* ------------------------------------------------- Anmeldung per E-Mail-Link */

const MAIL_MERKER = 'fms-anmeldemail';

/**
 * Firebase verschickt den Anmeldelink selbst — kein Mailserver, keine Cloud Function.
 * Voraussetzung in der Firebase-Konsole: Authentication → Sign-in method →
 * «E-Mail-Adresse/Passwort» mit **E-Mail-Link (passwortloses Anmelden)** aktiviert,
 * und die Domain unter Authentication → Settings → Authorized domains eingetragen.
 */
export function anmeldelinkSenden(mail: string, aufDiesemGeraet: boolean): Promise<void> {
  if (aufDiesemGeraet) window.localStorage.setItem(MAIL_MERKER, mailSchluessel(mail));
  return sendSignInLinkToEmail(auth, mailSchluessel(mail), {
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
