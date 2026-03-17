import { useLocaleStore } from "../stores/localeStore";
import { en } from "./en";
import { zh } from "./zh";

const dictionaries = { en, zh } as const;

export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return { ...en, ...dictionaries[locale] };
}
