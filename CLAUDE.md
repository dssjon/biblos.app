# CLAUDE.md

Guidance for contributors and coding agents working in `dssjon/biblos.app`.

## Project Overview

Biblos (`biblos.app`) is a zero-server multilingual semantic Bible search, reader, and daily study app built with Next.js (App Router + Pages API routes), accompanied by the optional v2 FastAPI/BGE fallback server in `fallback-api/`.

### Evolution
- **v1** (`dssjon/biblos`): Python / Streamlit + Chroma + `instructor-large`
- **v2** (`fallback-api/`): FastAPI / Docker on Hugging Face Spaces + `BAAI/bge-large-en-v1.5` (`~160 MB` float JSON embeddings, kept as optional zero-`OPENAI_API_KEY` fallback)
- **v3** (root Next.js app): Zero-server Vercel + `4.33 MB` `int8` contextual pericope index in RAM (`<2 ms`) + Pericope BM25 + Voyage `rerank-3-lite` + Anthropic native Citations

## Development Commands

```bash
npm run dev          # Start Next.js development server (http://localhost:3000)
npm run build        # Production build + @vercel/nft serverless tracing
npm run start        # Start production server
npm run lint         # Run Next.js linter
npm run test:sacred  # Layer 1 sacred-text corpus & integrity invariants (4/4)
npm run test:unit    # Unit tests (search, vector index, rerank, BM25, parser, summaries, atlas)
npm test             # Run test:sacred + test:unit
```

## Architecture

### Search Modes
1. **Primary v3 Server Search (`/`, `lib/bible-search-api.ts` → `pages/api/search.js`)**:
   - Verse references (e.g., `John 3:16`, `1 Cor 10:13-15`, `Ps 23`) are detected client-side via `lib/verse-parser.ts` and open the chapter reader directly.
   - Semantic queries call `POST /api/search`:
     - Embeds query via OpenAI `text-embedding-3-large` (`1024d`).
     - Loads `public/data/pericope-embeddings.bin` (`4.33 MB` `BPE1` int8 binary) once into RAM and scores all `4,421` pericopes in `<2 ms` (`lib/pericope-vector-search.js`).
     - Always hydrates exact verbatim canonical WEB Scripture from `engwebp_vpl.xml`.
     - Fuses dense + server Pericope BM25 via weighted RRF (`0.82` / `0.18`).
     - Runs optional Stage-2 Voyage `rerank-3-lite` over top-40 candidates with pericope metadata headers (`lib/pericope-rerank.js`).
     - Automatically falls back to `BIBLOS_SEARCH_API_URL` (v2 `fallback-api/`) if `OPENAI_API_KEY` is unset or errors.
2. **Client-Side Offline Search (`/search`, `lib/bible-search.ts`)**:
   - Loads `Xenova/bge-large-en-v1.5` in the browser via Transformers.js over `public/data/{book}.zip` archives cached in IndexedDB (`bibleDB`).
3. **Daily Readings & Patristic Commentaries (`/daily`, `app/daily/page.tsx`)**:
   - Proxies ESV text/audio through `pages/api/esv.js` using `NEXT_PUBLIC_ESV_API_KEY`.
   - Serves `1,017` chapter commentary JSON files from `public/daily-data/commentaries/`.
   - Serves `335` pre-generated cited commentary summaries from `public/daily-data/commentary-summaries.json` (`lib/daily-summary-cache.js`), falling back to live Anthropic native Citations via `pages/api/summary-daily.js`.

### Grounded Summaries (`pages/api/summary.js`, `pages/api/summary-daily.js`, `lib/anthropic-summary.js`)
- Uses `claude-opus-5-5` (`effort: "medium"`) with Anthropic's native Citations API (`citations: { enabled: true }`).
- Returns `{ summary, segments, citations }` and fails closed on empty, truncated (`max_tokens`), or refused answers.

## Non-Negotiable Invariants

1. **Sacred Text Integrity**: Never alter `engwebp_vpl.xml`, `public/data/bible.zip`, or Scripture content. Always run `npm run test:sacred` after any data/index change.
2. **Vercel Serverless Tracing (`pages/api/search.js`)**: `lib/pericope-vector-search.js` uses static `path.join(process.cwd(), ...)` literals so `@vercel/nft` traces ONLY the 4 runtime assets (`public/data/pericope-embeddings.bin`, `public/data/pericopes.json`, `public/data/pericope-embeddings.meta.json`, `engwebp_vpl.xml`) and NEVER bundles `public/data/*.zip` or `fallback-api/`.
3. **No Git LFS on `*.bin`**: Keep `public/data/pericope-embeddings.bin` (`4.33 MB`) as a normal git blob (never add a `.gitattributes` LFS rule for `*.bin`).
4. **No Committed `fallback-api/data/*.json`**: Uncompressed float JSON embeddings (`~160 MB`) are generated locally via `cd fallback-api && python prepare_data.py` and gitignored.

## Environment Variables

See `.env.example`:
- `OPENAI_API_KEY` — Primary v3 query embedding (`text-embedding-3-large`, `1024d`) & `/api/tts`
- `VOYAGE_API_KEY` — Stage-2 `rerank-3-lite` neural reranker
- `ANTHROPIC_API_KEY` — Grounded summaries via Anthropic native Citations API
- `NEXT_PUBLIC_ESV_API_KEY` — ESV text/audio proxy for `/daily`
- `BIBLOS_SEARCH_API_URL` — Optional v2 `fallback-api/` URL
