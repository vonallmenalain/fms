/* =========================================================================
   Gemeinsamer Unterbau der Netlify-Funktionen
   -------------------------------------------------------------------------
   Firebase-Admin-SDK, einheitliche Antworten, eine kleine Sperre gegen allzu
   schnelles Nachfassen — und alles rund um den Zugangscode der Einladung:
   erzeugen, prüfen, Konto anlegen, freischalten. Das brauchen die Einladung,
   «Jetzt anmelden» und «Login erstellen», und alle drei sollen sich gleich
   verhalten.
   ========================================================================= */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/** Der Server ist unvollständig eingerichtet — das gehört ins Protokoll, nicht zum Gast. */
export class EinrichtungsFehler extends Error {
  constructor(nachricht) { super(nachricht); this.name = 'EinrichtungsFehler'; }
}

let bereit = false;

/**
 * Admin-SDK einrichten. Die Zugangsdaten stehen in der Netlify-Umgebung als
 * FIREBASE_SERVICE_ACCOUNT (der JSON-Inhalt der Schlüsseldatei, einzeilig).
 * Ohne sie kann die Funktion nichts tun — dann bleibt der Rückfall im Browser.
 */
function einrichten() {
  if (bereit || getApps().length) { bereit = true; return; }
  const roh = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!roh) throw new EinrichtungsFehler('FIREBASE_SERVICE_ACCOUNT ist nicht gesetzt');
  let konto;
  try { konto = JSON.parse(roh); }
  catch { throw new EinrichtungsFehler('FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON'); }
  // In den meisten Oberflächen für Umgebungsvariablen überleben echte
  // Zeilenumbrüche im Schlüssel nicht — dann stehen dort \n als zwei Zeichen.
  if (typeof konto.private_key === 'string') konto.private_key = konto.private_key.replace(/\\n/g, '\n');
  initializeApp({ credential: cert(konto) });
  bereit = true;
}

export function adminAuth() { einrichten(); return getAuth(); }
export function adminDb() { einrichten(); return getFirestore(); }

/* ------------------------------------------------------------- Antworten */

export const antwort = (status, daten) =>
  new Response(JSON.stringify(daten), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/* ---------------------------------------------------------------- Sperre */

/**
 * Mindestabstand zwischen zwei Mails an dieselbe Adresse. Die Bildschirme sperren
 * ihre Knöpfe schon selbst; das hier fängt den Fall ab, dass jemand die
 * Schnittstelle direkt bedient.
 *
 * Bewusst nur im Arbeitsspeicher: Netlify hält eine Instanz einige Minuten warm,
 * das genügt für den Zweck; ein kalter Start setzt zurück. Die eigentliche Bremse
 * liegt ohnehin bei Firebase (Kontingent für Aktionslinks).
 */
const SPERRE_MS = 30_000;
const zuletzt = new Map();

export function zuSchnell(schluessel) {
  const letzte = zuletzt.get(schluessel) ?? 0;
  if (Date.now() - letzte < SPERRE_MS) return true;
  zuletzt.set(schluessel, Date.now());
  return false;
}

/** Nach einem gescheiterten Versand: Der Versuch zählt nicht, also auch nicht sperren. */
export const sperreLoesen = (schluessel) => zuletzt.delete(schluessel);

/* ------------------------------------------------------------- Adressen */

/** Grob, aber ausreichend: Wir schreiben ohnehin nur an Adressen, die Firebase kennt. */
export const istMailAdresse = (wert) =>
  typeof wert === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wert) && wert.length <= 254;

export const mailSchluessel = (mail) => String(mail).trim().toLowerCase();

/* ------------------------------------------------------------- Schranke */

/**
 * Darf an diese Adresse überhaupt Post gehen?
 *
 * Für alles, was ohne Anmeldung ausgelöst wird — Anmeldelink und
 * Passwort-Zurücksetzen. Dort kommt die Adresse ungeprüft aus einem Formular;
 * ohne Schranke wäre die Schnittstelle ein offenes Tor, um von unserer Domain
 * aus beliebige Leute anschreiben zu lassen.
 *
 * Erlaubt ist, wer etwas mit dem Betreuungsbereich zu tun hat:
 *   · eingeladen unter «Steuerung → Zugänge» (Dokument in `zugang`), oder
 *   · bereits freigeschaltet (Konto in `admins`).
 *
 * Die Aufrufer antworten in beiden Fällen gleich — sonst liesse sich
 * durchprobieren, wer an der Schule Zugang hat.
 */
