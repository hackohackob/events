import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import bg from "./bg.json";
import en from "./en.json";

export type Lang = "bg" | "en";
type Dict = Record<string, string>;
const DICTS: Record<Lang, Dict> = { bg, en };

/** Languages shown in the picker. bg/en ship now; the rest are roadmap
 *  (structure supports them — see i18n README) and render disabled. */
export const LANGUAGES: { code: Lang | string; flag: string; label: string; ready: boolean }[] = [
  { code: "bg", flag: "🇧🇬", label: "Български", ready: true },
  { code: "en", flag: "🇬🇧", label: "English", ready: true },
  { code: "uk", flag: "🇺🇦", label: "Українська", ready: false },
  { code: "it", flag: "🇮🇹", label: "Italiano", ready: false },
  { code: "de", flag: "🇩🇪", label: "Deutsch", ready: false },
  { code: "ro", flag: "🇷🇴", label: "Română", ready: false },
];

const STORAGE_KEY = "pe_lang";

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    return stored === "en" || stored === "bg" ? stored : "bg"; // BG default
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let str = DICTS[lang][key] ?? DICTS.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}
