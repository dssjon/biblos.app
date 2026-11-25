# Biblos Semantic Search API Documentation

Complete documentation for integrating the Biblos Semantic Search API into your applications.

## Base URL

```
https://dssjon-biblos-api.hf.space
```

The API is live and publicly accessible at the URL above.

---

## Endpoints

### 1. Health Check

**GET /**

Returns API status and basic information.

**Response:**
```json
{
  "status": "online",
  "model": "BAAI/bge-large-en-v1.5",
  "books_loaded": 66,
  "total_embeddings": 6054,
  "device": "cpu"
}
```

**Example:**
```bash
curl https://dssjon-biblos-api.hf.space/
```

---

### 2. Detailed Health Check

**GET /health**

Returns detailed health status and list of available books.

**Response:**
```json
{
  "model_loaded": true,
  "tokenizer_loaded": true,
  "embeddings_loaded": true,
  "books_available": ["gen", "exo", "lev", ...]
}
```

**Example:**
```bash
curl https://dssjon-biblos-api.hf.space/health
```

---

### 3. Semantic Search

**POST /search**

Perform semantic search over the entire Bible (both Old and New Testament).

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Search query text (1-500 chars) |
| `limit` | integer | No | Number of results (1-100, default: 10) |

#### Response

```json
{
  "query": "string",
  "results": [
    {
      "book": "string",
      "chapter": integer,
      "testament": "string",
      "content": "string",
      "similarity": float
    }
  ],
  "total_searched": integer,
  "execution_time_ms": float
}
```

#### Example

```bash
curl -X POST https://dssjon-biblos-api.hf.space/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "faith without works is dead",
    "limit": 5
  }'
```

---

## Integration Examples

### JavaScript/TypeScript

#### Basic Fetch
```javascript
async function searchBible(query, limit = 10) {
  const response = await fetch('https://dssjon-biblos-api.hf.space/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      limit
    })
  })

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`)
  }

  return await response.json()
}

// Usage
const results = await searchBible('love one another', 5)

console.log(results)
```

#### React Hook
```typescript
import { useState, useCallback } from 'react'

interface SearchResult {
  book: string
  chapter: number
  testament: string
  content: string
  similarity: number
}

export function useBibleSearch() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const search = useCallback(async (
    query: string,
    limit: number = 10
  ): Promise<SearchResult[]> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('https://dssjon-biblos-api.hf.space/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit })
      })

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`)
      }

      const data = await response.json()
      return data.results
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  return { search, loading, error }
}

// Usage in component
function SearchComponent() {
  const { search, loading, error } = useBibleSearch()
  const [results, setResults] = useState([])

  const handleSearch = async (query: string) => {
    const results = await search(query, 10)
    setResults(results)
  }

  return (
    // Your component JSX
  )
}
```

---

### Python

#### Basic Example
```python
import requests

def search_bible(query, limit=10):
    """
    Search the Bible using semantic search

    Args:
        query: Search query text
        limit: Number of results to return

    Returns:
        List of search results
    """
    url = 'https://dssjon-biblos-api.hf.space/search'

    payload = {
        'query': query,
        'limit': limit
    }

    response = requests.post(url, json=payload)
    response.raise_for_status()

    return response.json()

# Usage
results = search_bible(
    query='faith and works',
    limit=5
)

for result in results['results']:
    print(f"{result['book'].upper()} {result['chapter']}")
    print(f"Similarity: {result['similarity']:.3f}")
    print(f"Content: {result['content']}")
    print()
```

#### Async Example
```python
import asyncio
import aiohttp

async def search_bible_async(query, limit=10):
    """Async version of Bible search"""
    url = 'https://dssjon-biblos-api.hf.space/search'

    payload = {'query': query, 'limit': limit}

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as response:
            response.raise_for_status()
            return await response.json()

# Usage
async def main():
    results = await search_bible_async('love your neighbor', limit=5)
    print(results)

asyncio.run(main())
```

---

### cURL

```bash
curl -X POST https://dssjon-biblos-api.hf.space/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "blessed are the peacemakers",
    "limit": 3
  }' | jq '.results[] | "\(.book) \(.chapter) - \(.content)"'
```

---

## Error Handling

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request (invalid parameters) |
| 405 | Method Not Allowed |
| 500 | Internal Server Error |
| 503 | Service Unavailable (model not loaded) |

### Error Response Format

```json
{
  "detail": "Error message describing what went wrong"
}
```

### Example Error Handling (JavaScript)

```javascript
async function safeSearch(query) {
  try {
    const response = await fetch('https://dssjon-biblos-api.hf.space/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Search failed')
    }

    return await response.json()
  } catch (error) {
    console.error('Search error:', error.message)
    return null
  }
}
```

---

## Performance Considerations

### Response Times
- **First request**: 2-3 seconds (model loading)
- **Subsequent requests**: 50-100ms average
- **Cold start**: None (model stays in memory)

### Best Practices
1. **Cache results** on the client side when possible
2. **Debounce** search queries to reduce API calls
3. **Implement pagination** for large result sets
4. **Use appropriate limits** - higher limits increase response time
5. **The API searches the entire Bible** (both Old and New Testament) for comprehensive results

### Rate Limiting
Currently no rate limiting is enforced, but please use responsibly:
- Avoid making more than 10 requests per second
- Implement exponential backoff on errors
- Cache results when appropriate

---

## Interactive Documentation

Visit your Space URL at `/docs` for interactive Swagger UI documentation where you can:
- Test all endpoints directly in the browser
- See detailed schema information
- Try different parameter combinations
- View real-time responses

**Live Interactive Docs:** [https://dssjon-biblos-api.hf.space/docs](https://dssjon-biblos-api.hf.space/docs)

---

## Support

For issues, questions, or feature requests:
1. Check the interactive docs at `/docs`
2. Review this documentation
3. Open an issue on the GitHub repository
4. Contact the maintainer

---

## Version

API Version: 1.0.0
Model: BAAI/bge-large-en-v1.5
Last Updated: 2025
