/**
 * The words on screen in the reader's language. The English text is the key
 * (`t("Search songs")`), so code reads as it shows and a missing translation
 * falls back to English. Values go in by name: `t("Add {title} to {set}",
 * { title, set })`; a value is put in as given, so escape it first where it
 * goes into HTML. Counted words use `tn(count, "{n} song", "{n} songs")`,
 * keyed by the English plural; a catalog gives each plural form of its
 * language (`{ "one": "{n} sang", "other": "{n} sanger" }`).
 *
 * Each app loads a catalog for the language it chose (`setLanguage`);
 * without one, everything is English.
 *
 * Canonical copy: PSA150-server/shared/songs/. The desktop repo mirrors this
 * folder at src/shared/songs/ with `bun run sync:shared`; edit it here, never
 * in the mirror.
 */

export type Message = string | Partial<Record<Intl.LDMLPluralRule, string>>;
export type Catalog = Record<string, Message>;
export type Values = Record<string, string | number>;

let current = "en";
let catalog: Catalog = {};
let plurals = new Intl.PluralRules("en");

/** Use `language` (a BCP 47 tag such as `nb` or `de`) with its catalog. */
export function setLanguage(language: string, messages: Catalog): void {
  current = language;
  catalog = messages;
  plurals = new Intl.PluralRules(language);
  if (typeof document !== "undefined") document.documentElement.lang = language;
}

/** The language in use, also for dates and numbers (`toLocaleString(locale())`). */
export function locale(): string {
  return current;
}

/** `text` in the reader's language, with `{name}` replaced by `values.name`. */
export function t(text: string, values?: Values): string {
  const message = catalog[text];
  const translated = typeof message === "string" && message ? message : text;
  return values ? fill(translated, values) : translated;
}

/**
 * The form of a counted phrase that fits `count`, with `{n}` the count
 * written the reader's way. `one` and `other` are the English forms.
 */
export function tn(count: number, one: string, other: string, values?: Values): string {
  const message = catalog[other];
  const all = { n: count.toLocaleString(current), ...values };
  if (message && typeof message === "object") {
    const form = message[plurals.select(count)] ?? message.other;
    if (form) return fill(form, all);
  }
  if (typeof message === "string" && message) return fill(message, all);
  return fill(count === 1 ? one : other, all);
}

function fill(text: string, values: Values): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
