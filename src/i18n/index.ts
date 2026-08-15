import i18next from 'i18next';
import { ru } from './ru';
import { pluralRu, caseOf, type GrammaticalCase } from './ru_nouns';

/**
 * Localisation.
 *
 * i18next does the lookup and interpolation; Russian morphology is our own layer on top,
 * because case agreement ("три тонны сплавов", "лечу к станции Кассандра") is not
 * something a key-value translation table can express. Plural forms go through
 * `Intl.PluralRules` rather than a hand-rolled modulo chain.
 */

let ready = false;

export function initI18n(language = 'ru'): void {
  if (ready) return;
  void i18next.init({
    lng: language,
    fallbackLng: 'ru',
    resources: { ru: { translation: ru } },
    interpolation: { escapeValue: false },
    // Keys are dotted paths into a nested object; the default separator is what the
    // locale file is written for.
    keySeparator: '.',
    nsSeparator: false,
  });
  ready = true;
}

/** Translate. Returns the key itself when missing, which makes a gap obvious on screen. */
export function t(key: string, params?: Record<string, string | number>): string {
  if (!ready) initI18n();
  return i18next.t(key, params as never) as unknown as string;
}

/** Plural form for a count: "1 тонна", "3 тонны", "12 тонн". */
export function plural(count: number, key: string): string {
  return pluralRu(count, key);
}

/** Decline a noun. Used for names in sentences: "курс на Кассандру". */
export function declineNoun(noun: string, grammaticalCase: GrammaticalCase): string {
  return caseOf(noun, grammaticalCase);
}

export type { GrammaticalCase };
