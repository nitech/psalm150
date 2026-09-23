/**
 * Configurable keyboard shortcuts. A combo is written as modifiers in a fixed
 * order plus one key, for example `Alt+S`, `Ctrl+F`, `B`, `ArrowRight`.
 * Letters are upper case; other keys use `KeyboardEvent.key` names.
 */

export type ShortcutAction =
  | "add_to_setlist"
  | "toggle_favorite"
  | "blank"
  | "next_slide"
  | "previous_slide"
  | "focus_search";

export type ShortcutMap = Record<ShortcutAction, string>;

export const SHORTCUT_ACTIONS: ReadonlyArray<{ id: ShortcutAction; label: string }> = [
  { id: "add_to_setlist", label: "Add the selected song to the setlist" },
  { id: "toggle_favorite", label: "Favourite / unfavourite the selected song" },
  { id: "focus_search", label: "Search" },
  { id: "blank", label: "Blank the screen" },
  { id: "next_slide", label: "Next slide" },
  { id: "previous_slide", label: "Previous slide" },
];

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  add_to_setlist: "Alt+S",
  toggle_favorite: "Alt+F",
  focus_search: "Ctrl+F",
  blank: "B",
  next_slide: "ArrowRight",
  previous_slide: "ArrowLeft",
};

/** Keys with a fixed meaning (lists, stanzas, projecting, closing). */
const RESERVED = new Set([
  "Enter",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "Tab",
  ..."0123456789".split(""),
]);

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]);

/**
 * Key name from a keydown. With Alt (or Ctrl) held, `event.key` can be a
 * different character on some layouts, so letters and digits come from
 * `event.code` instead.
 */
function keyName(event: Pick<KeyboardEvent, "key" | "code">): string {
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1];
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
  if (digit) return digit[1];
  if (event.key === " ") return "Space";
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

/** The combo a keydown represents, or null for a lone modifier press. */
export function comboFromEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(keyName(event));
  return parts.join("+");
}

/** Canonical form of a stored combo; accepts the older `KeyB` spelling. */
export function normalizeCombo(value: string | null | undefined): string {
  if (!value) return "";
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((part) => part.toLowerCase()));
  const out: string[] = [];
  if (mods.has("ctrl") || mods.has("control")) out.push("Ctrl");
  if (mods.has("alt")) out.push("Alt");
  if (mods.has("shift")) out.push("Shift");
  if (mods.has("meta") || mods.has("cmd")) out.push("Meta");
  const code = /^Key([A-Za-z])$/.exec(key);
  out.push(code ? code[1].toUpperCase() : key.length === 1 ? key.toUpperCase() : key);
  return out.join("+");
}

/** Fill gaps from the defaults and normalise every combo. */
export function resolveShortcuts(stored: Partial<Record<string, string>> | null | undefined): ShortcutMap {
  const result = { ...DEFAULT_SHORTCUTS };
  for (const { id } of SHORTCUT_ACTIONS) {
    const value = stored?.[id];
    if (typeof value === "string") result[id] = normalizeCombo(value);
  }
  return result;
}

export function actionForCombo(shortcuts: ShortcutMap, combo: string): ShortcutAction | null {
  for (const { id } of SHORTCUT_ACTIONS) {
    if (shortcuts[id] && shortcuts[id] === combo) return id;
  }
  return null;
}

/** True when the combo has Ctrl, Alt or Meta, so it can fire inside text fields. */
export function hasCommandModifier(combo: string): boolean {
  return /(^|\+)(Ctrl|Alt|Meta)\+/.test(combo);
}

/** Why a combo cannot be assigned to `action`, or null when it can. */
export function shortcutProblem(
  shortcuts: ShortcutMap,
  action: ShortcutAction,
  combo: string,
): string | null {
  const key = combo.split("+").pop() ?? "";
  if (combo === key && RESERVED.has(key)) {
    return `${formatCombo(combo)} is already used for lists, stanzas or closing`;
  }
  if (/^Shift\+/.test(combo) && combo.split("+").length === 2 && key.length === 1) {
    return "Shift with a single character types text; add Ctrl or Alt";
  }
  const other = actionForCombo(shortcuts, combo);
  if (other && other !== action) {
    const label = SHORTCUT_ACTIONS.find((entry) => entry.id === other)?.label ?? other;
    return `${formatCombo(combo)} is already used for “${label}”`;
  }
  return null;
}

const KEY_LABELS: Record<string, string> = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Space: "Space",
};

/** Keys as shown on the keyboard, e.g. `Alt + S`, `→`. */
export function formatCombo(combo: string): string {
  if (!combo) return "Not set";
  return combo
    .split("+")
    .map((part) => KEY_LABELS[part] ?? part)
    .join(" + ");
}
