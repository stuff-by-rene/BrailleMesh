/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Braille text → displacement map generator (Braille mode).
//
// Translates black-print input ("Schwarzschrift") into Braille cell patterns
// and rasterises them into a greyscale height map with physically exact
// millimetre dimensions (Marburg Medium defaults — "Exportierte Parameter.csv").
// Two relief modes:
//   raised   — dots stand proud of the surface (classic embossed Braille)
//   recessed — ONE straight rectangular pocket frame around the whole block;
//              with the default recess depth = dot height the dot tops end up
//              flush with the original surface, so the Braille is "let into"
//              the mesh.
// An optional engraved/embossed black-print caption can be drawn under each
// Braille row so sighted readers can tell what is written there.
//
// Height-map encoding (consumed by BumpMesh's symmetric displacement):
//   grey = 0.5 + depthMm / (2 * amplitude)   with amplitude = max |depth|
//   0.5 grey = untouched surface, brighter = raised, darker = recessed.
//
// Language tables are dot-verified against UEB (ICEB), French braille
// (braillito/ATAF), the French-Wikipedia comparison table for ES/IT/PT and the
// German Kurzschrift lists (rw-blindenschrift.de, SBZ). Kurzschrift / Grade 2
// are SIMPLIFIED sets (common word signs + groupsigns with basic position
// rules), not complete official rulebooks.

// ── Translation tables ───────────────────────────────────────────────────────
// Dot numbers 1-8: 1-2-3 down the left column, 4-5-6 down the right, 7-8 the
// two extra dots of eight-dot computer Braille below them.

// German "Vollschrift" (the standard for German signage per DIN 32976 /
// Marburg rules): letters, umlauts, ß, the fixed letter groups (au eu ei äu
// ie ch sch st), digits via the number sign, punctuation.
const DE_VOLLSCHRIFT = {
  letters: {
    'a': [1], 'b': [1, 2], 'c': [1, 4], 'd': [1, 4, 5], 'e': [1, 5],
    'f': [1, 2, 4], 'g': [1, 2, 4, 5], 'h': [1, 2, 5], 'i': [2, 4], 'j': [2, 4, 5],
    'k': [1, 3], 'l': [1, 2, 3], 'm': [1, 3, 4], 'n': [1, 3, 4, 5], 'o': [1, 3, 5],
    'p': [1, 2, 3, 4], 'q': [1, 2, 3, 4, 5], 'r': [1, 2, 3, 5], 's': [2, 3, 4], 't': [2, 3, 4, 5],
    'u': [1, 3, 6], 'v': [1, 2, 3, 6], 'w': [2, 4, 5, 6], 'x': [1, 3, 4, 6],
    'y': [1, 3, 4, 5, 6], 'z': [1, 3, 5, 6],
    'ä': [3, 4, 5], 'ö': [2, 4, 6], 'ü': [1, 2, 5, 6], 'ß': [2, 3, 4, 6],
  },
  // Multi-character groups rendered as one cell (longest match wins).
  groups: {
    'sch': [1, 5, 6], 'ch': [1, 4, 5, 6], 'au': [1, 6], 'eu': [1, 2, 6],
    'ei': [1, 4, 6], 'äu': [3, 4], 'ie': [3, 4, 6], 'st': [2, 3, 4, 5, 6],
  },
  words: {},
  punctuation: {
    '.': [3], ',': [2], ':': [2, 5], ';': [2, 3], '?': [2, 6], '!': [2, 3, 5],
    '-': [3, 6], "'": [6], '"': [6, 6], '(': [2, 3, 5, 6], ')': [2, 3, 5, 6],
    '=': [2, 3, 5, 6], '/': [2, 5, 6], '+': [2, 3, 5], '*': [3, 4],
    '«': [3, 4, 6], '»': [2, 3, 6], '&': [1, 2, 3, 4, 6], '%': [1, 2, 3, 4, 5, 6],
  },
  numberSign: [3, 4, 5, 6],
};

// German Kurzschrift (simplified): Vollschrift base + the common Kürzel
// (standalone word signs) and Lautgruppenkürzungen with their basic position
// rules (s = word start, m = middle, e = word end allowed).
const DE_KURZ_GROUPS = {
  'ach': { dots: [5, 6],          pos: 'me' },
  'al':  { dots: [2, 5],          pos: 'sm' },
  'an':  { dots: [2, 3, 5],       pos: 'sm' },
  'ar':  { dots: [3, 5, 6],       pos: 'sm' },
  'au':  { dots: [1, 6],          pos: 'sme' },
  'äu':  { dots: [3, 4],          pos: 'sme' },
  'be':  { dots: [2, 3],          pos: 'sm' },
  'ch':  { dots: [1, 4, 5, 6],    pos: 'sme' },
  'ck':  { dots: [4, 6],          pos: 'me' },
  'eh':  { dots: [1, 2, 5, 6],    pos: 'm' },
  'ei':  { dots: [1, 4, 6],       pos: 'sme' },
  'ein': { dots: [1, 2, 4, 6],    pos: 'sme' },
  'el':  { dots: [1, 3, 4, 5, 6], pos: 'sme' },
  'em':  { dots: [1, 2, 3, 5, 6], pos: 'sme' },
  'en':  { dots: [1, 4],          pos: 'me' },
  'er':  { dots: [1, 2, 4, 5, 6], pos: 'sme' },
  'es':  { dots: [1, 2, 3, 4, 5, 6], pos: 'sme' },
  'eu':  { dots: [1, 2, 6],       pos: 'sme' },
  'ge':  { dots: [1, 2, 3, 4, 6], pos: 'sme' },
  'ich': { dots: [3, 4, 5, 6],    pos: 'me' },
  'ie':  { dots: [3, 4, 6],       pos: 'me' },
  'ig':  { dots: [4, 5],          pos: 'me' },
  'in':  { dots: [3, 5],          pos: 'sm' },
  'lich': { dots: [4, 5, 6],      pos: 'me' },
  'll':  { dots: [1, 2, 3, 4, 5], pos: 'me' },
  'mm':  { dots: [1, 3, 4, 6],    pos: 'me' },
  'or':  { dots: [2, 6],          pos: 'sm' },
  'sch': { dots: [1, 5, 6],       pos: 'sme' },
  'ss':  { dots: [2, 3, 4, 6],    pos: 'me' },
  'st':  { dots: [2, 3, 4, 5, 6], pos: 'sme' },
  'te':  { dots: [2, 3, 6],       pos: 'sm' },
  'un':  { dots: [2, 5, 6],       pos: 'sm' },
};

