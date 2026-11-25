// Builds Priority #3 static assets via Anthropic Message Batches API (claude-opus-5-5, effort: xhigh):
//   1. tests/eval-150.json — 150 stratified sacred-text search & grounding benchmark queries
//   2. public/data/cross-references.json — Verified canonical Synoptic, OT-in-NT, OT-internal & thematic cross-references
//
// Usage:
//   node util/build-eval-and-xrefs.mjs --submit --work-dir <dir> --env-file <env>
//   node util/build-eval-and-xrefs.mjs --status --work-dir <dir> --env-file <env>
//   node util/build-eval-and-xrefs.mjs --assemble --work-dir <dir> --env-file <env>
//   node util/build-eval-and-xrefs.mjs --validate
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOK_MAPPING, BOOKS } from "../lib/bible-constants.ts";
import { parseVplXml } from "../lib/corpus-chunker.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_FILE = "engwebp_vpl.xml";
export const EVAL_OUTPUT = path.join("tests", "eval-150.json");
export const XREF_OUTPUT = path.join("public", "data", "cross-references.json");
const BATCHES_URL = "https://api.anthropic.com/v1/messages/batches";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-opus-5-5";
const EFFORT = "high";

const BATCH_IN_PER_M = 2.0;
const BATCH_OUT_PER_M = 10.0;

const VALID_BOOK_CODES = new Set(BOOKS);
const BOOK_CODE_LIST = BOOKS.map((code) => `${code}=${BOOK_MAPPING[code]}`).join(", ");

const EVAL_SYSTEM = `You are a biblical scholar and IR evaluation designer building a gold-standard 150-query sacred-text retrieval and grounding benchmark for the Biblos Bible search app (canonical World English Bible, 66 Protestant books).

CRITICAL RULES:
1. Use ONLY exact lowercase 3-letter canonical book codes from this list: ${BOOK_CODE_LIST}.
2. Every biblical target MUST specify real, verified book, chapter, verseStart, and verseEnd integers that actually exist in the Protestant 66-book Bible (e.g., {"book":"luk","chapter":15,"verseStart":11,"verseEnd":32}). Remember WEB Romans 16 ends at verse 25 (doxology is in Rom 14:24-26 in WEB, though Rom 16:1-24 are identical).
3. Make every query realistic, distinct, and non-duplicative — written the way real Bible seekers, students, and pastors actually search.
4. For abstention/non-biblical queries, set shouldAbstain = true, expectedPassages = [], and explain clearly in abstentionReason why the phrase is non-biblical, misquoted, or out-of-domain (referencing any closely related real verse in notes only if it's a common misattribution, e.g., 1 Tim 6:10 for "money is the root of all evil").
5. For speaker/polarity trap queries, set requiresSpeakerCaution = true and clearly note the antagonist/rebuked/non-endorsed speaker in notes so search evaluators verify the system does NOT attribute Satan's, Job's friends', Lamech's, or the fool's words to God.

Return ONLY valid JSON matching the schema.`;

const EVAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["queries"],
  properties: {
    queries: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "category",
          "query",
          "shouldAbstain",
          "requiresSpeakerCaution",
          "expectedPassages",
          "notes",
        ],
        properties: {
          id: { type: "string" },
          category: { type: "string" },
          query: { type: "string" },
          shouldAbstain: { type: "boolean" },
          requiresSpeakerCaution: { type: "boolean" },
          expectedPassages: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["book", "chapter", "verseStart", "verseEnd"],
              properties: {
                book: { type: "string" },
                chapter: { type: "integer" },
                verseStart: { type: "integer" },
                verseEnd: { type: "integer" },
              },
            },
          },
          notes: { type: "string" },
        },
      },
    },
  },
};

const XREF_SYSTEM = `You are a biblical scholar building a verified, high-precision canonical cross-reference and parallel-passage map for the Biblos Bible app (66 Protestant books, World English Bible).

CRITICAL RULES:
1. Use ONLY exact lowercase 3-letter canonical book codes from this list: ${BOOK_CODE_LIST}.
2. Every passage reference MUST have exact, verified integer chapter, verseStart, and verseEnd bounds that exist in the Protestant Bible (no invented verses, no out-of-range verse numbers; note WEB Romans 16 ends at v25).
3. Prioritize historically grounded, widely accepted scholarly parallels: Synoptic Gospel parallels, direct OT quotations & allusions in the NT, OT historical/poetic parallels (e.g., Samuel/Kings ↔ Chronicles, Psalms ↔ narrative superscriptions), and major canonical covenant/typological connections.
4. Keep descriptions concise, reverent, and strictly faithful to the canonical texts (1–2 sentences).

Return ONLY valid JSON matching the schema.`;

