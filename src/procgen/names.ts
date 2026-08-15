import type { Rng } from '../lib/rng';

/**
 * Name generation.
 *
 * Names are syllable chains from a fixed table rather than a word list, because a list
 * long enough to stop repeating across an infinite galaxy would itself be an asset. The
 * canonical form is Latin; `transliterate` maps it to Cyrillic for the Russian locale, so
 * one star keeps one identity and only its spelling changes with the interface language.
 */

const ONSETS = [
  'b', 'br', 'c', 'ch', 'd', 'dr', 'f', 'g', 'gr', 'h', 'j', 'k', 'kr', 'l', 'm', 'n',
  'p', 'pr', 'q', 'r', 's', 'sh', 'sk', 'sl', 'st', 't', 'th', 'tr', 'v', 'y', 'z', 'zh',
];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ae', 'ai', 'ao', 'ea', 'ei', 'ia', 'io', 'oa', 'ou', 'ua'];
const CODAS = ['', '', '', 'n', 'r', 's', 'l', 'th', 'nd', 'rn', 'sk', 'x', 'm', 'k'];

/** Roman-numeral-ish suffixes used for multiple bodies sharing a primary name. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function syllable(rng: Rng, allowEmptyOnset: boolean): string {
  const onset = allowEmptyOnset && rng.bool(0.22) ? '' : rng.pick(ONSETS);
  return onset + rng.pick(NUCLEI) + rng.pick(CODAS);
}

/** A star or system name: one to three syllables, capitalised. */
export function starName(rng: Rng): string {
  const count = rng.pickWeighted([1, 2, 3], [0.18, 0.62, 0.20]);
  let out = '';
  for (let i = 0; i < count; i++) out += syllable(rng, i === 0);
  // A catalogue tag on a minority of systems: it reads as a frontier that was surveyed
  // but never settled, and it breaks the monotony of pure syllable names.
  if (rng.bool(0.12)) out += '-' + rng.int(2, 99);
  return capitalise(out);
}

/** Planet name: the primary's name plus a numeral, as real catalogues do. */
export function bodyName(primary: string, index: number): string {
  return `${primary} ${ROMAN[index] ?? String(index + 1)}`;
}

export function moonName(primary: string, index: number): string {
  return `${primary} ${String.fromCharCode(97 + index)}`;
}

export function settlementName(rng: Rng): string {
  const count = rng.pickWeighted([1, 2], [0.45, 0.55]);
  let out = '';
  for (let i = 0; i < count; i++) out += syllable(rng, i === 0);
  return capitalise(out);
}

export function personName(rng: Rng): string {
  return `${capitalise(syllable(rng, true))} ${capitalise(syllable(rng, false) + rng.pick(CODAS))}`;
}

export function shipName(rng: Rng): string {
  return capitalise(syllable(rng, true) + syllable(rng, false));
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Latin to Cyrillic. Digraphs first — order matters, and the table is deliberately a
 * sorted array of pairs rather than an object so iteration order is explicit.
 */
const TRANSLIT: readonly (readonly [string, string])[] = [
  ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['th', 'т'], ['ae', 'э'], ['ai', 'ай'],
  ['ao', 'ао'], ['ea', 'еа'], ['ei', 'ей'], ['ia', 'ия'], ['io', 'ио'], ['oa', 'оа'],
  ['ou', 'у'], ['ua', 'уа'], ['kr', 'кр'], ['br', 'бр'], ['dr', 'др'], ['gr', 'гр'],
  ['pr', 'пр'], ['sk', 'ск'], ['sl', 'сл'], ['st', 'ст'], ['tr', 'тр'], ['nd', 'нд'],
  ['rn', 'рн'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'],
  ['h', 'х'], ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'],
  ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'],
  ['v', 'в'], ['x', 'кс'], ['y', 'ы'], ['z', 'з'],
];

export function transliterate(name: string): string {
  let out = '';
  let i = 0;
  const lower = name.toLowerCase();
  while (i < lower.length) {
    const ch = lower[i];
    if (ch === ' ' || ch === '-' || (ch >= '0' && ch <= '9')) {
      out += name[i];
      i++;
      continue;
    }
    let matched = false;
    for (const [from, to] of TRANSLIT) {
      if (lower.startsWith(from, i)) {
        out += to;
        i += from.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += name[i];
      i++;
    }
  }
  // Roman numerals and letter suffixes survive as written; capitalise the first letter.
  return out.charAt(0).toUpperCase() + out.slice(1);
}