// Standalone word signs (Kürzel), verified against rw-blindenschrift.de
// Anhang B and the SBZ Kurzschrift table.
const DE_KURZ_WORDS = {
  'aber': [1], 'bei': [1, 2], 'sich': [1, 4], 'das': [1, 4, 5], 'den': [1, 5],
  'für': [1, 2, 4], 'gegen': [1, 2, 4, 5], 'ihr': [2, 4], 'jetzt': [2, 4, 5],
  'kann': [1, 3], 'was': [2, 4, 5, 6], 'immer': [1, 3, 4, 6], 'zu': [1, 3, 5, 6],
  'auch': [3, 4], 'sein': [2, 4, 6], 'über': [1, 2, 5, 6], 'auf': [1, 6],
  'als': [1, 4, 6], 'wie': [1, 2, 6], 'die': [3, 4, 6], 'dass': [2, 3, 4, 6],
  'ist': [2, 3, 4, 5, 6], 'durch': [1, 4, 5, 6], 'schon': [1, 5, 6],
  'ein': [1, 2, 4, 6], 'er': [1, 2, 4, 5, 6], 'es': [1, 2, 3, 4, 5, 6],
  'ich': [3, 4, 5, 6], 'und': [1, 2, 3, 4, 6],
};

const DE_KURZSCHRIFT = {
  ...DE_VOLLSCHRIFT,
  groups: DE_KURZ_GROUPS,
  words: DE_KURZ_WORDS,
};

// English — Unified English Braille (UEB) Grade 1 (uncontracted).
const EN_UEB = {
  letters: {
    'a': [1], 'b': [1, 2], 'c': [1, 4], 'd': [1, 4, 5], 'e': [1, 5],
    'f': [1, 2, 4], 'g': [1, 2, 4, 5], 'h': [1, 2, 5], 'i': [2, 4], 'j': [2, 4, 5],
    'k': [1, 3], 'l': [1, 2, 3], 'm': [1, 3, 4], 'n': [1, 3, 4, 5], 'o': [1, 3, 5],
    'p': [1, 2, 3, 4], 'q': [1, 2, 3, 4, 5], 'r': [1, 2, 3, 5], 's': [2, 3, 4], 't': [2, 3, 4, 5],
    'u': [1, 3, 6], 'v': [1, 2, 3, 6], 'w': [2, 4, 5, 6], 'x': [1, 3, 4, 6],
    'y': [1, 3, 4, 5, 6], 'z': [1, 3, 5, 6],
  },
  groups: {},
  words: {},
  punctuation: {
    '.': [2, 5, 6], ',': [2], ':': [2, 5], ';': [2, 3], '?': [2, 3, 6], '!': [2, 3, 5],
    '-': [3, 6], "'": [3], '"': [2, 3, 6],
    '(': [5, 1, 2, 6], ')': [5, 3, 4, 5], '/': [4, 5, 6, 3, 4],
    '+': [5, 2, 3, 5], '=': [5, 2, 3, 5, 6], '*': [5, 3, 5],
    '&': [4, 1, 2, 3, 4, 6], '%': [4, 6, 3, 5, 6], '@': [4, 1],
  },
  numberSign: [3, 4, 5, 6],
};

// English UEB Grade 2 (simplified): the strong contractions (word + groupsign),
// strong groupsigns, alphabetic/lower wordsigns and lower groupsigns with basic
// position rules. No shortforms, no capitalisation-driven edge cases.
const EN_G2_GROUPS = {
  'ch':  { dots: [1, 6],          pos: 'sme' },
  'gh':  { dots: [1, 2, 6],       pos: 'sme' },
  'sh':  { dots: [1, 4, 6],       pos: 'sme' },
  'th':  { dots: [1, 4, 5, 6],    pos: 'sme' },
  'wh':  { dots: [1, 5, 6],       pos: 'sme' },
  'ed':  { dots: [1, 2, 4, 6],    pos: 'sme' },
  'er':  { dots: [1, 2, 4, 5, 6], pos: 'sme' },
  'ou':  { dots: [1, 2, 5, 6],    pos: 'sme' },
  'ow':  { dots: [2, 4, 6],       pos: 'sme' },
  'st':  { dots: [3, 4],          pos: 'sme' },
  'ing': { dots: [3, 4, 6],       pos: 'sme' },
  'ar':  { dots: [3, 4, 5],       pos: 'sme' },
  // Lower groupsigns — never at the start of a word (simplified rule).
  'ea':  { dots: [2],             pos: 'me' },
  'bb':  { dots: [2, 3],          pos: 'me' },
  'con': { dots: [2, 5],          pos: 'me' },
  'cc':  { dots: [2, 5],          pos: 'me' },
  'dis': { dots: [2, 5, 6],       pos: 'me' },
  'en':  { dots: [2, 6],          pos: 'me' },
  'ff':  { dots: [2, 3, 5],       pos: 'me' },
  'gg':  { dots: [2, 3, 5, 6],    pos: 'me' },
  'in':  { dots: [3, 5],          pos: 'me' },
};