const XREF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "title", "description", "passages"],
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: ["synoptic_parallel", "ot_in_nt", "ot_parallel", "nt_parallel", "thematic_typology"],
          },
          title: { type: "string" },
          description: { type: "string" },
          passages: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["book", "chapter", "verseStart", "verseEnd", "role"],
              properties: {
                book: { type: "string" },
                chapter: { type: "integer" },
                verseStart: { type: "integer" },
                verseEnd: { type: "integer" },
                role: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

export const EVAL_BUCKETS = [
  {
    id: "eval_01_paraphrased",
    category: "paraphrased_memory",
    count: 15,
    prompt:
      "Generate exactly 15 realistic 'paraphrased_memory' queries (IDs PM-01..PM-15): half-remembered or paraphrased Bible verses/stories written in natural everyday speech (e.g., Samson with the jawbone of a donkey, faith without works is dead, iron sharpens iron, not by might nor by power, weeping may last for the night, plans to prosper you, camel through the eye of a needle, armor of God, etc.). Each must have 1–2 exact verified expectedPassages, shouldAbstain=false, requiresSpeakerCaution=false.",
  },
  {
    id: "eval_02_pericopes",
    category: "narrative_pericopes",
    count: 15,
    prompt:
      "Generate exactly 15 realistic 'narrative_pericopes' queries (IDs NP-01..NP-15): traditional named stories, parables, and episodes whose popular title does NOT appear verbatim in the text — MUST include Prodigal Son (both long and short forms like 'lessons from the Prodigal Son'), Good Samaritan, Road to Emmaus, Elijah under the broom/juniper tree, Beatitudes, Sermon on the Mount, Daniel in the lions' den, Feeding the 5,000, Woman at the well, Raising of Lazarus, Zacchaeus, Fiery furnace, Jonah and the great fish, David and Goliath, Burning bush. Each must have verified expectedPassages.",
  },
  {
    id: "eval_03_translation_bridge",
    category: "translation_bridge",
    count: 15,
    prompt:
      "Generate exactly 15 realistic 'translation_bridge' queries (IDs TB-01..TB-15) testing KJV/ESV/NIV wording that differs from World English Bible (WEB) wording — MUST include 'quick to hear and slow to speak' (James 1:19, WEB 'swift to hear'), 'charity suffers long' (1 Cor 13:4, WEB 'love is patient'), 'juniper tree' (1 Kings 19:4, WEB 'broom tree'), 'through a glass darkly' (1 Cor 13:12), 'valley of the shadow of death' (Psalm 23:4), 'still small voice' (1 Kings 19:12), 'suffer the little children' (Mark 10:14), 'be still and know that I am God' (Psalm 46:10), 'vanity of vanities' (Eccl 1:2), 'peace that passes all understanding' (Phil 4:7), 'cast your bread upon the waters' (Eccl 11:1), 'thorn in the flesh' (2 Cor 12:7), 'living sacrifice' (Rom 12:1), 'fearfully and wonderfully made' (Psalm 139:14), 'walk by faith not by sight' (2 Cor 5:7).",
  },
  {
    id: "eval_04_themes",
    category: "thematic_doctrinal",
    count: 15,
    prompt:
      "Generate exactly 15 realistic 'thematic_doctrinal' queries (IDs TD-01..TD-15): theological and pastoral questions seekers ask (MUST include 'What did Jesus say about eternal life?', plus anxiety/worry, forgiveness, grief/comfort, humility/servant leadership, grace through faith, prayer, generosity/stewardship, wisdom, justice for the poor, marriage/love, repentance, spiritual warfare, hope in suffering, creation/stewardship). Each must list 1–3 core canonical expectedPassages.",
  },
  {
    id: "eval_05_book_author",
    category: "book_author_constraints",
    count: 15,
    prompt:
      "Generate exactly 15 realistic 'book_author_constraints' queries (IDs BA-01..BA-15) that explicitly name a Bible book, author, or corpus — MUST include 'What does Paul say about love in his letters to the Corinthians?' (1co 13:1-13), plus queries naming James on the tongue (jas 3), Isaiah on the suffering servant (isa 53), Hebrews on faith (heb 11), Psalms on God as refuge (psa 46), Romans on nothing separating us from God's love (rom 8:31-39), Galatians on fruit of the Spirit (gal 5:22-23), Ephesians on armor of God (eph 6:10-18), Proverbs on trusting the Lord (pro 3:5-6), Peter on suffering/humility (1pe 5:6-10), Revelation on no more tears (rev 21:1-5), Jeremiah on the new covenant (jer 31:31-34), Micah on doing justice (mic 6:8), John on the Word made flesh (jhn 1:1-14), Ecclesiastes on a time for everything (ecc 3:1-8).",
  },
  {
    id: "eval_06_speaker_traps",
    category: "speaker_polarity_traps",
    count: 15,
    prompt:
      "Generate exactly 15 'speaker_polarity_traps' queries (IDs SP-01..SP-15) where naive Bible search risks quoting an antagonist, demon, serpent, or divinely rebuked human counselor as if it were God's endorsement! MUST set requiresSpeakerCaution=true and shouldAbstain=false. Include: Job 4/8/11/15/22 (Eliphaz, Bildad, Zophar rebuked in Job 42:7 — e.g. 'though your beginning was small your latter end will greatly increase' Job 8:7, 'man is born to trouble as sparks fly upward' Job 5:7, 'acquaint now yourself with him and be at peace' Job 22:21), Elihu (Job 32-37), Satan quoting Psalm 91 to Jesus (Matt 4:6 / Luke 4:10-11), Satan offering kingdoms of the world (Luke 4:5-7), Demon shouting 'Holy One of God' (Luke 4:33-35), Serpent's 'you will not surely die / you will be like God' (Gen 3:4-5), Lamech's boastful vengeance song (Gen 4:23-24), 'There is no God' spoken by the fool (Psalm 14:1), 'Let us eat and drink for tomorrow we die' (1 Cor 15:32), Caiaphas 'better one man die' (John 11:49-50), Rabshakeh mocking trust in the LORD (2 Kings 18:28-35), Hananiah's false peace prophecy (Jer 28:1-4), Pharisees accusing Jesus of casting out demons by Beelzebul (Matt 12:24).",
  },
  {
    id: "eval_07_messy_refs",
    category: "messy_references",
    count: 15,
    prompt:
      "Generate exactly 15 'messy_references' queries (IDs MR-01..MR-15) testing informal, abbreviated, ordinal, or mildly messy Bible reference formats (e.g., 'jn 3:16', '1 cor 13:4-7', 'ps 23', '2nd tim 3:16-17', 'gen 1:1-3', 'matt 5:3-10', 'rom 8 28', '1st john 4:8', 'phil 4:6-7', 'eph 2:8-9', 'isa 40:31', 'prov 3:5-6', 'phlm 1:15-16', 'rev 21:4', 'song of songs 8:6-7'). Each must have exact expectedPassages, shouldAbstain=false, requiresSpeakerCaution=false.",
  },
  {
    id: "eval_08_abstention",
    category: "non_biblical_abstention",
    count: 20,
    prompt:
      "Generate exactly 20 'non_biblical_abstention' queries (IDs AB-01..AB-20) where shouldAbstain=true and expectedPassages=[]. Include 10 famous non-biblical or misattributed sayings people wrongly think are in the Bible ('God helps those who help themselves', 'Cleanliness is next to godliness', 'God works in mysterious ways', 'This too shall pass', 'Hate the sin love the sinner', 'To thine own self be true', 'God will never give you more than you can handle' [misquote of 1 Cor 10:13], 'Money is the root of all evil' [misquote of 1 Tim 6:10], 'The lion shall lie down with the lamb' [misquote of Isa 11:6], 'Moderation in all things') AND 10 purely out-of-domain non-biblical queries ('What voltage does USB-C Power Delivery use?', 'How do I reset my Wi-Fi password?', 'Kubernetes pod CrashLoopBackOff', 'Best sourdough bread hydration ratio', 'How to change brake pads on a Honda Civic', 'Python asyncio event loop closed error', 'What is the capital of Mongolia?', 'Tax deduction rules for Roth IRA contributions', 'Next.js App Router dynamic segment caching', 'How to treat poison ivy rash at home'). Explain clearly in notes.",
  },
  {
    id: "eval_09_synthesis",
    category: "multi_passage_synthesis",
    count: 15,
    prompt:
      "Generate exactly 15 'multi_passage_synthesis' queries (IDs MS-01..MS-15) that legitimately span 2–4 distinct canonical passages (e.g., 'What did Jesus teach about prayer?', 'How does the Bible describe God as a shepherd?', 'Where does Scripture talk about welcoming the stranger and caring for orphans and widows?', 'What are the I AM statements of Jesus in John?', 'How do the Gospels describe the Last Supper?', 'What does the New Testament teach about the resurrection of the dead?', 'How does Scripture connect Melchizedek to Christ?', 'Where does the Bible teach about fasting?', 'What does Scripture say about Sabbath rest?', 'How do OT and NT describe the New Covenant?', 'What does the Bible say about spiritual gifts in the church?', 'What did Jesus teach about wealth and serving two masters?', 'Where does Scripture speak of God's faithfulness in exile and return?', 'What does the Bible teach about baptism?', 'How does Scripture describe the Beatitudes and blessings of the kingdom?'). Each must list 2–3 exact verified expectedPassages.",
  },
  {
    id: "eval_10_rare_entities",
    category: "rare_entity_names",
    count: 10,
    prompt:
      "Generate exactly 10 'rare_entity_names' queries (IDs RE-01..RE-10) involving distinctive minor biblical people, places, or objects — MUST include 'Where is the slave Onesimus welcomed back as a brother?' (phm 1:10-16), plus Jethro advising Moses (exo 18:13-27), Mephibosheth eating at David's table (2sa 9:1-13), Balaam's donkey speaking (num 22:21-35), Ehud the left-handed judge (jdg 3:15-26), Naaman healed of leprosy in the Jordan (2ki 5:1-14), Tabitha/Dorcas raised by Peter (act 9:36-42), Lydia seller of purple in Philippi (act 16:13-15), Priscilla and Aquila teaching Apollos (act 18:24-28), and Melchizedek blessing Abram (gen 14:18-20).",
  },
];

export const XREF_BUCKETS = [
  {
    id: "xref_01_synoptic_early",
    prompt:
      "Generate 25 verified canonical 'synoptic_parallel' cross-reference entries (IDs SYN-01..SYN-25) covering the Nativity/Infancy, John the Baptist, Baptism of Jesus, Temptation of Jesus, Call of the First Disciples, Sermon on the Mount/Plain & Beatitudes, Lord's Prayer, Healing of the Leper, Paralytic lowered through the roof, Call of Matthew/Levi, Fasting & Wineskins, Lord of the Sabbath, and Calling the Twelve. Include John parallels where canonical (e.g. John the Baptist witness, Cleansing of Temple). Verify every chapter and verse range.",
  },
  {
    id: "xref_02_synoptic_mid",
    prompt:
      "Generate 25 verified canonical 'synoptic_parallel' cross-reference entries (IDs SYN-26..SYN-50) covering the Parables & Miracles: Sower, Mustard Seed, Calming the Storm, Gerasene Demoniac, Jairus's Daughter & Hemorrhaging Woman, Sending the Twelve, Death of John the Baptist, Feeding the 5,000, Walking on Water, Syrophoenician/Canaanite Woman, Peter's Confession at Caesarea Philippi, Transfiguration, Boy with an Unclean Spirit, Who Is the Greatest, Little Children Blessed, Rich Young Ruler, Blind Bartimaeus/Jericho, Parable of the Wicked Tenants, Paying Taxes to Caesar, and Greatest Commandment.",
  },
  {
    id: "xref_03_synoptic_passion",
    prompt:
      "Generate 25 verified canonical 'synoptic_parallel' cross-reference entries (IDs SYN-51..SYN-75) covering Passion Week through Ascension across all four Gospels: Triumphal Entry, Cleansing of the Temple, Widow's Mite, Olivet Discourse, Anointing at Bethany, Judas's Betrayal, Last Supper / Institution of the Lord's Supper, Prediction of Peter's Denial, Gethsemane, Arrest of Jesus, Trial before the Sanhedrin, Peter's Three Denials, Trial before Pilate, Barabbas, Crucifixion, Darkness & Torn Temple Curtain, Burial by Joseph of Arimathea, Empty Tomb, Resurrection Appearances, and Great Commission.",
  },
  {
    id: "xref_04_ot_in_nt_gospels",
    prompt:
      "Generate 30 verified canonical 'ot_in_nt' cross-reference entries (IDs OTNT-01..OTNT-30) covering major Old Testament quotations, prophecies, and direct allusions in Matthew, Mark, Luke, and John (e.g., Isa 7:14 -> Mat 1:23, Mic 5:2 -> Mat 2:6, Hos 11:1 -> Mat 2:15, Isa 40:3 -> Mat 3:3/Mrk 1:3/Luk 3:4/Jhn 1:23, Deut 8:3 & 6:13,16 & Psa 91:11-12 -> Mat 4/Luk 4, Isa 61:1-2 -> Luk 4:18-19, Isa 6:9-10 -> Mat 13:14-15, Psa 118:22-23 -> Mat 21:42, Zech 9:9 -> Mat 21:5/Jhn 12:15, Psa 110:1 -> Mat 22:44, Deut 6:5 & Lev 19:18 -> Mat 22:37-39, Zech 13:7 -> Mat 26:31, Psa 22:1,18 -> Mat 27:46/Jhn 19:24, Psa 31:5 -> Luk 23:46, Num 21:8-9 -> Jhn 3:14, Exod 12:46/Psa 34:20 & Zech 12:10 -> Jhn 19:36-37, Isa 53:1 -> Jhn 12:38, etc.).",
  },
  {
    id: "xref_05_ot_in_nt_acts_romans",
    prompt:
      "Generate 25 verified canonical 'ot_in_nt' cross-reference entries (IDs OTNT-31..OTNT-55) covering major Old Testament quotations and allusions in Acts and Romans (e.g., Joel 2:28-32 -> Act 2:17-21, Psa 16:8-11 -> Act 2:25-28 & 13:35, Psa 110:1 -> Act 2:34-35, Deut 18:15-19 -> Act 3:22-23, Psa 2:1-2 -> Act 4:25-26, Isa 53:7-8 -> Act 8:32-33, Psa 2:7 -> Act 13:33, Amos 9:11-12 -> Act 15:16-17, Hab 2:4 -> Rom 1:17, Gen 15:6 -> Rom 4:3, Psa 32:1-2 -> Rom 4:7-8, Psa 44:22 -> Rom 8:36, Exod 33:19 -> Rom 9:15, Hos 1:10 & 2:23 -> Rom 9:25-26, Isa 28:16 -> Rom 9:33, Deut 30:12-14 -> Rom 10:6-8, Isa 52:7 -> Rom 10:15, 1Ki 19:18 -> Rom 11:4, Deut 32:35 & Pro 25:21-22 -> Rom 12:19-20, Isa 45:23 -> Rom 14:11, etc.).",
  },
  {
    id: "xref_06_ot_in_nt_epistles_rev",
    prompt:
      "Generate 30 verified canonical 'ot_in_nt' cross-reference entries (IDs OTNT-56..OTNT-85) covering major OT quotations and allusions in 1-2 Corinthians, Galatians, Ephesians, Philippians, Hebrews, James, 1-2 Peter, and Revelation (e.g., Isa 29:14 -> 1Co 1:19, Isa 25:8 & Hos 13:14 -> 1Co 15:54-55, Gen 15:6 & Hab 2:4 & Deut 21:23 -> Gal 3, Psa 68:18 -> Eph 4:8, Gen 2:24 -> Eph 5:31, Isa 45:23 -> Php 2:10-11, Psa 2:7 & 110:1,4 -> Heb 1 & 5 & 7, Psa 8:4-6 -> Heb 2:6-8, Psa 95:7-11 -> Heb 3-4, Gen 14:18-20 -> Heb 7:1-3, Jer 31:31-34 -> Heb 8:8-12, Psa 40:6-8 -> Heb 10:5-7, Hab 2:3-4 -> Heb 10:37-38, Lev 11:44 -> 1Pe 1:16, Isa 40:6-8 -> 1Pe 1:24-25, Exod 19:5-6 -> 1Pe 2:9, Isa 53:4-9 -> 1Pe 2:22-25, Dan 7:13-14 -> Rev 1:7 & 14:14, Gen 2-3 & Ezek 47 -> Rev 21-22, Isa 65:17 -> Rev 21:1, etc.).",
  },
  {
    id: "xref_07_ot_parallels",
    prompt:
      "Generate 25 verified canonical 'ot_parallel' cross-reference entries (IDs OTP-01..OTP-25) covering major Old Testament internal parallels (e.g., Ten Commandments Exod 20:1-17 ↔ Deut 5:6-21; Song of David 2 Sam 22 ↔ Psalm 18; The Fool Says No God Psalm 14 ↔ Psalm 53; Swords into Plowshares Isa 2:2-4 ↔ Mic 4:1-3; Hezekiah & Sennacherib 2 Kings 18-20 ↔ Isa 36-39 ↔ 2 Chr 32; Davidic Covenant 2 Sam 7 ↔ 1 Chr 17; Ark Brought to Jerusalem 2 Sam 6 ↔ 1 Chr 13 & 15-16; Solomon's Temple Dedication 1 Kings 8 ↔ 2 Chr 6-7; Solomon's Wisdom 1 Kings 3 ↔ 2 Chr 1; Fall of Jerusalem 2 Kings 25 ↔ Jer 52 ↔ 2 Chr 36; David's Psalms with historical narrative contexts like 2 Sam 11-12 ↔ Psa 51, 1 Sam 21 ↔ Psa 34, 2 Sam 15 ↔ Psa 3, etc.).",
  },
  {
    id: "xref_08_covenant_typology",
    prompt:
      "Generate 25 verified canonical 'thematic_typology' and 'nt_parallel' cross-reference entries (IDs TYP-01..TYP-25) tracing major biblical-theological arcs across Old and New Testaments (e.g., Creation & New Creation Gen 1 / Jhn 1 / 2Co 5 / Rev 21; Passover Lamb & Christ Exod 12 / Isa 53 / Jhn 1:29 / 1Co 5:7 / Rev 5; Divine Shepherd Psa 23 / Ezek 34 / Jhn 10 / 1Pe 5; Bread from Heaven Exod 16 / Jhn 6; Living Water Exod 17 / Isa 55 / Jhn 4 & 7 / Rev 22; Suffering Servant Isa 52-53 / Php 2 / 1Pe 2; New Heart & Spirit Jer 31 / Ezek 36 / 2Co 3 / Heb 8; Faith & Righteousness Gen 15 / Hab 2 / Rom 4 / Gal 3 / Jas 2; Armor of God Isa 59 / Eph 6; Love Commandment & Fulfillment Deut 6 / Lev 19 / Mat 22 / Rom 13 / 1Co 13 / 1Jn 4; Resurrection Hope Job 19 / Dan 12 / Ezek 37 / Jhn 11 / 1Co 15; Beatitudes & Blessing Psa 1 / Jer 17 / Mat 5 / Luk 6; etc.).",
  },
];

function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : fallback;
}

