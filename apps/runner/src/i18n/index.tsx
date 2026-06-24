import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import bg from "./bg.json";
import en from "./en.json";
import uk from "./uk.json";
import tr from "./tr.json";
import ro from "./ro.json";
import el from "./el.json";
import de from "./de.json";
import it from "./it.json";
import ru from "./ru.json";
import sr from "./sr.json";

export type Lang = "bg" | "en" | "uk" | "tr" | "ro" | "el" | "de" | "it" | "ru" | "sr";
type Dict = Record<string, string>;
const DICTS: Record<Lang, Dict> = { bg, en, uk, tr, ro, el, de, it, ru, sr };

/** Languages shown in the picker. All ship with a full dictionary.
 *  Ordered by how likely a speaker of each language is to be in Bulgaria for a
 *  running event: the two primary languages first (bg, then en as lingua
 *  franca), then large in-country / neighbouring / tourist communities — the
 *  Turkish-speaking minority & Turkish visitors, Ukrainian-speaking residents,
 *  neighbours (Romania, Greece), then German & Italian visitors. Russian is
 *  kept last by request. */
export const LANGUAGES: { code: Lang | string; flag: string; label: string; ready: boolean }[] = [
  { code: "bg", flag: "🇧🇬", label: "Български", ready: true },
  { code: "en", flag: "🇬🇧", label: "English", ready: true },
  { code: "uk", flag: "🇺🇦", label: "Українська", ready: true },
  { code: "tr", flag: "🇹🇷", label: "Türkçe", ready: true },
  { code: "ro", flag: "🇷🇴", label: "Română", ready: true },
  { code: "sr", flag: "🇷🇸", label: "Srpski", ready: true },
  { code: "el", flag: "🇬🇷", label: "Ελληνικά", ready: true },
  { code: "de", flag: "🇩🇪", label: "Deutsch", ready: true },
  { code: "it", flag: "🇮🇹", label: "Italiano", ready: true },
  { code: "ru", flag: "🇷🇺", label: "Русский", ready: true },
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
    return stored && stored in DICTS ? stored : "bg"; // BG default
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
