// Verse reference parser - detects and parses Bible verse references in user input
// with canonical 66-book chapter/verse bounds validation (derived from engwebp_vpl.xml).

import { BOOK_MAPPING } from './bible-constants.ts'

export interface ParsedVerseReference {
  book: string           // 3-letter code (e.g., "1co")
  bookFullName: string   // Full name (e.g., "1 Corinthians")
  chapter: number
  verseStart?: number
  verseEnd?: number
}

// Exact canonical verse counts per chapter for all 66 books (1,189 chapters) from engwebp_vpl.xml
export const BOOK_CHAPTER_VERSE_COUNTS: Record<string, readonly number[]> = {
  gen: [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],
  exo: [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],
  lev: [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34],
  num: [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],
  deu: [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],
  jos: [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],
  jdg: [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],
  rut: [22,23,18,22],
  '1sa': [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13],
  '2sa': [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],
  '1ki': [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53],
  '2ki': [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],
  '1ch': [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],
  '2ch': [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],
  ezr: [11,70,13,24,17,22,28,36,15,44],
  neh: [11,20,32,23,19,19,73,18,38,39,36,47,31],
  est: [22,23,15,17,14,14,10,17,32,3],
  job: [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17],
  psa: [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6],
  pro: [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31],
  ecc: [18,26,22,16,20,12,29,17,18,20,10,14],
  sng: [17,17,11,16,16,13,13,14],
  isa: [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24],
  jer: [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34],
  lam: [22,22,66,22,22],
  ezk: [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35],
  dan: [21,49,30,37,31,28,28,27,27,21,45,13],
  hos: [11,23,5,19,15,11,16,14,17,15,12,14,16,9],
  jol: [20,32,21],
  amo: [15,16,15,13,27,14,17,14,15],
  oba: [21],
  jon: [17,10,10,11],
  mic: [16,13,12,13,15,16,20],
  nam: [15,13,19],
  hab: [17,20,19],
  zep: [18,15,20],
  hag: [15,23],
  zec: [21,13,10,14,11,15,14,23,17,12,17,14,9,21],
  mal: [14,17,18,6],
  mat: [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  mrk: [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  luk: [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  jhn: [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  act: [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  rom: [32,29,31,25,21,23,25,39,33,21,36,21,14,26,33,25],
  '1co': [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],
  '2co': [24,17,18,18,21,18,16,24,15,18,33,21,14],
  gal: [24,21,29,31,26,18],
  eph: [23,22,21,32,33,24],
  php: [30,30,21,23],
  col: [29,23,25,18],
  '1th': [10,20,13,18,28],
  '2th': [12,17,18],
  '1ti': [20,15,16,16,25,21],
  '2ti': [18,26,17,22],
  tit: [16,15,15],
  phm: [25],
  heb: [14,18,19,16,14,20,28,13,28,39,40,29,25],
  jas: [27,26,18,17,20],
  '1pe': [25,25,22,19,14],
  '2pe': [21,22,18],
  '1jn': [10,29,24,21,21],
  '2jn': [13],
  '3jn': [14],
  jud: [25],
  rev: [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21],
}

export function getBookChapterCount(book: string): number {
  return BOOK_CHAPTER_VERSE_COUNTS[book.toLowerCase()]?.length ?? 0
}

export function getChapterVerseCount(book: string, chapter: number): number {
  if (!Number.isInteger(chapter) || chapter < 1) return 0
  return BOOK_CHAPTER_VERSE_COUNTS[book.toLowerCase()]?.[chapter - 1] ?? 0
}

// Trailing Bible translation abbreviations users commonly paste after a reference
const TRANSLATION_SUFFIX_RE =
  /\s*(?:\(\s*)?\b(?:niv|esv|kjv|nkjv|nlt|nasb|nasb95|csb|hcsb|web|webu|amp|msg|nrsv|rsv|asv|net|cev|gnt|bsb|lsb|ylt|tpt)\b(?:\s*\))?\s*$/i

// Common abbreviations, variations, and observed real-user typos -> 3-letter canonical code
const BOOK_ALIASES: Record<string, string> = {
  // Genesis
  'genesis': 'gen', 'gen': 'gen', 'gn': 'gen', 'ge': 'gen',
  'genisis': 'gen', 'genises': 'gen', 'geneses': 'gen', 'genisus': 'gen',
  // Exodus
  'exodus': 'exo', 'exod': 'exo', 'ex': 'exo', 'exo': 'exo',
  'exodous': 'exo', 'exodos': 'exo', 'exudus': 'exo',
  // Leviticus
  'leviticus': 'lev', 'lev': 'lev', 'lv': 'lev', 'levitcus': 'lev', 'leviticas': 'lev',
  // Numbers
  'numbers': 'num', 'num': 'num', 'nm': 'num', 'nu': 'num', 'numb': 'num',
  // Deuteronomy
  'deuteronomy': 'deu', 'deut': 'deu', 'dt': 'deu', 'deu': 'deu',
  'deuteronmy': 'deu', 'dueteronomy': 'deu', 'deutronomy': 'deu', 'deuteronamy': 'deu',
  // Joshua
  'joshua': 'jos', 'josh': 'jos', 'jos': 'jos', 'joshaua': 'jos',
  // Judges
  'judges': 'jdg', 'judg': 'jdg', 'jdg': 'jdg', 'jgs': 'jdg',
  // Ruth
  'ruth': 'rut', 'ru': 'rut', 'rut': 'rut',
  // 1 Samuel
  '1 samuel': '1sa', '1 sam': '1sa', '1samuel': '1sa', '1sam': '1sa', '1sa': '1sa',
  '1 samual': '1sa', '1samual': '1sa',
  // 2 Samuel
  '2 samuel': '2sa', '2 sam': '2sa', '2samuel': '2sa', '2sam': '2sa', '2sa': '2sa',
  '2 samual': '2sa', '2samual': '2sa',
  // 1 Kings
  '1 kings': '1ki', '1 kgs': '1ki', '1 king': '1ki', '1kings': '1ki', '1kgs': '1ki', '1ki': '1ki', '1k': '1ki',
  // 2 Kings
  '2 kings': '2ki', '2 kgs': '2ki', '2 king': '2ki', '2kings': '2ki', '2kgs': '2ki', '2ki': '2ki', '2k': '2ki',
  // 1 Chronicles
  '1 chronicles': '1ch', '1 chron': '1ch', '1chronicles': '1ch', '1chron': '1ch', '1 chr': '1ch', '1chr': '1ch', '1ch': '1ch',
  '1 chronicle': '1ch', '1 cronicles': '1ch',
  // 2 Chronicles
  '2 chronicles': '2ch', '2 chron': '2ch', '2chronicles': '2ch', '2chron': '2ch', '2 chr': '2ch', '2chr': '2ch', '2ch': '2ch',
  '2 chronicle': '2ch', '2 cronicles': '2ch',
  // Ezra
  'ezra': 'ezr', 'ezr': 'ezr',
  // Nehemiah
  'nehemiah': 'neh', 'neh': 'neh', 'nehemia': 'neh',
  // Esther
  'esther': 'est', 'est': 'est', 'esth': 'est',
  // Job
  'job': 'job', 'jb': 'job',
  // Psalms
  'psalms': 'psa', 'psalm': 'psa', 'ps': 'psa', 'psa': 'psa', 'pss': 'psa',
  'pslam': 'psa', 'pslams': 'psa', 'psam': 'psa', 'psams': 'psa',
  'salmo': 'psa', 'salmos': 'psa',
  // Proverbs
  'proverbs': 'pro', 'proverb': 'pro', 'prov': 'pro', 'prv': 'pro', 'pro': 'pro', 'pr': 'pro',
  // Ecclesiastes
  'ecclesiastes': 'ecc', 'eccl': 'ecc', 'ecc': 'ecc', 'eccles': 'ecc', 'ecclesiates': 'ecc',
  // Song of Solomon
  'song of solomon': 'sng', 'song of songs': 'sng', 'song': 'sng', 'sos': 'sng', 'sng': 'sng', 'cant': 'sng',
  // Isaiah
  'isaiah': 'isa', 'isa': 'isa', 'is': 'isa', 'isiah': 'isa', 'isaah': 'isa',
  // Jeremiah
  'jeremiah': 'jer', 'jer': 'jer', 'jeremia': 'jer', 'jerimiah': 'jer',
  // Lamentations
  'lamentations': 'lam', 'lamentation': 'lam', 'lam': 'lam',
  // Ezekiel
  'ezekiel': 'ezk', 'ezek': 'ezk', 'eze': 'ezk', 'ezk': 'ezk',
  'ezekial': 'ezk', 'ezekel': 'ezk', 'ezekyle': 'ezk',
  // Daniel
  'daniel': 'dan', 'dan': 'dan', 'dn': 'dan',
  // Hosea
  'hosea': 'hos', 'hos': 'hos',
  // Joel
  'joel': 'jol', 'jol': 'jol', 'jl': 'jol',
  // Amos
  'amos': 'amo', 'amo': 'amo', 'am': 'amo',
  // Obadiah
  'obadiah': 'oba', 'obad': 'oba', 'ob': 'oba', 'oba': 'oba',
  // Jonah
  'jonah': 'jon', 'jon': 'jon', 'jnh': 'jon',
  // Micah
  'micah': 'mic', 'mic': 'mic', 'mc': 'mic',
  // Nahum
  'nahum': 'nam', 'nah': 'nam', 'na': 'nam', 'nam': 'nam',
  // Habakkuk
  'habakkuk': 'hab', 'hab': 'hab', 'hb': 'hab', 'habakuk': 'hab', 'habbakuk': 'hab',
  // Zephaniah
  'zephaniah': 'zep', 'zeph': 'zep', 'zp': 'zep', 'zep': 'zep', 'zephania': 'zep',
  // Haggai
  'haggai': 'hag', 'hag': 'hag', 'hg': 'hag',
  // Zechariah
  'zechariah': 'zec', 'zech': 'zec', 'zc': 'zec', 'zec': 'zec', 'zachariah': 'zec', 'zecharia': 'zec',
  // Malachi
  'malachi': 'mal', 'mal': 'mal', 'ml': 'mal',
  // Matthew
  'matthew': 'mat', 'matt': 'mat', 'mt': 'mat', 'mat': 'mat',
  'mathew': 'mat', 'math': 'mat', 'mateo': 'mat',
  // Mark
  'mark': 'mrk', 'mrk': 'mrk', 'mk': 'mrk', 'marcos': 'mrk',
  // Luke
  'luke': 'luk', 'luk': 'luk', 'lk': 'luk', 'lucas': 'luk',
  // John (Gospel)
  'john': 'jhn', 'jn': 'jhn', 'jhn': 'jhn', 'joh': 'jhn', 'juan': 'jhn',
  // Acts
  'acts': 'act', 'act': 'act', 'ac': 'act', 'hechos': 'act',
  // Romans
  'romans': 'rom', 'roman': 'rom', 'rom': 'rom', 'rm': 'rom', 'romanos': 'rom',
  // 1 Corinthians
  '1 corinthians': '1co', '1 cor': '1co', '1corinthians': '1co', '1cor': '1co', '1co': '1co',
  '1 corinthans': '1co', '1corinthans': '1co', '1 corithians': '1co', '1corithians': '1co',
  '1 corithans': '1co', '1 corintians': '1co', '1 corinthian': '1co',
  // 2 Corinthians
  '2 corinthians': '2co', '2 cor': '2co', '2corinthians': '2co', '2cor': '2co', '2co': '2co',
  '2 corinthans': '2co', '2corinthans': '2co', '2 corithians': '2co', '2corithians': '2co',
  '2 corithans': '2co', '2 corintians': '2co', '2 corinthian': '2co',
  // Galatians
  'galatians': 'gal', 'galatian': 'gal', 'gal': 'gal', 'galations': 'gal', 'gallatians': 'gal',
  // Ephesians
  'ephesians': 'eph', 'ephesian': 'eph', 'eph': 'eph', 'ephisians': 'eph', 'ephesans': 'eph',
  // Philippians
  'philippians': 'php', 'philippian': 'php', 'phil': 'php', 'php': 'php',
  'phillipians': 'php', 'philipians': 'php', 'phillippians': 'php', 'philipian': 'php',
  // Colossians
  'colossians': 'col', 'colossian': 'col', 'col': 'col', 'colosians': 'col', 'collossians': 'col',
  // 1 Thessalonians
  '1 thessalonians': '1th', '1 thess': '1th', '1thessalonians': '1th', '1thess': '1th', '1th': '1th',
  '1 thessolonians': '1th', '1thessolonians': '1th', '1 thesalonians': '1th', '1 thessalonian': '1th', '1 thes': '1th',
  // 2 Thessalonians
  '2 thessalonians': '2th', '2 thess': '2th', '2thessalonians': '2th', '2thess': '2th', '2th': '2th',
  '2 thessolonians': '2th', '2thessolonians': '2th', '2 thesalonians': '2th', '2 thessalonian': '2th', '2 thes': '2th',
  // 1 Timothy
  '1 timothy': '1ti', '1 tim': '1ti', '1timothy': '1ti', '1tim': '1ti', '1ti': '1ti', '1 timmothy': '1ti',
  // 2 Timothy
  '2 timothy': '2ti', '2 tim': '2ti', '2timothy': '2ti', '2tim': '2ti', '2ti': '2ti', '2 timmothy': '2ti',
  // Titus
  'titus': 'tit', 'tit': 'tit',
  // Philemon
  'philemon': 'phm', 'philem': 'phm', 'phm': 'phm', 'phlm': 'phm', 'phillimon': 'phm',
  // Hebrews
  'hebrews': 'heb', 'hebrew': 'heb', 'heb': 'heb',
  // James
  'james': 'jas', 'jas': 'jas', 'jm': 'jas', 'jam': 'jas',
  // 1 Peter
  '1 peter': '1pe', '1 pet': '1pe', '1peter': '1pe', '1pet': '1pe', '1pe': '1pe', '1pt': '1pe',
  // 2 Peter
  '2 peter': '2pe', '2 pet': '2pe', '2peter': '2pe', '2pet': '2pe', '2pe': '2pe', '2pt': '2pe',
  // 1 John
  '1 john': '1jn', '1john': '1jn', '1jn': '1jn', '1 jn': '1jn', '1 joh': '1jn',
  // 2 John
  '2 john': '2jn', '2john': '2jn', '2jn': '2jn', '2 jn': '2jn', '2 joh': '2jn',
  // 3 John
  '3 john': '3jn', '3john': '3jn', '3jn': '3jn', '3 jn': '3jn', '3 joh': '3jn',
  // Jude
  'jude': 'jud', 'jud': 'jud', 'jd': 'jud',
  // Revelation
  'revelation': 'rev', 'revelations': 'rev', 'rev': 'rev', 'rv': 'rev', 'apocalypse': 'rev',
  'revealation': 'rev', 'revealations': 'rev', 'revelaton': 'rev', 'revalation': 'rev',
  'apocalipsis': 'rev',
}

function normalizeBookName(rawBook: string): string {
  // Collapse whitespace, remove trailing abbreviation periods ("1 Cor." -> "1 cor")
  let book = rawBook
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Normalize leading ordinals ("1st", "first", "i", "2nd", "second", "ii", "3rd", "third", "iii")
  book = book
    .replace(/^(?:1st|first|i)\s+(?=[a-z])/, '1 ')
    .replace(/^(?:2nd|second|ii)\s+(?=[a-z])/, '2 ')
    .replace(/^(?:3rd|third|iii)\s+(?=[a-z])/, '3 ')

  return book
}

function preprocessInput(input: string): string {
  // Normalize unicode dashes/spaces and collapse whitespace
  let s = input
    .replace(/[\u2013\u2014\u2212]/g, '-') // en-dash, em-dash, unicode minus -> ASCII hyphen
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

  // Strip a harmless trailing period (e.g., "John 3:16.")
  s = s.replace(/\.+$/, '').trim()

  // Strip trailing translation suffix when preceded by a digit (e.g., "Hebrews Chapter 10:18-23 NIV")
  if (/\d/.test(s)) {
    const stripped = s.replace(TRANSLATION_SUFFIX_RE, '').trim()
    if (stripped.length > 0) {
      s = stripped
    }
  }

  // Separate fused period before chapter digits or "ch." (e.g., "Matt.24:28" -> "Matt 24:28", "1 Cor. 13:4" -> "1 Cor 13:4")
  s = s.replace(/([a-zA-Z])\.\s*(?=\d|\b(?:chapter|chap|ch)\b)/gi, '$1 ')

  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Attempts to parse a verse reference from user input and validates canonical
 * chapter/verse bounds against the 66-book Bible corpus.
 * Returns null if the input doesn't look like a valid verse reference.
 *
 * Supported formats include:
 * - "John 3:16", "1 Corinthians 10:13", "1 Peter 4:7-11"
 * - "Genesis 32 : 28" (spaces around colon), "joel 2;21-27" (semicolon)
 * - "1 Cor. 13:4-7", "Matt.24:28" (abbreviations with periods)
 * - "Luke 24:13–35" (en/em dashes), "Acts chapter 2: 42 to 47"
 * - "Hebrews Chapter 10:18-23 NIV" ("Chapter"/"ch." words + translation suffix)
 * - "Matthew chapter 12 verse 38" ("verse"/"v." words)
 * - Common book-name typos ("Mathew 28", "Pslam 23", "Revelations 21:4", etc.)
 */
export function parseVerseReference(input: string): ParsedVerseReference | null {
  if (!input || input.trim().length === 0) return null

  const normalized = preprocessInput(input).toLowerCase()
  if (!normalized || !/\d/.test(normalized)) return null

  // Match:
  //   1. bookPart (non-greedy)
  //   2. optional chapter keyword ("chapter", "chap.", "ch.")
  //   3. chapter number
  //   4. optional verse part in one of three clean forms:
  //      a) separator (: or ; or tight comma) + verseStart + optional range (- or "to") + verseEnd
  //      b) explicit verse keyword ("verse", "verses", "v.", "vs.", "vv.") + verseStart + optional range
  //      c) when explicit chapter keyword was used: space + verseStart + range ("Acts chapter 2 42 to 47")
  const match = normalized.match(
    /^(.+?)(?:\s+(chapter|chap\.?|ch\.?))?\s+(\d+)(?:(?:\s*[:;]\s*|,|\s+(?:verses?|vv\.?|vs\.?|v\.?)\s*)(\d+)(?:\s*(?:-|\bto\b)\s*(\d+))?|\s+(\d+)\s*(?:-|\bto\b)\s*(\d+))?$/
  )

  if (!match) return null

  const [
    ,
    rawBookPart,
    chapterWord,
    chapterStr,
    verseStartA,
    verseEndA,
    verseStartSpaced,
    verseEndSpaced,
  ] = match

  if (!rawBookPart || !chapterStr) return null

  // Disallow space-separated "book ch vs-ve" unless an explicit "chapter" word was present
  // (prevents false parses on patterns like "Acts 42 to 47" or ambiguous multi-number queries)
  if (verseStartSpaced && !chapterWord) return null

  const verseStartStr = verseStartA ?? verseStartSpaced
  const verseEndStr = verseEndA ?? verseEndSpaced

  const normalizedBook = normalizeBookName(rawBookPart)
  const bookKey = BOOK_ALIASES[normalizedBook]
  if (!bookKey) return null

  const bookFullName = BOOK_MAPPING[bookKey]
  if (!bookFullName) return null

  const chapter = parseInt(chapterStr, 10)
  const maxChapter = getBookChapterCount(bookKey)
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > maxChapter) {
    return null
  }

  const maxVerse = getChapterVerseCount(bookKey, chapter)
  const result: ParsedVerseReference = {
    book: bookKey,
    bookFullName,
    chapter,
  }

  if (verseStartStr !== undefined) {
    const verseStart = parseInt(verseStartStr, 10)
    if (!Number.isInteger(verseStart) || verseStart < 1 || verseStart > maxVerse) {
      return null
    }
    result.verseStart = verseStart

    if (verseEndStr !== undefined) {
      const verseEnd = parseInt(verseEndStr, 10)
      if (
        !Number.isInteger(verseEnd) ||
        verseEnd < verseStart ||
        verseEnd > maxVerse
      ) {
        return null
      }
      result.verseEnd = verseEnd
    }
  }

  return result
}

/**
 * Checks if the input is a valid Bible verse reference.
 */
export function looksLikeVerseReference(input: string): boolean {
  return parseVerseReference(input) !== null
}
