/**
 * Merker für die Anmeldung, die auf DIESEM Gerät als Gast entstanden ist.
 *
 * Hintergrund: Eine Betreuungsperson meldet sich morgens selbst an — anonym, wie jeder
 * Gast. Später meldet sie sich unter /admin mit ihrer Adresse an. Firebase ersetzt dabei
 * die anonyme Sitzung; die Anmeldung liegt danach unter einer uid, die niemand mehr
 * besitzt. Sie ist eine Schattenbuchung: sichtbar, Plätze belegend, nicht mehr änderbar.
 *
 * Damit das nicht passiert, merkt sich das Gerät seine anonyme uid hier. Kommt die Person
 * später als angemeldete Betreuung auf die Hauptseite zurück, holt `uebernimmGeraet` die
 * Anmeldung in ihr Konto (siehe src/buchung.ts).
 *
 * Bewusst localStorage und nicht die Datenbank: Es ist eine Angabe über dieses eine
 * Gerät, sie geht niemanden sonst etwas an, und sie überlebt das Neuladen — genau wie
 * die Firebase-Sitzung, die daneben liegt.
 */
const SCHLUESSEL = 'fms.geraet';

/** Sicher gegen Browser, die den Speicher sperren (Privatmodus, iOS-Einstellung). */
function speicher(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function merkeGeraet(uid: string): void {
  try { speicher()?.setItem(SCHLUESSEL, uid); } catch { /* egal, dann eben nicht */ }
}

export function gemerktesGeraet(): string | null {
  try { return speicher()?.getItem(SCHLUESSEL) ?? null; } catch { return null; }
}

export function vergissGeraet(): void {
  try { speicher()?.removeItem(SCHLUESSEL); } catch { /* egal */ }
}