// Alphabetic wordsigns (single letter = word), strong wordsigns, strong
// contractions and lower wordsigns — standalone words only.
const EN_G2_WORDS = {
  'but': [1, 2], 'can': [1, 4], 'do': [1, 4, 5], 'every': [1, 5],
  'from': [1, 2, 4], 'go': [1, 2, 4, 5], 'have': [1, 2, 5], 'just': [2, 4, 5],
  'knowledge': [1, 3], 'like': [1, 2, 3], 'more': [1, 3, 4], 'not': [1, 3, 4, 5],
  'people': [1, 2, 3, 4], 'quite': [1, 2, 3, 4, 5], 'rather': [1, 2, 3, 5],
  'so': [2, 3, 4], 'that': [2, 3, 4, 5], 'us': [1, 3, 6], 'very': [1, 2, 3, 6],
  'will': [2, 4, 5, 6], 'it': [1, 3, 4, 6], 'you': [1, 3, 4, 5, 6], 'as': [1, 3, 5, 6],
  'child': [1, 6], 'shall': [1, 4, 6], 'this': [1, 4, 5, 6], 'which': [1, 5, 6],
  'out': [1, 2, 5, 6], 'still': [3, 4],
  'and': [1, 2, 3, 4, 6], 'for': [1, 2, 3, 4, 5, 6], 'of': [1, 2, 3, 5, 6],
  'the': [2, 3, 4, 6], 'with': [2, 3, 4, 5, 6],
  'be': [2, 3], 'enough': [2, 6], 'were': [2, 3, 5, 6], 'his': [2, 3, 6],
  'in': [3, 5], 'was': [3, 5, 6],
};

const EN_UEB_G2 = {
  ...EN_UEB,
  groups: EN_G2_GROUPS,
  words: EN_G2_WORDS,
};

// French Grade 1 (uncontracted) — accent letters verified against the
// standard French braille alphabet (é ⠿, à ⠷, è ⠮, ù ⠾, â ⠡, ê ⠣, î ⠩,
// ô ⠹, û ⠱, ë ⠫, ï ⠻, ü ⠳, ç ⠯, œ ⠪).
const FR_BRL = {
  letters: {
    'a': [1], 'b': [1, 2], 'c': [1, 4], 'd': [1, 4, 5], 'e': [1, 5],
    'f': [1, 2, 4], 'g': [1, 2, 4, 5], 'h': [1, 2, 5], 'i': [2, 4], 'j': [2, 4, 5],
    'k': [1, 3], 'l': [1, 2, 3], 'm': [1, 3, 4], 'n': [1, 3, 4, 5], 'o': [1, 3, 5],
    'p': [1, 2, 3, 4], 'q': [1, 2, 3, 4, 5], 'r': [1, 2, 3, 5], 's': [2, 3, 4], 't': [2, 3, 4, 5],
    'u': [1, 3, 6], 'v': [1, 2, 3, 6], 'w': [2, 4, 5, 6], 'x': [1, 3, 4, 6],
    'y': [1, 3, 4, 5, 6], 'z': [1, 3, 5, 6],
    'à': [1, 2, 3, 5, 6], 'â': [1, 6], 'ç': [1, 2, 3, 4, 6], 'é': [1, 2, 3, 4, 5, 6],
    'è': [2, 3, 4, 6], 'ê': [1, 2, 6], 'ë': [1, 2, 4, 6], 'î': [1, 4, 6],
    'ï': [1, 2, 4, 5, 6], 'ô': [1, 4, 5, 6], 'œ': [2, 4, 6], 'ù': [2, 3, 4, 5, 6],
    'û': [1, 5, 6], 'ü': [1, 2, 5, 6],
  },
  groups: {},
  words: {},
  punctuation: {
    '.': [2, 5, 6], ',': [2], ':': [2, 5], ';': [2, 3], '?': [2, 6], '!': [2, 3, 5],
    '-': [3, 6], "'": [3], '(': [2, 3, 6], ')': [3, 5, 6], '/': [2, 5, 6],
  },
  numberSign: [3, 4, 5, 6],
};

// Spanish Grade 1 (uncontracted) — vowels/consonants per the French-Wikipedia
// comparison table (á ⠷, é ⠮, í ⠌, ó ⠬, ú ⠱, ñ ⠻, ü ⠪).
const ES_BRL = {
  letters: {
    'a': [1], 'b': [1, 2], 'c': [1, 4], 'd': [1, 4, 5], 'e': [1, 5],
    'f': [1, 2, 4], 'g': [1, 2, 4, 5], 'h': [1, 2, 5], 'i': [2, 4], 'j': [2, 4, 5],
    'k': [1, 3], 'l': [1, 2, 3], 'm': [1, 3, 4], 'n': [1, 3, 4, 5], 'o': [1, 3, 5],
    'p': [1, 2, 3, 4], 'q': [1, 2, 3, 4, 5], 'r': [1, 2, 3, 5], 's': [2, 3, 4], 't': [2, 3, 4, 5],
    'u': [1, 3, 6], 'v': [1, 2, 3, 6], 'w': [2, 4, 5, 6], 'x': [1, 3, 4, 6],
    'y': [1, 3, 4, 5, 6], 'z': [1, 3, 5, 6],
    'á': [1, 2, 3, 5, 6], 'é': [2, 3, 4, 6], 'í': [3, 4], 'ó': [3, 4, 6],
    'ú': [1, 5, 6], 'ñ': [1, 2, 4, 5, 6], 'ü': [2, 4, 6],
  },
  groups: {},
  words: {},
  punctuation: {
    '.': [3], ',': [2], ':': [2, 5], ';': [2, 3], '?': [2, 6], '!': [2, 3, 5],
    '-': [3, 6], "'": [6], '(': [2, 3, 5, 6], ')': [2, 3, 5, 6], '/': [2, 5, 6],
    '¿': [2, 6], '¡': [2, 3, 5],
  },
  numberSign: [3, 4, 5, 6],
};

