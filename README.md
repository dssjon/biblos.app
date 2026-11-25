# Biblos (`biblos.app`)

**Zero-server multilingual semantic Bible search, reader, grounded Scripture summaries, and daily study — live at [biblos.app](https://www.biblos.app).**

Search across all 66 books in natural language (or jump directly to any verse reference), read full chapters in the canonical World English Bible (WEB), explore Church Father commentaries in `/daily`, and generate opt-in summaries with verbatim clickable citations powered by Anthropic's native Citations API.

---

## Evolution: v1 → v2 → v3

Biblos evolved through three architectures—moving from a local Python vector database, to a dedicated inference server, to a zero-server full-Bible index running in RAM inside a Vercel serverless function for **<$1/month**:

| Generation | Repository / Path | Runtime & Retrieval | Index Footprint | Why It Evolved |
| :--- | :--- | :--- | :--- | :--- |
| **v1** | [`dssjon/biblos`](https://github.com/dssjon/biblos) | Python / Streamlit + ChromaDB + `instructor-large` | Local Chroma vector DB | Required local Python setup and persistent vector storage |
| **v2** | [`fallback-api/`](./fallback-api/README.md) | FastAPI / Docker on Hugging Face Spaces + `BAAI/bge-large-en-v1.5` | `~160 MB` float32 JSON embeddings | Enabled web hosting, but relied on a separate CPU inference server and uncontextualized English-only chunks |
| **v3 (Live)** | Root Next.js app ([`biblos.app`](https://www.biblos.app)) | Zero-server Next.js on Vercel + `int8` contextual pericope index in RAM (`<2 ms`) + Pericope BM25 + Voyage `rerank-3-lite` + Anthropic native Citations | **`4.33 MB`** binary (`BPE1`) | Eliminated the external inference server and vector DB, added multilingual & thematic recall, and cut runtime infrastructure to `$0` |

> [!NOTE]
> The **v2** FastAPI/BGE backend is preserved in [`fallback-api/`](./fallback-api/README.md) as an optional zero-`OPENAI_API_KEY` fallback (`BIBLOS_SEARCH_API_URL`). The original **v1** Python/Streamlit implementation remains archived at [`dssjon/biblos`](https://github.com/dssjon/biblos).

---

## Architecture (v3)

```text
User Query (any language or verse reference)
  │
  ├─► Verse reference? (lib/verse-parser.ts, 100+ book aliases)
  │     └─► Direct jump to full-chapter reader with verse highlighting
  │
  └─► Semantic query ─► POST /api/search (pages/api/search.js)
        ├─ 1. Embed query via OpenAI text-embedding-3-large (1024d)
        ├─ 2. Score all 4,421 int8 contextual pericopes in RAM (<2 ms)
        │     using public/data/pericope-embeddings.bin (4.33 MB)
        ├─ 3. Hydrate exact verbatim WEB Scripture from engwebp_vpl.xml
        ├─ 4. Fuse dense + server Pericope BM25 via weighted RRF (0.82 / 0.18)
        ├─ 5. Neural rerank top-40 with Voyage rerank-3-lite + pericope headers
        └─ (Fallback: automatically delegates to BIBLOS_SEARCH_API_URL if no OPENAI_API_KEY)
              │
              └─► Opt-in Summary ─► POST /api/summary (pages/api/summary.js)
                    └─ Anthropic native Citations API (claude-opus-5-5)
                       grounded strictly in the top-3 returned passages
```

### App Routes

- **`/`** ([`app/page.tsx`](./app/page.tsx)) — Primary v3 semantic search, direct reference lookup (`John 3:16`, `1 Cor 10:13-15`, `Ps 23`), full-chapter reader, and opt-in grounded AI summary with clickable inline citations.
- **`/daily`** ([`app/daily/page.tsx`](./app/daily/page.tsx)) — Daily Bible reading plan with ESV text/audio proxy ([`pages/api/esv.js`](./pages/api/esv.js)), `1,017` chapters of Church Father commentaries, and `335` pre-generated static cited patristic summaries ([`pages/api/summary-daily.js`](./pages/api/summary-daily.js)) served in `<5 ms` at `$0` runtime cost (with live Anthropic fallback on cache miss).
- **`/search`** ([`app/search/page.tsx`](./app/search/page.tsx)) — Client-side in-browser offline search running `Xenova/bge-large-en-v1.5` via Transformers.js over compressed per-book archives (`public/data/*.zip`) cached in IndexedDB.

---

## Monorepo Layout

```text
biblos.app/
├── app/                         # Next.js App Router pages (/, /daily, /search)
├── components/                  # Bible reader, cited summary, search results, UI primitives
├── pages/api/                   # Serverless API routes (search, summary, summary-daily, esv, tts)
├── lib/                         # In-RAM int8 vector search, BM25, Voyage rerank headers,
│                                # Anthropic Citations client, verse parser, pericope atlas
├── public/
│   ├── data/
│   │   ├── pericope-embeddings.bin        # 4.33 MB int8 BPE1 index (4,421 pericopes × 1024d)
│   │   ├── pericope-embeddings.meta.json  # Build provenance & quantization audit
│   │   ├── pericopes.json                 # Full-Bible 4,421-unit pericope atlas
│   │   ├── cross-references.json          # Cross-reference graph
│   │   ├── verse-ranges.json              # Passage hash → verse range index
│   │   ├── bible.zip                      # Canonical WEB XML for browser IndexedDB cache
│   │   └── {book}.zip (×66)               # Per-book BGE archives for /search offline mode & fallback-api
│   └── daily-data/
│       ├── readings.csv                   # Daily reading plan schedule
│       ├── commentaries/ (×1,017)         # Church Father commentary JSON files
│       ├── commentary-summaries.json      # 335 pre-generated cited patristic summaries
│       └── chronological-guides.json      # 365 grounded chronological daily study guides
├── engwebp_vpl.xml              # Canonical World English Bible (WEB) Protestant/Updated XML
├── util/                        # Offline index & dataset build scripts
├── tests/                       # Sacred-text invariants, unit tests, eval-150, Playwright specs
└── fallback-api/                # Optional v2 FastAPI + Docker + BGE-large fallback server
```

---

## Search Quality Benchmarks

Evaluated against Biblos's curated theological, narrative, lexical, multilingual, and non-biblical abstention benchmarks:

| Benchmark | Metric | Result |
| :--- | :--- | :--- |
| **60-Query 3-Way Eval** (v2 BGE → v3 Contextual Pericope + Rerank) | **Hit@1** | **`23.3% → 95.0%`** |
| **60-Query 3-Way Eval** | **Hit@3** | **`98.3%`** (`0` regressions) |
| **12-Query Live Voyage End-to-End Eval** | **Hit@1 / Hit@3** | **`91.7%` / `100%`** |
| **`int8` Quantization Audit** (`4,421` × `1024d`, 20 probes) | **Top-1 Exact / Top-10 Overlap** | **`100%` / `100%`** (`0.001494` max cosine error) |

---

## Unit Economics

| Component | Cost | Notes |
| :--- | :--- | :--- |
| **Hosting & Vector Storage** | **`$0/mo`** | Vercel serverless + `4.33 MB` binary index in RAM (no vector DB, no GPU/CPU inference server) |
| **One-Time Index Build** (`util/build-pericope-embeddings.mjs`) | **`$0.20`** | `1.50M` tokens (`text-embedding-3-large`, `1024d`) built in `8.8 s` |
| **Query Embeddings** (OpenAI `text-embedding-3-large`) | **`~$0.0026 / 1k queries`** | Single short query embedding per search |
| **Stage-2 Reranking** (Voyage `rerank-3-lite`) | **`$0` (free tier) / `~$0.20 / 1k`** | 200M free tokens on Voyage; optional (gracefully degrades if unset) |
| **Grounded Summaries** (Anthropic Citations) | **On-demand / `$0` static on `/daily`** | Opt-in on `/`; `335` pre-generated patristic summaries cached statically on `/daily` |
| **Total Operating Cost** | **`<$1/month`** | Typical hobby / ministry traffic |

---

## Local Development

### Prerequisites

- Node.js 20+ and npm

### Setup

```bash
git clone https://github.com/dssjon/biblos.app.git
cd biblos.app
npm ci
cp .env.example .env.local
```

Configure the keys you need in `.env.local`:

| Variable | Required? | Purpose |
| :--- | :--- | :--- |
| `OPENAI_API_KEY` | Recommended (v3 primary) | Embeds search queries (`text-embedding-3-large`, `1024d`) and powers `/api/tts`. If omitted, `/api/search` falls back to `BIBLOS_SEARCH_API_URL`. |
| `VOYAGE_API_KEY` | Optional | Enables Stage-2 `rerank-3-lite` reranking over top-40 pericope candidates. |
| `ANTHROPIC_API_KEY` | Optional | Powers opt-in cited summaries on `/api/summary` and cache-miss fallback on `/api/summary-daily`. |
| `NEXT_PUBLIC_ESV_API_KEY` | Optional (`/daily`) | Enables ESV text and audio passages via `/api/esv` on `/daily`. |
| `BIBLOS_SEARCH_API_URL` | Optional | URL of a v2 [`fallback-api/`](./fallback-api/README.md) instance when running without `OPENAI_API_KEY`. |

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploying to Vercel

1. Import `dssjon/biblos.app` in Vercel (Framework Preset: **Next.js**, Root Directory: `.`).
2. Add your environment variables (`OPENAI_API_KEY`, `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_ESV_API_KEY`) in Project Settings → Environment Variables.
3. Deploy. [`.vercelignore`](./.vercelignore) excludes `fallback-api/`, `tests/`, and offline build scripts so Vercel builds only the Next.js app, while Next.js file tracing automatically bundles the exact 4 runtime search assets (`pericope-embeddings.bin`, `pericopes.json`, `pericope-embeddings.meta.json`, `engwebp_vpl.xml`) into `/api/search`.

---

## Running Tests

```bash
npm run test:sacred   # Layer 1 sacred-text corpus & integrity invariants (4/4)
npm run test:unit     # Unit tests (vector search, rerank, BM25, parser, summaries, atlas)
npm test              # Run both test:sacred and test:unit
npm run build         # Production Next.js build
```

---

## Sacred Text Integrity

Biblos treats the text of Scripture as immutable:

- **Verbatim Hydration**: Contextual pericope metadata (`title`, `speakers`, `seekerQueries`, `lexicalBridges`) is used **only** inside offline embeddings and Voyage rerank headers—never as displayed Scripture. Every search result is hydrated directly from the canonical World English Bible XML (`engwebp_vpl.xml`).
- **Automated Invariants (`npm run test:sacred`)**: Verifies exact `66` books, `1,189` chapters, `31,103` verse slots (`5` standard text-critical empty slots), `100%` byte-for-byte SHA-256 parity between `engwebp_vpl.xml` and `public/data/bible.zip`, zero literal `"None"` or unescaped XML entity artifacts, `100%` verse coverage, unit-normalized vectors, and attribution metadata across all `1,017` Church Father commentary files.
- **Grounded Summaries**: Anthropic's native Citations API binds every claim to verbatim character spans from the top-3 passages, abstains when the passages do not address the query, and fails closed on empty, truncated, or refused responses.

---

## Credits & License

- **Source Code**: Licensed under the [MIT License](./LICENSE).
- **Scripture Text**: [World English Bible (WEB)](https://worldenglish.bible/) — Public Domain.
- **Daily Readings (ESV)**: Served on demand via the [ESV API](https://api.esv.org/) under Crossway's API terms.
- **Patristic Commentaries**: Sourced from the [Historical Christian Faith Commentaries Database](https://github.com/HistoricalChristianFaith/Commentaries-Database).
