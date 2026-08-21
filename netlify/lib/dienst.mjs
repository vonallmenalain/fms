/* =========================================================================
   Gemeinsamer Unterbau der Netlify-Funktionen
   -------------------------------------------------------------------------
   Firebase-Admin-SDK, einheitliche Antworten und eine kleine Sperre gegen
   allzu schnelles Nachfassen. Beides brauchen die Bestätigungsmail und der
   Anmeldelink — und beide sollen sich gleich verhalten.
   ========================================================================= */

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