/**
 * Steht hinter diesem Aufruf eine angemeldete Administration?
 *
 * Nur dann darf die Antwort ehrlich sein. Für alle anderen bleibt sie neutral —
 * sonst liesse sich über die Schnittstelle durchprobieren, wer an der Schule
 * Zugang hat. Wer schon in `admins` steht, weiss das ohnehin.
 *
 * Liefert das geprüfte Konto oder `null`; ein ungültiges Token ist kein Fehler,
 * sondern schlicht «keine Administration».
 */
export async function istAdministration(idToken) {
  if (typeof idToken !== 'string' || !idToken) return null;
  const auth = adminAuth();                       // EinrichtungsFehler darf hoch
  try {
    const konto = await auth.verifyIdToken(idToken);
    const eintrag = await adminDb().collection('admins').doc(konto.uid).get();
    if (!eintrag.exists || eintrag.data()?.rolle !== 'admin') return null;
    return { uid: konto.uid, email: konto.email ?? null };
  } catch {
    return null;
  }
}

export async function darfPostBekommen(adresse) {
  const db = adminDb();

  const einladung = await db.collection('zugang').doc(adresse).get();
  if (einladung.exists) return true;

  // Kein Eintrag unter «Zugänge» — es kann trotzdem ein Konto geben, etwa der
  // Erstzugang aus den Rules oder eine zurückgezogene Einladung mit Konto.
  try {
    const benutzer = await adminAuth().getUserByEmail(adresse);
    const konto = await db.collection('admins').doc(benutzer.uid).get();
    return konto.exists;
  } catch {
    return false;                       // auth/user-not-found und alles andere
  }
}

/* ------------------------------------------------------------ Zugangscode */

/**
 * Der Zugangscode ist das Geheimnis in den beiden Links der Einladungsmail («Jetzt
 * anmelden» und «Login erstellen»). Er liegt in `zugangscodes/{mail}` — einer Sammlung,
 * für die firestore.rules keine Regel kennt und die darum aus dem Browser für niemanden
 * lesbar ist, auch nicht für die Administration. Nur die Funktionen hier kommen dran.
 *
 * Bewusst getrennt von `zugang/{mail}`: Die Einladungen liest die Administration als
 * Liste. Stünde der Code dort, könnte jede Administration mit dem Code einer anderen
 * deren Passwort setzen — und sich als sie ausgeben.
 *
 * 24 Bytes Zufall, als base64url 32 Zeichen: Raten ist aussichtslos. Der Code gilt, bis
 * die Einladung entfernt wird oder die Administration ihn erneuert — bei der Rolle
 * «admin» zusätzlich nur, bis das Passwort einmal gesetzt ist (siehe login-erstellen.mjs).
 */
export async function zugangscode(adresse, { erneuern = false } = {}) {
  const ref = adminDb().collection('zugangscodes').doc(adresse);
  if (!erneuern) {
    const alt = await ref.get();
    if (alt.exists && typeof alt.data()?.code === 'string') return alt.data().code;
  }
  const code = randomBytes(24).toString('base64url');
  await ref.set({ code, seit: new Date().toISOString() });
  return code;
}

export const zugangscodeLoeschen = (adresse) =>
  adminDb().collection('zugangscodes').doc(adresse).delete();