// Italian Grade 1 (uncontracted) — accents per the French-Wikipedia comparison
// table (à ⠷, è ⠮, é ⠿, ì ⠌, ó ⠳, ò ⠬, ù ⠾).
const IT_BRL = {
  letters: {
    'a': [1], 'b': [1, 2], 'c': [1, 4], 'd': [1, 4, 5], 'e': [1, 5],
    'f': [1, 2, 4], 'g': [1, 2, 4, 5], 'h': [1, 2, 5], 'i': [2, 4], 'j': [2, 4, 5],
    'k': [1, 3], 'l': [1, 2, 3], 'm': [1, 3, 4], 'n': [1, 3, 4, 5], 'o': [1, 3, 5],
    'p': [1, 2, 3, 4], 'q': [1, 2, 3, 4, 5], 'r': [1, 2, 3, 5], 's': [2, 3, 4], 't': [2, 3, 4, 5],
    'u': [1, 3, 6], 'v': [1, 2, 3, 6], 'w': [2, 4, 5, 6], 'x': [1, 3, 4, 6],
    'y': [1, 3, 4, 5, 6], 'z': [1, 3, 5, 6],
    'à': [1, 2, 3, 5, 6], 'è': [2, 3, 4, 6], 'é': [1, 2, 3, 4, 5, 6],
    'ì': [3, 4], 'ó': [1, 2, 5, 6], 'ò': [3, 4, 6], 'ù': [2, 3, 4, 5, 6],
  },
  groups: {},
  words: {},
  punctuation: {
    '.': [2, 5, 6], ',': [2], ':': [2, 5], ';': [2, 3], '?': [2, 6], '!': [2, 3, 5],
    '-': [3, 6], "'": [3], '(': [2, 3, 6], ')': [3, 5, 6], '/': [2, 5, 6],
  },
  numberSign: [3, 4, 5, 6],
};

// Portuguese Grade 1 (uncontracted) — per the French-Wikipedia comparison
// table (á ⠷, à ⠫, â ⠡, ã ⠜, ç ⠯, è ⠮, é ⠿, ê ⠣, ì ⠩, í ⠌, ó ⠬, ô ⠹,
// õ ⠪, ù ⠱, ú ⠾, ü ⠳).
const PT_BRL = {
  letters: {
    'a': [1], 'b': [1, 2], 'c': [1, 4], 'd': [1, 4, 5], 'e': [1, 5],
    'f': [1, 2, 4], 'g': [1, 2, 4, 5], 'h': [1, 2, 5], 'i': [2, 4], 'j': [2, 4, 5],
    'k': [1, 3], 'l': [1, 2, 3], 'm': [1, 3, 4], 'n': [1, 3, 4, 5], 'o': [1, 3, 5],
    'p': [1, 2, 3, 4], 'q': [1, 2, 3, 4, 5], 'r': [1, 2, 3, 5], 's': [2, 3, 4], 't': [2, 3, 4, 5],
    'u': [1, 3, 6], 'v': [1, 2, 3, 6], 'w': [2, 4, 5, 6], 'x': [1, 3, 4, 6],
    'y': [1, 3, 4, 5, 6], 'z': [1, 3, 5, 6],
    'á': [1, 2, 3, 5, 6], 'à': [1, 2, 4, 6], 'â': [1, 6], 'ã': [3, 4, 5],
    'ç': [1, 2, 3, 4, 6], 'é': [1, 2, 3, 4, 5, 6], 'ê': [1, 2, 6],
    'í': [3, 4], 'ó': [3, 4, 6], 'ô': [1, 4, 5, 6], 'õ': [2, 4, 6],
    'ú': [2, 3, 4, 5, 6], 'ü': [1, 2, 5, 6],
  },
  groups: {},
  words: {},
  punctuation: {
    '.': [2, 5, 6], ',': [2], ':': [2, 5], ';': [2, 3], '?': [2, 6], '!': [2, 3, 5],
    '-': [3, 6], "'": [3], '(': [2, 3, 6], ')': [3, 5, 6], '/': [2, 5, 6],
  },
  numberSign: [3, 4, 5, 6],
};

export const BRAILLE_LANGUAGES = [
  { id: 'de',      label: 'Deutsch (Vollschrift)' },
  { id: 'de-kurz', label: 'Deutsch (Kurzschrift, vereinfacht)' },
  { id: 'en',      label: 'English (UEB Grade 1)' },
  { id: 'en-g2',   label: 'English (UEB Grade 2, contracted)' },
  { id: 'fr',      label: 'Français (Grade 1)' },
  { id: 'es',      label: 'Español (Grade 1)' },
  { id: 'it',      label: 'Italiano (Grade 1)' },
  { id: 'pt',      label: 'Português (Grade 1)' },
];

const TABLES = {
  de: DE_VOLLSCHRIFT, 'de-kurz': DE_KURZSCHRIFT,
  en: EN_UEB, 'en-g2': EN_UEB_G2,
  fr: FR_BRL, es: ES_BRL, it: IT_BRL, pt: PT_BRL,
};