function loadApiKey(envFile) {
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY.trim().replace(/^["']|["']$/g, "").replace(/\\n$/g, "").trim();
  }
  if (envFile && fs.existsSync(envFile)) {
    const raw = fs.readFileSync(envFile, "utf8");
    const m = raw.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "").replace(/\\n$/g, "").trim();
  }
  throw new Error("ANTHROPIC_API_KEY not found");
}

function calcBatchCost(usage) {
  const inp = usage.input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  return (
    (inp * BATCH_IN_PER_M +
      cacheCreate * BATCH_IN_PER_M * 1.25 +
      cacheRead * BATCH_IN_PER_M * 0.1 +
      out * BATCH_OUT_PER_M) /
    1_000_000
  );
}

function isValidPassageRef(chaptersMap, p) {
  if (!p || typeof p.book !== "string") return false;
  const book = p.book.toLowerCase();
  if (!VALID_BOOK_CODES.has(book)) return false;
  const ch = Number(p.chapter);
  const vs = Number(p.verseStart);
  const ve = Number(p.verseEnd);
  const verses = chaptersMap.get(`${book}:${ch}`);
  if (!verses) return false;
  const maxV = verses[verses.length - 1].verse;
  return Number.isInteger(vs) && Number.isInteger(ve) && vs >= 1 && ve >= vs && ve <= maxV;
}

