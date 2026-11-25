// Bible book mappings and constants

export const BOOK_MAPPING: Record<string, string> = {
  gen: "Genesis",
  exo: "Exodus",
  lev: "Leviticus",
  num: "Numbers",
  deu: "Deuteronomy",
  jos: "Joshua",
  jdg: "Judges",
  rut: "Ruth",
  "1sa": "1 Samuel",
  "2sa": "2 Samuel",
  "1ki": "1 Kings",
  "2ki": "2 Kings",
  "1ch": "1 Chronicles",
  "2ch": "2 Chronicles",
  ezr: "Ezra",
  neh: "Nehemiah",
  est: "Esther",
  job: "Job",
  psa: "Psalms",
  pro: "Proverbs",
  ecc: "Ecclesiastes",
  sng: "Song of Solomon",
  isa: "Isaiah",
  jer: "Jeremiah",
  lam: "Lamentations",
  ezk: "Ezekiel",
  dan: "Daniel",
  hos: "Hosea",
  jol: "Joel",
  amo: "Amos",
  oba: "Obadiah",
  jon: "Jonah",
  mic: "Micah",
  nam: "Nahum",
  hab: "Habakkuk",
  zep: "Zephaniah",
  hag: "Haggai",
  zec: "Zechariah",
  mal: "Malachi",
  mat: "Matthew",
  mrk: "Mark",
  luk: "Luke",
  jhn: "John",
  act: "Acts",
  rom: "Romans",
  "1co": "1 Corinthians",
  "2co": "2 Corinthians",
  gal: "Galatians",
  eph: "Ephesians",
  php: "Philippians",
  col: "Colossians",
  "1th": "1 Thessalonians",
  "2th": "2 Thessalonians",
  "1ti": "1 Timothy",
  "2ti": "2 Timothy",
  tit: "Titus",
  phm: "Philemon",
  heb: "Hebrews",
  jas: "James",
  "1pe": "1 Peter",
  "2pe": "2 Peter",
  "1jn": "1 John",
  "2jn": "2 John",
  "3jn": "3 John",
  jud: "Jude",
  rev: "Revelation",
}

export const BOOKS = Object.keys(BOOK_MAPPING)

// Old Testament: first 39 books, New Testament: last 27 books
export const OLD_TESTAMENT_BOOKS = BOOKS.slice(0, 39)
export const NEW_TESTAMENT_BOOKS = BOOKS.slice(39)

export const SEARCH_SUGGESTIONS = [
  "What did Jesus say about eternal life?",
]

export const STOPWORDS = [
  'the', 'and', 'for', 'are', 'but', 'with', 'that', 'from', 'this', 'they',
  'their', 'them', 'will', 'your', 'have', 'into', 'these', 'when', 'shall',
  'upon', 'unto', 'were', 'which', 'would', 'could', 'there', 'where', 'also',
  'said', 'those', 'then', 'when', 'where', 'why', 'how', 'all', 'any', 'some',
  'things', 'know', 'because'
]

export const SENTIMENT_EXTRAS = {
  'love': 2,
  'blessed': 2,
  'faith': 2,
  'peace': 2,
  'joy': 2,
  'sin': -2,
  'evil': -2,
  'sorrow': -2,
  'wrath': -2,
}
