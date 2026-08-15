/**
 * Russian morphology.
 *
 * Two jobs a translation table cannot do:
 *
 * 1. **Plural agreement.** "1 тонна / 3 тонны / 12 тонн" is a three-form system driven by
 *    the last one and two digits. `Intl.PluralRules` already knows the rule, so the code
 *    here only maps its categories onto the three written forms — a hand-rolled modulo
 *    chain is the classic place where 111 comes out as "111 тонна".
 *
 * 2. **Case.** Generated proper nouns appear inside sentences ("курс на Кассандру",
 *    "прибытие на Кассандру"), and leaving them in the nominative reads as machine
 *    output. Declension is by ending, which covers generated names because the generator
 *    only ever produces endings this table knows.
 */

export type GrammaticalCase = 'nom' | 'gen' | 'dat' | 'acc' | 'ins' | 'pre';

const PLURAL_RULES = new Intl.PluralRules('ru-RU');

/** one / few / many forms, in that order. */
export const PLURAL_FORMS: Record<string, readonly [string, string, string]> = {
  tonne: ['тонна', 'тонны', 'тонн'],
  credit: ['кредит', 'кредита', 'кредитов'],
  jump: ['прыжок', 'прыжка', 'прыжков'],
  day: ['день', 'дня', 'дней'],
  system: ['система', 'системы', 'систем'],
  ship: ['корабль', 'корабля', 'кораблей'],
  person: ['человек', 'человека', 'человек'],
  building: ['строение', 'строения', 'строений'],
  contract: ['контракт', 'контракта', 'контрактов'],
  lightyear: ['световой год', 'световых года', 'световых лет'],
};

export function pluralRu(count: number, key: string): string {
  const forms = PLURAL_FORMS[key];
  if (!forms) return `${count} ${key}`;
  const category = PLURAL_RULES.select(Math.abs(Math.round(count)));
  const form = category === 'one' ? forms[0] : category === 'few' ? forms[1] : forms[2];
  return `${count} ${form}`;
}

/**
 * Decline a noun by its ending.
 *
 * Ordered longest-ending-first: "ия" must be tried before "я", or "Кассия" declines as if
 * it ended in a bare "я" and comes out "Кассию" instead of "Кассию"/"Кассии" correctly.
 */
const ENDINGS: readonly (readonly [string, Record<GrammaticalCase, string>])[] = [
  ['ия', { nom: 'ия', gen: 'ии', dat: 'ии', acc: 'ию', ins: 'ией', pre: 'ии' }],
  ['ья', { nom: 'ья', gen: 'ьи', dat: 'ье', acc: 'ью', ins: 'ьёй', pre: 'ье' }],
  ['ка', { nom: 'ка', gen: 'ки', dat: 'ке', acc: 'ку', ins: 'кой', pre: 'ке' }],
  ['га', { nom: 'га', gen: 'ги', dat: 'ге', acc: 'гу', ins: 'гой', pre: 'ге' }],
  ['ха', { nom: 'ха', gen: 'хи', dat: 'хе', acc: 'ху', ins: 'хой', pre: 'хе' }],
  ['ша', { nom: 'ша', gen: 'ши', dat: 'ше', acc: 'шу', ins: 'шей', pre: 'ше' }],
  ['ча', { nom: 'ча', gen: 'чи', dat: 'че', acc: 'чу', ins: 'чей', pre: 'че' }],
  ['жа', { nom: 'жа', gen: 'жи', dat: 'же', acc: 'жу', ins: 'жей', pre: 'же' }],
  ['а', { nom: 'а', gen: 'ы', dat: 'е', acc: 'у', ins: 'ой', pre: 'е' }],
  ['ь', { nom: 'ь', gen: 'я', dat: 'ю', acc: 'ь', ins: 'ем', pre: 'е' }],
  ['й', { nom: 'й', gen: 'я', dat: 'ю', acc: 'й', ins: 'ем', pre: 'е' }],
  ['о', { nom: 'о', gen: 'а', dat: 'у', acc: 'о', ins: 'ом', pre: 'е' }],
  ['е', { nom: 'е', gen: 'я', dat: 'ю', acc: 'е', ins: 'ем', pre: 'е' }],
];

/** Consonant-ending masculine nouns take these suffixes directly. */
const CONSONANT: Record<GrammaticalCase, string> = {
  nom: '', gen: 'а', dat: 'у', acc: '', ins: 'ом', pre: 'е',
};

const VOWELS = 'аеёиоуыэюя';

export function caseOf(noun: string, grammaticalCase: GrammaticalCase): string {
  if (grammaticalCase === 'nom' || noun.length === 0) return noun;
  const lower = noun.toLowerCase();

  for (const [ending, table] of ENDINGS) {
    if (lower.endsWith(ending)) {
      return noun.slice(0, noun.length - ending.length) + table[grammaticalCase];
    }
  }

  const last = lower[lower.length - 1];
  // Indeclinable: a name ending in a vowel we have no rule for (у, ю, э, и) stays put,
  // exactly as loanwords like "Осло" do. Bending it would produce nonsense.
  if (VOWELS.includes(last)) return noun;

  return noun + CONSONANT[grammaticalCase];
}

/** Convenience: "на Кассандру", "к станции", "из системы". */
export function withPreposition(preposition: string, noun: string, grammaticalCase: GrammaticalCase): string {
  return `${preposition} ${caseOf(noun, grammaticalCase)}`;
}