// Digits reuse the a-j letter patterns (with a number sign in front).
const DIGIT_TO_LETTER = { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e', '6': 'f', '7': 'g', '8': 'h', '9': 'i', '0': 'j' };

// ── Translation ──────────────────────────────────────────────────────────────

/** Unicode Braille pattern (U+2800 + octal dot sum) for a dot-number array. */
export function cellToUnicode(dots) {
  if (!dots || !dots.length) return '⠀';
  let code = 0x2800;
  for (const d of dots) code += 1 << (d - 1);
  return String.fromCharCode(code);
}

/** Position flags of a Kurzschrift/Grade-2 groupsign: 'sme' etc. */
function _groupAllowedAt(pos, wordStart, wordEnd) {
  if (wordStart && !pos.includes('s')) return false;
  if (wordEnd && !pos.includes('e')) return false;
  if (!wordStart && !wordEnd && !pos.includes('m')) return false;
  return true;
}

/**
 * Translate black-print text into Braille cells.
 * Returns { lines: [[cell|null]], unknown: [char] } — a cell is
 * { dots: [1..8], char, isNumberSign }; null entries are word gaps.
 */
export function translateText(text, langId, dots8 = false) {
  const table = TABLES[langId] ?? TABLES.de;
  const lines = [];
  const unknown = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const cells = [];
    // Tokenise into words (runs of non-space) separated by gaps.
    const tokens = rawLine.split(/(\s+)/).filter(tok => tok !== '');
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (/^\s+$/.test(tok)) {
        if (cells.length) cells.push(null);   // word gap
        continue;
      }
      // Standalone word sign (Kurzschrift / Grade 2).
      const wordKey = tok.toLowerCase();
      if (table.words && table.words[wordKey]) {
        cells.push({ dots: table.words[wordKey], char: tok, isNumberSign: false });
        continue;
      }
      let i = 0;
      let inNumber = false;
      while (i < tok.length) {
        const ch = tok[i];
        const lowerCh = ch.toLowerCase();
        // Letter groups first (longest match), then letters, digits, punctuation.
        let dots = null;
        let len = 1;
        let isLetterCell = false;
        let letterKey = null;
        for (const [grp, g] of Object.entries(table.groups ?? {})) {
          const grpDots = g && typeof g === 'object' && 'dots' in g ? g.dots : g;
          const pos = g && typeof g === 'object' && 'pos' in g ? g.pos : 'sme';
          if (grp.length > 1 && tok.toLowerCase().startsWith(grp, i)
              && _groupAllowedAt(pos, i === 0, i + grp.length >= tok.length)) {
            dots = grpDots; len = grp.length; break;
          }
        }
        if (!dots && table.letters[lowerCh]) {
          dots = table.letters[lowerCh]; isLetterCell = true; letterKey = lowerCh;
        }
        let isDigit = false;
        if (!dots && DIGIT_TO_LETTER[ch]) {
          dots = table.letters[DIGIT_TO_LETTER[ch]]; isDigit = true; letterKey = DIGIT_TO_LETTER[ch];
        }
        if (!dots && table.punctuation[ch]) {
          dots = table.punctuation[ch];
        }
        if (!dots) {
          if (!/\s/.test(ch)) unknown.push(ch);
          i++;
          inNumber = false;
          continue;
        }
        // Number sign before a digit run (digits reuse the a-j patterns).
        if (isDigit && !inNumber) {
          cells.push({ dots: table.numberSign, char: '#', isNumberSign: true });
          inNumber = true;
        }
        if (!isDigit) inNumber = false;
        // Eight-dot computer Braille letter extension: dot 7 on a-j (whose
        // plain patterns double as the digits), dot 8 on u-z.
        if (dots8 && isLetterCell && letterKey) {
          const extra = letterKey >= 'a' && letterKey <= 'j' ? 7
                      : letterKey >= 'u' && letterKey <= 'z' ? 8 : 0;
          if (extra) dots = [...dots, extra];
        }
        // char = the FULL source substring this cell stands for (groups like
        // 'st' span several characters) — the black-print caption is rebuilt
        // from these, so a group must not shrink to its first letter.
        cells.push({ dots, char: tok.slice(i, i + len), isNumberSign: false });
        i += len;
      }
    }
    while (cells.length && cells[cells.length - 1] === null) cells.pop();
    lines.push(cells);
  }
  while (lines.length && lines[lines.length - 1].length === 0) lines.pop();
  return { lines, unknown: [...new Set(unknown)] };
}

// ── Layout + rasterisation ───────────────────────────────────────────────────

export const BRAILLE_DEFAULTS = {
  language: 'de',
  dots8: false,
  mode: 'raised',            // 'raised' | 'recessed'
  dotDiameter: 1.6,          // CSV DotDiameter
  dotSpacing: 2.5,           // CSV DotSpacing
  cellSpacing: 6.0,          // CSV CellSpacing
  wordSpacing: 8.0,          // CSV WordSpacing (2 mm + CellSpacing)
  rowSpacing: 10.0,          // CSV RowSpacing (4 × DotSpacing)
  dotHeight: 0.5,            // CSV DotHeight
  dotRounding: 0.75,         // CSV DotRounding
  recessMargin: 3.0,         // CSV DistanceRecessCellValue: dot edge → pocket edge
  recessDepth: 0.5,          // default = dotHeight → dot tops flush with the surface
  align: 'center',           // 'left' | 'center'
  blackShow: false,
  blackSize: 4.0,            // cap height in mm
  blackDepth: 0.4,
  blackGap: 2.0,             // Braille bottom → text top
  blackRelief: 'engrave',    // 'engrave' | 'emboss'
  blackFont: 'Arial',
  pxPerMm: 20,
  pocketsOnly: false,        // internal: recessed frame WITHOUT dots (base body
                             // of the separate-part export; the dots become
                             // their own solid volume)
};

/**
 * Standard-proportion dependencies between the parameters: while a parameter
 * is LOCKED it derives its value from its parent (the ratios the defaults
 * encode), so e.g. growing the dot spacing keeps the cell pitch proportional.
 * The layout clamps (cell ≥ dot, word ≥ cell) stay as a safety net.
 */
export const BR_LOCK_DEPS = {
  cellSpacing: { parent: 'dotSpacing', f: v => v * 2.4 },   // 2.5 → 6
  wordSpacing: { parent: 'cellSpacing', f: v => v + 2 },    // 6 → 8 (2 mm word gap)
  rowSpacing:  { parent: 'dotSpacing', f: v => v * 4 },     // 2.5 → 10
  recessDepth: { parent: 'dotHeight', f: v => v },          // dot tops flush
};