async function submitBatch(apiKey, workDir, onlyIds = null) {
  const requests = [
    ...EVAL_BUCKETS.filter((b) => !onlyIds || onlyIds.has(b.id)).map((b) => ({
      custom_id: b.id,
      params: {
        model: MODEL,
        max_tokens: 28000,
        system: [{ type: "text", text: EVAL_SYSTEM, cache_control: { type: "ephemeral" } }],
        output_config: {
          effort: EFFORT,
          format: { type: "json_schema", schema: EVAL_SCHEMA },
        },
        messages: [{ role: "user", content: b.prompt }],
      },
    })),
    ...XREF_BUCKETS.filter((b) => !onlyIds || onlyIds.has(b.id)).map((b) => ({
      custom_id: b.id,
      params: {
        model: MODEL,
        max_tokens: 28000,
        system: [{ type: "text", text: XREF_SYSTEM, cache_control: { type: "ephemeral" } }],
        output_config: {
          effort: EFFORT,
          format: { type: "json_schema", schema: XREF_SCHEMA },
        },
        messages: [{ role: "user", content: b.prompt }],
      },
    })),
  ];

  console.log(`Submitting Eval-150 + Cross-References batch: ${requests.length} requests (model=${MODEL}, effort=${EFFORT})...`);
  const res = await fetch(BATCHES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ requests }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Batch submit failed ${res.status}: ${text.slice(0, 600)}`);
  const batch = JSON.parse(text);

  fs.mkdirSync(workDir, { recursive: true });
  const metaPath = path.join(workDir, "batch3-meta.json");
  const history = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : { batches: [] };
  history.batches.push({
    id: batch.id,
    submittedAt: new Date().toISOString(),
    count: requests.length,
    status: batch.processing_status,
  });
  history.latestBatchId = batch.id;
  fs.writeFileSync(metaPath, JSON.stringify(history, null, 2));
  console.log(`Submitted Batch 3 ID: ${batch.id} (${requests.length} requests), status=${batch.processing_status}`);
  return batch;
}

async function checkBatchStatus(apiKey, batchId) {
  const res = await fetch(`${BATCHES_URL}/${batchId}`, {
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Batch status failed ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function downloadAndAssemble(apiKey, workDir) {
  const metaPath = path.join(workDir, "batch3-meta.json");
  const history = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const xmlBuf = fs.readFileSync(path.join(ROOT, SOURCE_FILE));
  const chaptersMap = parseVplXml(xmlBuf.toString("utf8"));

  const evalByBucket = new Map();
  const xrefByBucket = new Map();
  let totalIn = 0, totalCacheCreate = 0, totalCacheRead = 0, totalOut = 0, totalCost = 0;
  const failures = [];
  const invalidRefs = [];

  for (const entry of history.batches) {
    const rawFile = path.join(workDir, `batch3-${entry.id}.jsonl`);
    if (!fs.existsSync(rawFile)) {
      const info = await checkBatchStatus(apiKey, entry.id);
      if (info.processing_status !== "ended") {
        throw new Error(`Batch ${entry.id} not ended yet: ${info.processing_status}`);
      }
      const dl = await fetch(info.results_url, {
        headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      });
      if (!dl.ok) throw new Error(`Download failed: ${dl.status}`);
      fs.writeFileSync(rawFile, await dl.text());
    }

    const lines = fs.readFileSync(rawFile, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const rec = JSON.parse(line);
      if (rec.result?.type !== "succeeded") {
        failures.push({ id: rec.custom_id, reason: JSON.stringify(rec.result).slice(0, 200) });
        continue;
      }
      const msg = rec.result.message;
      const u = msg.usage || {};
      totalIn += u.input_tokens || 0;
      totalCacheCreate += u.cache_creation_input_tokens || 0;
      totalCacheRead += u.cache_read_input_tokens || 0;
      totalOut += u.output_tokens || 0;
      totalCost += calcBatchCost(u);

      const tb = (msg.content || []).find((b) => b.type === "text");
      if (!tb) {
        failures.push({ id: rec.custom_id, reason: "no text block" });
        continue;
      }
      const parsed = JSON.parse(tb.text);
      if (rec.custom_id.startsWith("eval_")) {
        const cleanQueries = parsed.queries.map((q) => {
          const validPassages = [];
          for (const p of q.expectedPassages || []) {
            const norm = {
              book: String(p.book).toLowerCase(),
              chapter: Number(p.chapter),
              verseStart: Number(p.verseStart),
              verseEnd: Number(p.verseEnd),
            };
            if (isValidPassageRef(chaptersMap, norm)) {
              validPassages.push(norm);
            } else {
              invalidRefs.push({ source: q.id, ref: norm });
            }
          }
          return {
            id: q.id.trim(),
            category: q.category.trim(),
            query: q.query.trim(),
            shouldAbstain: Boolean(q.shouldAbstain),
            requiresSpeakerCaution: Boolean(q.requiresSpeakerCaution),
            expectedPassages: q.shouldAbstain ? [] : validPassages,
            notes: q.notes.trim(),
          };
        });
        evalByBucket.set(rec.custom_id, cleanQueries);
      } else if (rec.custom_id.startsWith("xref_")) {
        const cleanEntries = [];
        for (const e of parsed.entries || []) {
          const validPassages = [];
          for (const p of e.passages || []) {
            const norm = {
              book: String(p.book).toLowerCase(),
              chapter: Number(p.chapter),
              verseStart: Number(p.verseStart),
              verseEnd: Number(p.verseEnd),
              role: String(p.role || "").trim(),
            };
            if (isValidPassageRef(chaptersMap, norm)) {
              validPassages.push(norm);
            } else {
              invalidRefs.push({ source: e.id, ref: norm });
            }
          }
          if (validPassages.length >= 2) {
            cleanEntries.push({
              id: e.id.trim(),
              category: e.category,
              title: e.title.trim(),
              description: e.description.trim(),
              passages: validPassages,
            });
          }
        }
        xrefByBucket.set(rec.custom_id, cleanEntries);
      }
    }
  }

  const allEval = [];
  for (const b of EVAL_BUCKETS) {
    allEval.push(...(evalByBucket.get(b.id) || []));
  }

  // Ensure the 4 real production Vercel Analytics queries (#60/#63) are always included
  // in tests/eval-150.json while preserving the exact 150-query count and category balance.
  const REAL_ANALYTICS_QUERIES = [
    {
      matchRe: /donkeyhide cheek/i,
      category: "paraphrased_memory",
      entry: {
        id: "PM-15",
        category: "paraphrased_memory",
        query: "A guy who beats up his enemies with a donkeyhide cheek",
        shouldAbstain: false,
        requiresSpeakerCaution: false,
        expectedPassages: [{ book: "jdg", chapter: 15, verseStart: 15, verseEnd: 16 }],
        notes: "Real Vercel Analytics production query: paraphrased memory of Samson defeating Philistines with a donkey's jawbone (Judges 15:15-16).",
      },
    },
    {
      matchRe: /pile of bones/i,
      category: "narrative_pericopes",
      entry: {
        id: "NP-15",
        category: "narrative_pericopes",
        query: "Is there a proverb with a pile of bones?",
        shouldAbstain: false,
        requiresSpeakerCaution: false,
        expectedPassages: [{ book: "ezk", chapter: 37, verseStart: 1, verseEnd: 14 }],
        notes: "Real Vercel Analytics production query: misremembered genre ('proverb') pointing to Ezekiel's Valley of Dry Bones (Ezekiel 37:1-14).",
      },
    },
    {
      matchRe: /John 6.*Jesus body/i,
      category: "book_author_constraints",
      entry: {
        id: "BA-15",
        category: "book_author_constraints",
        query: "What are all the statements in John 6 about Jesus body?",
        shouldAbstain: false,
        requiresSpeakerCaution: false,
        expectedPassages: [{ book: "jhn", chapter: 6, verseStart: 35, verseEnd: 58 }],
        notes: "Real Vercel Analytics production query: book and chapter constrained Bread of Life discourse (John 6:35-58).",
      },
    },
    {
      matchRe: /civilizaciones.*América.*diluvio/i,
      category: "non_biblical_abstention",
      entry: {
        id: "AB-20",
        category: "non_biblical_abstention",
        query: "Que civilizaciones hubo en América antes del diluvio?",
        shouldAbstain: true,
        requiresSpeakerCaution: false,
        expectedPassages: [],
        notes: "Real Vercel Analytics production query: Spanish non-biblical historical question about pre-flood American civilizations; Scripture does not address this and search/summary must abstain.",
      },
    },
  ];

  for (const req of REAL_ANALYTICS_QUERIES) {
    if (allEval.some((q) => req.matchRe.test(q.query))) continue;
    // Replace the last entry in the same category so total stays exactly 150
    let replaceIdx = -1;
    for (let i = allEval.length - 1; i >= 0; i--) {
      if (allEval[i].category === req.category) {
        replaceIdx = i;
        break;
      }
    }
    if (replaceIdx >= 0) {
      allEval[replaceIdx] = { ...req.entry, id: allEval[replaceIdx].id };
    }
  }
  const allXrefs = [];
  for (const b of XREF_BUCKETS) {
    allXrefs.push(...(xrefByBucket.get(b.id) || []));
  }

  const sha256 = createHash("sha256").update(xmlBuf).digest("hex");
  const evalOut = {
    version: 1,
    source: SOURCE_FILE,
    sourceSha256: sha256,
    model: MODEL,
    effort: EFFORT,
    queryCount: allEval.length,
    categoryCounts: allEval.reduce((acc, q) => {
      acc[q.category] = (acc[q.category] || 0) + 1;
      return acc;
    }, {}),
    queries: allEval,
  };
  fs.writeFileSync(path.join(ROOT, EVAL_OUTPUT), `${JSON.stringify(evalOut, null, 2)}\n`);

  const xrefOut = {
    version: 1,
    source: SOURCE_FILE,
    sourceSha256: sha256,
    model: MODEL,
    effort: EFFORT,
    entryCount: allXrefs.length,
    categoryCounts: allXrefs.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + 1;
      return acc;
    }, {}),
    entries: allXrefs,
  };
  fs.writeFileSync(path.join(ROOT, XREF_OUTPUT), `${JSON.stringify(xrefOut, null, 2)}\n`);

  const usageReport = {
    totalIn,
    totalCacheCreate,
    totalCacheRead,
    totalOut,
    exactCost: Number(totalCost.toFixed(4)),
    evalCount: allEval.length,
    xrefCount: allXrefs.length,
    invalidRefsDropped: invalidRefs,
    failures,
  };
  fs.writeFileSync(path.join(workDir, "batch3-usage.json"), JSON.stringify(usageReport, null, 2));
  console.log(
    `Batch 3 Usage: in=${totalIn}, out=${totalOut}, exactCost=$${totalCost.toFixed(4)} | eval=${allEval.length} queries, xrefs=${allXrefs.length} entries, invalidRefs=${invalidRefs.length}, failures=${failures.length}`
  );
  return usageReport;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workDir = getArg("--work-dir", path.join(ROOT, ".batch-work"));
  const envFile = getArg("--env-file", null);

  if (process.argv.includes("--submit")) {
    await submitBatch(loadApiKey(envFile), workDir);
  } else if (process.argv.includes("--retry-failed")) {
    const usage = JSON.parse(fs.readFileSync(path.join(workDir, "batch3-usage.json"), "utf8"));
    const retryIds = new Set((usage.failures || []).map((f) => f.id));
    if (retryIds.size === 0) {
      console.log("No failed Batch 3 items to retry.");
    } else {
      await submitBatch(loadApiKey(envFile), workDir, retryIds);
    }
  } else if (process.argv.includes("--status")) {
    const meta = JSON.parse(fs.readFileSync(path.join(workDir, "batch3-meta.json"), "utf8"));
    const info = await checkBatchStatus(loadApiKey(envFile), meta.latestBatchId);
    console.log(JSON.stringify({ id: info.id, status: info.processing_status, counts: info.request_counts }));
  } else if (process.argv.includes("--assemble")) {
    await downloadAndAssemble(loadApiKey(envFile), workDir);
  } else if (process.argv.includes("--validate")) {
    const xml = fs.readFileSync(path.join(ROOT, SOURCE_FILE), "utf8");
    const chaptersMap = parseVplXml(xml);
    const evalData = JSON.parse(fs.readFileSync(path.join(ROOT, EVAL_OUTPUT), "utf8"));
    const xrefData = JSON.parse(fs.readFileSync(path.join(ROOT, XREF_OUTPUT), "utf8"));
    if (evalData.queries.length !== 150) {
      throw new Error(`Expected 150 eval queries, got ${evalData.queries.length}`);
    }
    for (const q of evalData.queries) {
      if (!q.shouldAbstain && (!Array.isArray(q.expectedPassages) || q.expectedPassages.length === 0)) {
        throw new Error(`Eval query ${q.id} missing expectedPassages`);
      }
      for (const p of q.expectedPassages || []) {
        if (!isValidPassageRef(chaptersMap, p)) {
          throw new Error(`Invalid eval passage ref in ${q.id}: ${JSON.stringify(p)}`);
        }
      }
    }
    for (const e of xrefData.entries) {
      if (!Array.isArray(e.passages) || e.passages.length < 2) {
        throw new Error(`Cross-ref ${e.id} has < 2 passages`);
      }
      for (const p of e.passages) {
        if (!isValidPassageRef(chaptersMap, p)) {
          throw new Error(`Invalid cross-ref passage in ${e.id}: ${JSON.stringify(p)}`);
        }
      }
    }
    console.log(`Validation PASSED: ${evalData.queries.length} eval queries & ${xrefData.entries.length} cross-references 100% canonically verified.`);
  }
}
