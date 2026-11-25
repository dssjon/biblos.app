"""
Biblos Semantic Search API
Hugging Face Spaces deployment with FastAPI
Keeps model in memory for fast responses (~50-100ms after initial load)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import torch
import numpy as np
from transformers import AutoTokenizer, AutoModel
import json
import os
from pathlib import Path
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Biblos Semantic Search API",
    description="Semantic search over the entire Bible using BGE embeddings",
    version="1.0.0"
)

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request/Response models
class SearchRequest(BaseModel):
    query: str = Field(..., description="Search query text", min_length=1, max_length=500)
    limit: int = Field(10, description="Number of results to return", ge=1, le=100)

class SearchResult(BaseModel):
    book: str
    chapter: int
    testament: str
    content: str
    similarity: float

class SearchResponse(BaseModel):
    query: str
    results: List[SearchResult]
    total_searched: int
    execution_time_ms: float

# Global variables for model and data
MODEL_NAME = "BAAI/bge-large-en-v1.5"
tokenizer = None
model = None
bible_embeddings = {}
bible_metadata = {}

# Book mappings
OLD_TESTAMENT_BOOKS = [
    "gen", "exo", "lev", "num", "deu", "jos", "jdg", "rut", "1sa", "2sa",
    "1ki", "2ki", "1ch", "2ch", "ezr", "neh", "est", "job", "psa", "pro",
    "ecc", "sng", "isa", "jer", "lam", "ezk", "dan", "hos", "jol", "amo",
    "oba", "jon", "mic", "nam", "hab", "zep", "hag", "zec", "mal"
]

NEW_TESTAMENT_BOOKS = [
    "mat", "mrk", "luk", "jhn", "act", "rom", "1co", "2co", "gal", "eph",
    "php", "col", "1th", "2th", "1ti", "2ti", "tit", "phm", "heb", "jas",
    "1pe", "2pe", "1jn", "2jn", "3jn", "jud", "rev"
]

ALL_BOOKS = OLD_TESTAMENT_BOOKS + NEW_TESTAMENT_BOOKS


@app.on_event("startup")
async def load_model_and_data():
    """Load model and Bible embeddings into memory at startup"""
    global tokenizer, model, bible_embeddings, bible_metadata

    logger.info("Loading model and tokenizer...")
    try:
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
        model = AutoModel.from_pretrained(MODEL_NAME)
        model.eval()  # Set to evaluation mode

        # Move to GPU if available
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = model.to(device)
        logger.info(f"Model loaded successfully on {device}")

    except Exception as e:
        logger.error(f"Error loading model: {e}")
        raise

    logger.info("Loading Bible embeddings...")
    try:
        # Load embeddings for all books
        data_dir = Path("data")
        if not data_dir.exists():
            logger.warning("Data directory not found. Embeddings will be empty.")
            return

        loaded_count = 0
        for book in ALL_BOOKS:
            json_file = data_dir / f"{book}.json"
            if json_file.exists():
                with open(json_file, 'r') as f:
                    data = json.load(f)

                    # Separate embeddings and metadata
                    embeddings_list = []
                    metadata_list = []

                    for entry in data:
                        embeddings_list.append(entry['embedding'])
                        metadata_list.append({
                            'content': entry['content'],
                            'chapter': entry['metadata']['chapter'],
                            'testament': entry['metadata']['testament']
                        })

                    bible_embeddings[book] = np.array(embeddings_list, dtype=np.float32)
                    bible_metadata[book] = metadata_list
                    loaded_count += 1
                    logger.info(f"Loaded {len(embeddings_list)} embeddings for {book}")
            else:
                logger.warning(f"File not found: {json_file}")

        logger.info(f"Successfully loaded embeddings for {loaded_count} books")

    except Exception as e:
        logger.error(f"Error loading embeddings: {e}")
        raise


def generate_embedding(text: str) -> np.ndarray:
    """Generate embedding for input text using loaded model"""
    # BGE instruction prefix for queries (improves retrieval quality)
    text = "Represent this sentence for searching relevant passages: " + text
    # Tokenize
    inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=512)

    # Move to same device as model
    device = next(model.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}

    # Generate embeddings
    with torch.no_grad():
        outputs = model(**inputs)
        # Mean pooling
        embeddings = outputs.last_hidden_state.mean(dim=1)
        # Normalize
        embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)

    return embeddings.cpu().numpy()[0]


def cosine_similarity(query_embedding: np.ndarray, doc_embeddings: np.ndarray) -> np.ndarray:
    """Compute cosine similarity between query and document embeddings"""
    # Normalize query embedding
    query_norm = query_embedding / np.linalg.norm(query_embedding)

    # Normalize document embeddings
    doc_norms = np.linalg.norm(doc_embeddings, axis=1, keepdims=True)
    doc_embeddings_norm = doc_embeddings / doc_norms

    # Compute dot product (cosine similarity for normalized vectors)
    similarities = np.dot(doc_embeddings_norm, query_norm)

    return similarities


@app.get("/")
async def root():
    """Health check and API info"""
    return {
        "status": "online",
        "model": MODEL_NAME,
        "books_loaded": len(bible_embeddings),
        "total_embeddings": sum(len(emb) for emb in bible_embeddings.values()),
        "device": "cuda" if torch.cuda.is_available() else "cpu"
    }


@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "model_loaded": model is not None,
        "tokenizer_loaded": tokenizer is not None,
        "embeddings_loaded": len(bible_embeddings) > 0,
        "books_available": list(bible_embeddings.keys())
    }


@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """
    Perform semantic search over the entire Bible (both Old and New Testament)

    - **query**: The search query text
    - **limit**: Number of results to return (1-100)
    """
    import time
    start_time = time.time()

    # Validate model is loaded
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet. Please try again in a moment.")

    # Validate we have embeddings
    if len(bible_embeddings) == 0:
        raise HTTPException(status_code=503, detail="Bible embeddings not loaded. Please check data directory.")

    try:
        # Generate query embedding
        logger.info(f"Generating embedding for query: {request.query[:50]}...")
        query_embedding = generate_embedding(request.query)

        # Search all books (both Old and New Testament)
        books_to_search = list(bible_embeddings.keys())

        # Collect all results
        all_results = []
        total_searched = 0

        for book in books_to_search:
            book_embeddings = bible_embeddings[book]
            book_metadata = bible_metadata[book]

            # Compute similarities
            similarities = cosine_similarity(query_embedding, book_embeddings)

            # Create results
            for i, similarity in enumerate(similarities):
                if not np.isnan(similarity) and np.isfinite(similarity):
                    all_results.append({
                        "book": book,
                        "chapter": book_metadata[i]['chapter'],
                        "testament": book_metadata[i]['testament'],
                        "content": book_metadata[i]['content'],
                        "similarity": float(similarity)
                    })

            total_searched += len(similarities)

        # Sort by similarity and limit
        all_results.sort(key=lambda x: x['similarity'], reverse=True)
        top_results = all_results[:request.limit]

        execution_time = (time.time() - start_time) * 1000  # Convert to ms
        logger.info(f"Search completed in {execution_time:.2f}ms, returning {len(top_results)} results")

        return SearchResponse(
            query=request.query,
            results=top_results,
            total_searched=total_searched,
            execution_time_ms=round(execution_time, 2)
        )

    except Exception as e:
        logger.error(f"Error during search: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