const PAD_MM = 2.0;                 // neutral background margin around the block
const MAX_MAP_SIDE = 4096;
const MAX_MAP_PIXELS = 4096 * 4096;

/** Row span (1-based top-down) a cell's dots occupy. */
function usedRows(dots) {
  if (!dots || !dots.length) return { min: 1, max: 1, count: 1 };
  const rows = dots.map(dotRow);
  return { min: Math.min(...rows), max: Math.max(...rows), count: Math.max(...rows) - Math.min(...rows) + 1 };
}

// Dot numbering: 1-2-3 down the LEFT column, 4-5-6 down the RIGHT column;
// 7/8 are the extra bottom row of eight-dot computer Braille (left/right).
function dotCol(d) { return d <= 6 ? Math.floor((d - 1) / 3) : (d === 7 ? 0 : 1); }
function dotRow(d) { return (d <= 6 ? (d - 1) % 3 : 3) + 1; }   // 1-based, top down

/**
 * Rasterise the Braille block.
 * @param {object} p  parameters (see BRAILLE_DEFAULTS; mm units)
 * @returns {null | { canvas, imageData, width, height, widthMm, heightMm,
 *                    amplitudeMm, lineCount, unknownChars, unicode,
 *                    contentRect, dots, pocketRect }}
 *   contentRect: { x0, y0, x1, y1 } bounding box of the actual relief in map
 *   millimetres (x from the map's left edge, y from its BOTTOM edge) — the
 *   preview shader's block weight is 1 inside it and 0 outside.
 *   dots: [{ x, y, r, h }] dot centres in the same coordinates (for the
 *   separate-part solid export). pocketRect: the recessed frame, same coords.
 */