/** Vergleich ohne messbaren Unterschied zwischen «fast richtig» und «ganz falsch». */
export function codeStimmt(erwartet, gegeben) {
  if (typeof erwartet !== 'string' || typeof gegeben !== 'string') return false;
  const a = Buffer.from(erwartet);
  const b = Buffer.from(gegeben);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Bremse gegen das Durchprobieren von Codes — zusätzlich zur Länge des Codes, damit ein
 * Skript nicht ungestört hämmern kann. Nach fünf Fehlversuchen je Adresse ist zehn
 * Minuten Pause. Wie die Sperre oben nur im Arbeitsspeicher der warmen Instanz.
 */
const FEHLVERSUCHE_MAX = 5;
const FEHLVERSUCHE_FENSTER_MS = 10 * 60_000;
const fehlversuche = new Map();

function zuVieleFehlversuche(schluessel) {
  const jetzt = Date.now();
  const liste = (fehlversuche.get(schluessel) ?? []).filter((t) => jetzt - t < FEHLVERSUCHE_FENSTER_MS);
  fehlversuche.set(schluessel, liste);
  return liste.length >= FEHLVERSUCHE_MAX;
}

/**
 * Was beim Einlösen eines Codes schiefgehen kann — `grund` geht so an den Browser:
 *   passt-nicht    Code und Adresse gehören nicht zusammen (oder es gibt keine Einladung)
 *   gesperrt       zu viele Fehlversuche
 *   nur-betreuung  Anmeldung per Link ist der Rolle «admin» nicht erlaubt
 *   link-aus       für diesen Zugang ist die Anmeldung per Link abgeschaltet
 *   passwort-aus   für diesen Zugang ist «Login erstellen» abgeschaltet
 */
export class ZugangFehler extends Error {
  constructor(grund, nachricht) { super(nachricht); this.name = 'ZugangFehler'; this.grund = grund; }
}

/**
 * Einladung zu Adresse und Code finden — der gemeinsame Einstieg von «Jetzt anmelden»
 * und «Login erstellen». Liefert die Einladung oder wirft einen ZugangFehler.
 *
 * Die Antwort unterscheidet bewusst nicht zwischen «keine Einladung» und «falscher Code»:
 * Wer den Code nicht hat, erfährt so auch nicht, ob die Adresse eingeladen ist.
 */
export async function einladungZuCode(adresse, code) {
  const schluessel = `code:${adresse}`;
  if (zuVieleFehlversuche(schluessel)) throw new ZugangFehler('gesperrt', 'Zu viele Versuche');

  const db = adminDb();
  const [einladung, gespeichert] = await Promise.all([
    db.collection('zugang').doc(adresse).get(),
    db.collection('zugangscodes').doc(adresse).get(),
  ]);
  if (!einladung.exists || !gespeichert.exists || !codeStimmt(gespeichert.data()?.code, code)) {
    fehlversuche.set(schluessel, [...(fehlversuche.get(schluessel) ?? []), Date.now()]);
    throw new ZugangFehler('passt-nicht', 'Link und E-Mail-Adresse passen nicht zusammen');
  }
  fehlversuche.delete(schluessel);
  return einladung.data();
}

/* ------------------------------------------------------------ Freischalten */

/**
 * Konto zu einer eingeladenen Adresse holen oder anlegen — mit bestätigter Adresse.
 *
 * Der Zugangscode kam per Mail an genau diese Adresse; wer ihn hat, hat das Postfach.
 * Darum braucht es hier keine Bestätigungsmail mehr: `emailVerified` wird gesetzt, und
 * damit ist `echteMail()` in firestore.rules erfüllt. Mit `passwort` bekommt das Konto
 * zugleich ein (neues) Passwort.
 */
export async function kontoSicherstellen(adresse, { name, passwort } = {}) {
  const auth = adminAuth();
  try {
    const bestehend = await auth.getUserByEmail(adresse);
    if (bestehend.emailVerified && !passwort) return bestehend;
    return await auth.updateUser(bestehend.uid, {
      emailVerified: true,
      ...(passwort ? { password: passwort } : {}),
    });
  } catch (fehler) {
    if (fehler?.code !== 'auth/user-not-found') throw fehler;
    return auth.createUser({
      email: adresse,
      emailVerified: true,
      ...(name ? { displayName: name } : {}),
      ...(passwort ? { password: passwort } : {}),
    });
  }
}

/**
 * Freischaltung: `admins/{uid}` mit der Rolle aus der Einladung. Der Browser täte
 * dasselbe beim ersten Anmelden (zugangKlaeren in src/zugang.ts) — hier geschieht es
 * gleich mit, damit die Person nach dem Anmelden nicht erst an einer Regel scheitern
 * kann. Ein bestehendes Konto bleibt, wie es ist: Die Rolle pflegt die Administration.
 */
export async function freischalten(benutzer, einladung, adresse) {
  const ref = adminDb().collection('admins').doc(benutzer.uid);
  if ((await ref.get()).exists) return;
  await ref.set({
    rolle: einladung.rolle === 'admin' ? 'admin' : 'betreuung',
    name: einladung.name || benutzer.displayName || adresse,
    email: adresse,
    seit: new Date().toISOString(),
  });
}
