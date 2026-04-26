import { useMemo } from "react";
import { useLocaleStore } from "../stores/localeStore";
import { en } from "./en";
import { zh } from "./zh";

const dictionaries = { en, zh } as const;
type Locale = keyof typeof dictionaries;
type Dict = typeof en;

// Cache the merged dictionary per locale so `useT()` returns a stable
// reference across renders. Without this, every consumer that puts `t`
// in a useEffect / useCallback / useMemo dep array re-runs on every
// parent render — most visibly in useKeyboardShortcuts, which
// otherwise tears down and re-attaches three capture-phase window
// listeners on every viewport tick.
const mergedCache = new Map<Locale, Dict>();
function getMerged(locale: Locale): Dict {
  const cached = mergedCache.get(locale);
  if (cached) return cached;
  const merged = { ...en, ...dictionaries[locale] } as Dict;
  mergedCache.set(locale, merged);
  return merged;
}

export function useT(): Dict {
  const locale = useLocaleStore((s) => s.locale);
  return useMemo(() => getMerged(locale), [locale]);
}