export function generateBrailleMap(p) {
  const params = { ...BRAILLE_DEFAULTS, ...p };
  const { lines, unknown } = translateText(params.text, params.language, params.dots8);
  if (!lines.length || !lines.some(l => l.length)) return null;

  const D = Math.max(0.2, params.dotDiameter);
  const r = D / 2;
  const sDot = Math.max(0.5, params.dotSpacing);
  const sCell = Math.max(sDot + 0.1, params.cellSpacing);
  const sWord = Math.max(sCell, params.wordSpacing);
  const sRow = Math.max(1, params.rowSpacing);

  // ── Horizontal layout: cell-centre x per line ──────────────────────────────
  // A cell's centre is the midpoint between its two dot columns; the dot
  // columns sit at centre ± sDot/2. Word gaps advance by sWord instead of
  // sCell. Empty lines still reserve their (zero-width) slot.
  const lineLayout = lines.map(cells => {
    const centres = [];
    let x = 0;
    let gap = false;
    for (const cell of cells) {
      if (!cell) {                       // word gap: widen the next step
        gap = centres.length > 0;
        continue;
      }
      if (centres.length) x += gap ? sWord : sCell;
      gap = false;
      centres.push({ x, cell });
    }
    const halfSpan = sDot / 2 + r;
    const left = centres.length ? centres[0].x - halfSpan : 0;
    const right = centres.length ? centres[centres.length - 1].x + halfSpan : 0;
    return { centres, left, right, width: right - left };
  });

  const contentWidth = Math.max(1e-6, ...lineLayout.map(l => l.width));
  const lineOffsets = lineLayout.map(l =>
    params.align === 'left' ? 0 : (contentWidth - l.width) / 2);
  // Shift so the leftmost content point sits at x=0 — the map draws the
  // content PAD_MM in from its border, so nothing gets clipped there.
  const minLeft = Math.min(...lineLayout.map((l, i) => lineOffsets[i] + l.left));
  for (let i = 0; i < lineOffsets.length; i++) lineOffsets[i] -= minLeft;
  // Recessed mode draws ONE straight frame around the whole block; reserve
  // room for it so the frame's edges stay inside the map.
  const framePad = params.mode === 'recessed' ? Math.max(0, params.recessMargin) : 0;
  for (let i = 0; i < lineOffsets.length; i++) lineOffsets[i] += framePad;

  // ── Vertical layout ────────────────────────────────────────────────────────
  // Y coordinates are measured from the line's Braille top (top dot row
  // centre = r below it). The recessed frame extends recessMargin beyond
  // the dots, so the line box grows accordingly.
  const pocketPad = params.mode === 'recessed'
    ? Math.max(0, params.recessMargin) + r : 0;
  const lineBoxes = lineLayout.map(l => {
    let maxRows = 1;
    for (const { cell } of l.centres) {
      if (cell.dots && cell.dots.length) {
        const u = usedRows(cell.dots);
        maxRows = Math.max(maxRows, u.max);
      }
    }
    const brailleH = (maxRows - 1) * sDot + D;
    const boxH = brailleH + 2 * pocketPad;
    const extra = params.blackShow ? Math.max(0, params.blackGap) + Math.max(0.2, params.blackSize) : 0;
    return { maxRows, brailleH, boxH, extra, height: boxH + extra };
  });

  // Line pitch: keep the tactile RowSpacing between Braille rows unless the
  // caption needs more room. lineTops[i] = box-top offset of line i from the
  // content top (a box top is pocketPad above the Braille top).
  const pitches = lineBoxes.map((b, i) => {
    if (i === lineBoxes.length - 1) return 0;
    const needed = b.height + 1.0;
    return Math.max(sRow, needed);
  });
  const lineTops = [0];
  for (let i = 1; i < lineBoxes.length; i++) lineTops[i] = lineTops[i - 1] + pitches[i - 1];
  const totalH = lineTops[lineTops.length - 1] + lineBoxes[lineBoxes.length - 1].height;

  const widthMm = contentWidth + 2 * framePad + 2 * PAD_MM;
  const heightMm = totalH + 2 * PAD_MM;

  // ── Raster resolution ──────────────────────────────────────────────────────
  let px = Math.max(4, Math.min(80, params.pxPerMm || 20));
  let W = Math.ceil(widthMm * px);
  let H = Math.ceil(heightMm * px);
  if (W > MAX_MAP_SIDE || H > MAX_MAP_SIDE || W * H > MAX_MAP_PIXELS) {
    px = Math.max(4, Math.min(px,
      MAX_MAP_SIDE / Math.max(widthMm, heightMm),
      Math.sqrt(MAX_MAP_PIXELS / (widthMm * heightMm))));
    W = Math.min(MAX_MAP_SIDE, Math.ceil(widthMm * px));
    H = Math.min(MAX_MAP_SIDE, Math.ceil(heightMm * px));
  }

  // ── Depth field (mm, + = above surface) ────────────────────────────────────
  const depth = new Float32Array(W * H);
  const recessed = params.mode === 'recessed';
  const recessDepth = Math.max(0, params.recessDepth);
  const recessMargin = Math.max(0, params.recessMargin);
  const dotH = Math.max(0.05, params.dotHeight);

  const toPxX = (mm) => (mm + PAD_MM) * px;
  const toPxY = (mm) => (mm + PAD_MM) * px;   // y measured DOWN from content top

  // Recessed mode: ONE straight rectangular frame around the whole block.
  // The frame edge sits recessMargin outside the outermost dot edges.
  let pocketRect = null;
  if (recessed && recessDepth > 0) {
    let dTop = Infinity, dBot = -Infinity, dLeft = Infinity, dRight = -Infinity;
    lineLayout.forEach((l, li) => {
      const gridTopY = r + pocketPad;
      for (const { x, cell } of l.centres) {
        if (!cell.dots || !cell.dots.length) continue;
        const u = usedRows(cell.dots);
        dTop = Math.min(dTop, lineTops[li] + gridTopY + (u.min - 1) * sDot - r);
        dBot = Math.max(dBot, lineTops[li] + gridTopY + (u.max - 1) * sDot + r);
        const cx = x + lineOffsets[li];
        dLeft = Math.min(dLeft, cx - sDot / 2 - r);
        dRight = Math.max(dRight, cx + sDot / 2 + r);
      }
    });
    if (dTop < Infinity) {
      // Soft wall: the depth ramps from the surface into the pocket over a
      // short rounded chamfer instead of a 1-px cliff. Mesh vertices sample
      // this map — a hard edge becomes a sawtooth staircase on the exported
      // wall, a smoothstep ramp becomes a clean chamfer that also prints
      // better (no stepped overhang).
      const rimX0 = toPxX(dLeft - recessMargin), rimX1 = toPxX(dRight + recessMargin);
      const rimY0 = toPxY(dTop - recessMargin), rimY1 = toPxY(dBot + recessMargin);
      const cham = Math.max(2, Math.min(0.4 * px, recessDepth * px));   // px
      const px0 = Math.max(0, Math.floor(rimX0 - cham));
      const px1 = Math.min(W - 1, Math.ceil(rimX1 + cham));
      const py0 = Math.max(0, Math.floor(rimY0 - cham));
      const py1 = Math.min(H - 1, Math.ceil(rimY1 + cham));
      for (let py = py0; py <= py1; py++) {
        const row = py * W;
        const cyp = py + 0.5;
        for (let pxx = px0; pxx <= px1; pxx++) {
          const cxp = pxx + 0.5;
          const dx = Math.max(rimX0 - cxp, cxp - rimX1, 0);
          const dy = Math.max(rimY0 - cyp, cyp - rimY1, 0);
          const dOut = Math.sqrt(dx * dx + dy * dy);   // Euclidean → rounded corners
          if (dOut >= cham) continue;
          let t = 1 - dOut / cham;
          t = t * t * (3 - 2 * t);                     // tangent to floor & surface
          const z = -recessDepth * t;
          const idx = row + pxx;
          if (z < depth[idx]) depth[idx] = z;
        }
      }
      // Map millimetres: x from left, y from BOTTOM (chamfer included).
      pocketRect = {
        x0: Math.max(0, rimX0 - cham) / px,
        x1: Math.min(W, rimX1 + cham) / px,
        y0: heightMm - Math.min(H, rimY1 + cham) / px,
        y1: heightMm - Math.max(0, rimY0 - cham) / px,
      };
    }
  }

  // ── Dot stamp (radial profile, precomputed once) ───────────────────────────
  // Spherical cap of base radius r and height dotH, with the outer
  // dotRounding of the base rounded off to zero (DotRounding = 0 → sharp edge).
  const stampR = Math.ceil((r + 0.5 / px) * px);   // +1px AA margin
  const stampSize = 2 * stampR + 1;
  const stamp = new Float32Array(stampSize * stampSize);
  {
    const rounding = Math.max(0, Math.min(params.dotRounding, r));
    const innerR = r - rounding;
    let Rs;
    if (dotH >= r) {
      Rs = r;                                   // hemisphere + cylinder top
    } else {
      Rs = (r * r + dotH * dotH) / (2 * dotH);  // spherical cap through (r, 0) and (0, dotH)
    }
    const apexOffset = Rs - dotH;
    const edgeZ = innerR > 0
      ? Math.sqrt(Math.max(0, Rs * Rs - innerR * innerR)) - apexOffset
      : 0;
    for (let sy = 0; sy < stampSize; sy++) {
      for (let sx = 0; sx < stampSize; sx++) {
        const dx = (sx - stampR) / px;
        const dy = (sy - stampR) / px;
        const d = Math.sqrt(dx * dx + dy * dy);
        let z = 0;
        if (d <= innerR) {
          z = dotH >= r
            ? (Math.sqrt(Math.max(0, r * r - d * d)) + (dotH - r))
            : (Math.sqrt(Math.max(0, Rs * Rs - d * d)) - apexOffset);
        } else if (d <= r && rounding > 0) {
          const t = (d - innerR) / rounding;    // 0..1 across the fillet
          z = edgeZ * Math.sqrt(Math.max(0, 1 - t * t));
        }
        stamp[sy * stampSize + sx] = z;
      }
    }
  }

  const dots = [];   // dot centres in map mm (x from left, y from bottom)
  const dotFloor = recessed ? -recessDepth : 0;
  const stampDots = (centreXMm, centreYMm) => {
    const cx = toPxX(centreXMm);
    const cy = toPxY(centreYMm);
    dots.push({ x: centreXMm + PAD_MM, y: heightMm - centreYMm - PAD_MM, r, h: dotH });
    if (params.pocketsOnly) return;   // record the dot, don't rasterise it
    for (let sy = 0; sy < stampSize; sy++) {
      const pyy = Math.round(cy) - stampR + sy;
      if (pyy < 0 || pyy >= H) continue;
      const row = pyy * W;
      for (let sx = 0; sx < stampSize; sx++) {
        const pxx = Math.round(cx) - stampR + sx;
        if (pxx < 0 || pxx >= W) continue;
        const z = dotFloor + stamp[sy * stampSize + sx];
        const idx = row + pxx;
        if (z > depth[idx]) depth[idx] = z;
      }
    }
  };

  lineLayout.forEach((l, li) => {
    const boxTopMm = lineTops[li];
    const gridTopY = r + pocketPad;
    for (const { x, cell } of l.centres) {
      if (!cell.dots || !cell.dots.length) continue;
      for (const d of cell.dots) {
        const dotX = x + lineOffsets[li] + (dotCol(d) === 0 ? -sDot / 2 : sDot / 2);
        const dotY = boxTopMm + gridTopY + (dotRow(d) - 1) * sDot;
        stampDots(dotX, dotY);
      }
    }
  });

  // ── Black-print caption per line (merged into the depth field) ─────────────
  // It must live in `depth`, not only on the canvas: the CPU displacement
  // path reads imageData, and the content rect below has to include it or
  // the shader's block mask would suppress it.
  const blackReliefDepth = params.blackShow ? Math.max(0.05, params.blackDepth) : 0;
  if (params.blackShow) {
    const fontPx = (Math.max(0.2, params.blackSize) / 0.72) * px;
    const mask = document.createElement('canvas');
    mask.width = W; mask.height = H;
    const mctx = mask.getContext('2d');
    mctx.textAlign = 'center';
    mctx.textBaseline = 'alphabetic';
    mctx.font = `${fontPx.toFixed(2)}px "${params.blackFont}", Arial, sans-serif`;
    mctx.fillStyle = '#fff';
    lineLayout.forEach((l, li) => {
      // Caption shows the original characters — but NOT the number-sign cell
      // (char '#'): it exists only to switch Braille into digit mode and must
      // not appear in the black-print text ("test1", not "test#1").
      const raw = lines[li].map(c => (!c ? ' ' : (c.isNumberSign ? '' : c.char))).join('').trim();
      if (!raw) return;
      const textTopMm = lineBoxes[li].boxH + Math.max(0, params.blackGap);   // from line box top
      const baselineY = toPxY(lineTops[li] + textTopMm + Math.max(0.2, params.blackSize));
      const centreX = toPxX(lineOffsets[li] + (l.left + l.right) / 2);
      mctx.fillText(raw, centreX, baselineY, (contentWidth + PAD_MM) * px);
    });
    const maskData = mctx.getImageData(0, 0, W, H).data;
    const emboss = params.blackRelief === 'emboss';
    for (let i = 0; i < W * H; i++) {
      const a = maskData[i * 4 + 3] / 255;   // coverage → anti-aliased glyph edges
      if (a > 0) {
        depth[i] = emboss ? Math.max(depth[i], blackReliefDepth * a)
                          : Math.min(depth[i], -blackReliefDepth * a);
      }
    }
  }

  // ── Depth → grey ImageData ─────────────────────────────────────────────────
  let amp = 0;
  for (let i = 0; i < depth.length; i++) {
    const a = Math.abs(depth[i]);
    if (a > amp) amp = a;
  }
  if (amp <= 1e-6) return null;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;
  const greyOf = (z) => Math.max(0, Math.min(1, 0.5 + z / (2 * amp)));
  for (let i = 0; i < W * H; i++) {
    const g = Math.round(greyOf(depth[i]) * 255);
    const o = i * 4;
    data[o] = g; data[o + 1] = g; data[o + 2] = g; data[o + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  // ── Content rect: bounding box of every non-neutral pixel (map mm) ─────────
  let cx0 = Infinity, cy1 = -Infinity, cx1 = -Infinity, cy0 = Infinity;
  for (let py = 0; py < H; py++) {
    const row = py * W;
    for (let pxx = 0; pxx < W; pxx++) {
      if (depth[row + pxx] !== 0) {
        if (pxx < cx0) cx0 = pxx;
        if (pxx > cx1) cx1 = pxx;
        if (py < cy0) cy0 = py;
        if (py > cy1) cy1 = py;
      }
    }
  }
  const contentRect = (cx0 < Infinity) ? {
    x0: cx0 / px, x1: (cx1 + 1) / px,
    y0: heightMm - (cy1 + 1) / px, y1: heightMm - cy0 / px,
  } : { x0: 0, y0: 0, x1: widthMm, y1: heightMm };

  // Unicode preview of the translation (for the UI, not the mesh).
  const unicode = lines.map(cells =>
    cells.map(c => (c ? cellToUnicode(c.dots) : ' ')).join('').trimEnd()
  ).join('\n');

  return {
    canvas, imageData, width: W, height: H,
    widthMm, heightMm, amplitudeMm: amp,
    lineCount: lines.length, unknownChars: unknown, unicode,
    contentRect, dots, pocketRect,
    params: { ...params },
  };
}
