# Biblos Fallback Search API (v2)

> [!NOTE]
> **Role in the Biblos v1 → v2 → v3 Evolution**
> - **v1** ([`dssjon/biblos`](https://github.com/dssjon/biblos)): Original Python / Streamlit + Chroma + `instructor-large`
> - **v2 (`fallback-api/`, this directory)**: Original FastAPI / Docker backend for Hugging Face Spaces using `BAAI/bge-large-en-v1.5` and `~160 MB` of uncompressed float32 JSON embeddings
> - **v3 ([root Next.js app](../README.md), live at [biblos.app](https://www.biblos.app))**: Zero-server Next.js on Vercel using a `4.33 MB` `int8` contextual pericope index in RAM (`<2 ms`) + Pericope BM25 + Voyage `rerank-3-lite` + Anthropic native Citations
>
> This directory is preserved as an **optional zero-`OPENAI_API_KEY` fallback** for `pages/api/search.js` (configured via `BIBLOS_SEARCH_API_URL`). The `~160 MB` `data/*.json` files are intentionally excluded from git—regenerate them locally from the root repo's compressed per-book archives with `python prepare_data.py`.

---

Semantic search over the entire Bible using `BAAI/bge-large-en-v1.5` embeddings. This FastAPI service keeps the model and embeddings in memory for fast responses (~50–100 ms after initial load).

## Generating `data/*.json`

Because the uncompressed float32 JSON embeddings total `~160 MB`, they are not committed to this repository. Generate them directly from the root monorepo's `public/data/{book}.zip` archives:

```bash
cd fallback-api
python prepare_data.py              # extracts ../public/data/*.zip -> ./data/*.json
```

Then run locally with Uvicorn or Docker:

```bash
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 7860
```

Or build the container:

```bash
docker build -t biblos-fallback-api .
docker run -p 7860:7860 biblos-fallback-api
```

Point the root Next.js app to your instance by setting `BIBLOS_SEARCH_API_URL=http://localhost:7860` (and leaving `OPENAI_API_KEY` unset).

## Features

- Fast semantic search with `BAAI/bge-large-en-v1.5` embeddings
- Model and embeddings stay loaded in memory after startup
- Searches all 66 books (Old and New Testament)
- CORS enabled for direct integration
- RESTful JSON API with FastAPI and interactive Swagger docs at `/docs`

## API Endpoints

See [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md) for full request/response schemas and client examples.

### `GET /`
Health check and API information (`status`, `model`, `books_loaded`, `total_embeddings`, `device`).

### `GET /health`
Detailed health status and list of loaded book codes.

### `POST /search`
Perform semantic search across all loaded Bible books.

**Request Body:**
```json
{
  "query": "What did Jesus say about love?",
  "limit": 10
}
```

**Response:**
```json
{
  "query": "What did Jesus say about love?",
  "results": [
    {
      "book": "jhn",
      "chapter": 13,
      "testament": "NT",
      "content": "A new commandment I give to you, that you love one another...",
      "similarity": 0.892
    }
  ],
  "total_searched": 6054,
  "execution_time_ms": 87.3
}
```

## Quick Start (cURL)

```bash
curl -X POST http://localhost:7860/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "faith and works",
    "limit": 5
  }'
```

## Model Information

- **Model:** `BAAI/bge-large-en-v1.5`
- **Embedding dimensions:** 1024
- **Total books:** 66 (overlapping canonical WEB passages)

## License

MIT License — see [`../LICENSE`](../LICENSE).
