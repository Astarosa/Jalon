import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dataVersion, subscribe } from "./db";

/**
 * Charge une donnée et la recharge automatiquement après chaque écriture.
 * Retourne `undefined` pendant le premier chargement.
 */
export function useData<T>(load: () => Promise<T>, deps: unknown[]): T | undefined {
  const v = useSyncExternalStore(subscribe, dataVersion);
  const [state, setState] = useState<T | undefined>(undefined);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    load()
      .then((r) => {
        if (n === seq.current) setState(r);
      })
      .catch((e) => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ...deps]);
  return state;
}
