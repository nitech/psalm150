/**
 * Which language the web client speaks: the one chosen under Settings,
 * Appearance (`localStorage["psa150-language"]`), else the first of the
 * device's languages that there is a catalog for, else English. Catalogs
 * are `i18n/{code}.json`, each loaded only when it is used.
 */
import { setLanguage, type Catalog } from "../../shared/songs/i18n.ts";
import { readPreference } from "./ui.ts";

/** The languages there are, by their own names. */
export const LANGUAGES: Array<{ code: string; name: string }> = [
  { code: "en", name: "English" },
  { code: "nb", name: "Norsk bokmål" },
  { code: "nn", name: "Norsk nynorsk" },
  { code: "sv", name: "Svenska" },
  { code: "da", name: "Dansk" },
  { code: "fi", name: "Suomi" },
  { code: "is", name: "Íslenska" },
  { code: "de", name: "Deutsch" },
  { code: "nl", name: "Nederlands" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "pl", name: "Polski" },
];

const catalogs = import.meta.glob<Catalog>("./i18n/*.json", { import: "default" });

/** The device's own choice among the languages there are. */
export function deviceLanguage(): string {
  const codes = new Set(LANGUAGES.map((language) => language.code));
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    // Norwegian without a written form named is Bokmål.
    const code = base === "no" ? "nb" : base;
    if (codes.has(code)) return code;
  }
  return "en";
}

/** The chosen language, or the device's. */
export function chosenLanguage(): string {
  const chosen = readPreference("language");
  return chosen && LANGUAGES.some((language) => language.code === chosen) ? chosen : deviceLanguage();
}

/** Loads the catalog of the chosen language; before the first screen is drawn. */
export async function loadLanguage(): Promise<void> {
  const code = chosenLanguage();
  const load = catalogs[`./i18n/${code}.json`];
  const messages = code === "en" || !load ? {} : await load().catch(() => ({}));
  setLanguage(code, messages);
}
