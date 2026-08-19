import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { programm } from '../programm';

export interface AppConfig {
  anmeldungOffen: boolean;
  maxPlaetzeProGeraet: number;
  liveZaehler: boolean;
  banner: string;
  programmVersion: string;
}

const STANDARD: AppConfig = {
  anmeldungOffen: false,
  maxPlaetzeProGeraet: programm.regeln.maxPlaetzeProGeraet,
  liveZaehler: true,
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

  /** Läuft dieses Gerät noch auf dem Programmstand des Servers? */
  const veraltet = geladen && config.programmVersion !== programm.version;

  return { config, geladen, veraltet };
}
