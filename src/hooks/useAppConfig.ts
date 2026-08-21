import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { programm } from '../programm';
import { protokollSchalter } from '../protokoll';

export interface AppConfig {
  anmeldungOffen: boolean;
  maxPlaetzeProGeraet: number;
  liveZaehler: boolean;
  protokoll: boolean;
  banner: string;
  programmVersion: string;
}

const STANDARD: AppConfig = {
  anmeldungOffen: false,
  maxPlaetzeProGeraet: programm.regeln.maxPlaetzeProGeraet,
  liveZaehler: true,
  protokoll: true,
  banner: '',
  programmVersion: programm.version,
};

/** Laufzeitsteuerung: Freigabeschalter, Banner, Reserveschalter. Ein Dokument, ein Listener. */
export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(STANDARD);
  const [geladen, setGeladen] = useState(false);

  useEffect(() => onSnapshot(
    doc(db, 'config', 'app'),
    (s) => { if (s.exists()) setConfig({ ...STANDARD, ...(s.data() as Partial<AppConfig>) }); setGeladen(true); },
    () => setGeladen(true),
  ), []);

  // Der Buchungskode kennt React nicht und kann den Schalter nicht selbst abfragen.
  // Hier hört ohnehin schon ein Listener auf `config/app` zu — ein zweiter nur fürs
  // Protokoll wäre auf 200 Geräten 200 überflüssige Verbindungen.
  useEffect(() => { protokollSchalter(config.protokoll); }, [config.protokoll]);

  /** Läuft dieses Gerät noch auf dem Programmstand des Servers? */
  const veraltet = geladen && config.programmVersion !== programm.version;

  return { config, geladen, veraltet };
}
