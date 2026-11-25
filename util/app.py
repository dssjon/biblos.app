"""Generate canonical overlapping verse chunks and BGE CLS embeddings for Biblos.

Usage:
  uv run --python 3.12 --with torch --with transformers --with numpy python util/app.py
"""

import argparse
import collections
import html
import json
import os
import re
import zipfile
from datetime import datetime
from pathlib import Path

import torch
from transformers import AutoModel, AutoTokenizer

CHUNK_MAX_CHARS = 900
CHUNK_OVERLAP_VERSES = 1
DEFAULT_MODEL = "BAAI/bge-large-en-v1.5"
DEFAULT_INPUT = "./engwebp_vpl.xml"
DEFAULT_OUTPUT = "./public/data"

BOOK_NAMES = {
    "gen": "Genesis", "exo": "Exodus", "lev": "Leviticus", "num": "Numbers", "deu": "Deuteronomy",
    "jos": "Joshua", "jdg": "Judges", "rut": "Ruth", "1sa": "1 Samuel", "2sa": "2 Samuel",
    "1ki": "1 Kings", "2ki": "2 Kings", "1ch": "1 Chronicles", "2ch": "2 Chronicles",
    "ezr": "Ezra", "neh": "Nehemiah", "est": "Esther", "job": "Job", "psa": "Psalms",
    "pro": "Proverbs", "ecc": "Ecclesiastes", "sng": "Song of Solomon", "isa": "Isaiah",
    "jer": "Jeremiah", "lam": "Lamentations", "ezk": "Ezekiel", "dan": "Daniel",
    "hos": "Hosea", "jol": "Joel", "amo": "Amos", "oba": "Obadiah", "jon": "Jonah",
    "mic": "Micah", "nam": "Nahum", "hab": "Habakkuk", "zep": "Zephaniah", "hag": "Haggai",
    "zec": "Zechariah", "mal": "Malachi", "mat": "Matthew", "mrk": "Mark", "luk": "Luke",
    "jhn": "John", "act": "Acts", "rom": "Romans", "1co": "1 Corinthians", "2co": "2 Corinthians",
    "gal": "Galatians", "eph": "Ephesians", "php": "Philippians", "col": "Colossians",
    "1th": "1 Thessalonians", "2th": "2 Thessalonians", "1ti": "1 Timothy", "2ti": "2 Timothy",
    "tit": "Titus", "phm": "Philemon", "heb": "Hebrews", "jas": "James", "1pe": "1 Peter",
    "2pe": "2 Peter", "1jn": "1 John", "2jn": "2 John", "3jn": "3 John", "jud": "Jude", "rev": "Revelation",
}

NT_BOOKS = {
    "mat", "mrk", "luk", "jhn", "act", "rom", "1co", "2co", "gal", "eph",
    "php", "col", "1th", "2th", "1ti", "2ti", "tit", "phm", "heb", "jas",
    "1pe", "2pe", "1jn", "2jn", "3jn", "jud", "rev",
}

VERSE_PATTERN = re.compile(r'<v b="([^"]+)" c="(\d+)" v="(\d+)"\s*(?:\/>|>([\s\S]*?)<\/v>)')


def parse_vpl_xml(xml_text: str):
    books = collections.OrderedDict()
    for match in VERSE_PATTERN.finditer(xml_text):
        book_code = match.group(1).upper()
        chapter = int(match.group(2))
        verse_num = int(match.group(3))
        raw_text = match.group(4)
        text = html.unescape(raw_text).strip() if raw_text is not None else ""
        if book_code not in books:
            books[book_code] = collections.OrderedDict()
        if chapter not in books[book_code]:
            books[book_code][chapter] = []
        if text:
            books[book_code][chapter].append((verse_num, text))
    return books


def chunk_chapter_verses(verses, max_chars=CHUNK_MAX_CHARS, overlap_verses=CHUNK_OVERLAP_VERSES):
    chunks = []
    n = len(verses)
    i = 0
    while i < n:
        end = i
        cur_len = 0
        while end < n:
            add_len = len(verses[end][1]) + (1 if end > i else 0)
            if end > i and cur_len + add_len > max_chars:
                break
            cur_len += add_len
            end += 1

        slice_vs = verses[i:end]
        chunks.append({
            "verseStart": slice_vs[0][0],
            "verseEnd": slice_vs[-1][0],
            "content": "\n".join(text for _, text in slice_vs),
        })

        if end >= n:
            break

        step_back = min(overlap_verses, end - i - 1)
        next_i = end - step_back
        i = next_i if next_i > i else end
    return chunks


def format_embedding_text(book_code: str, chapter: int, verse_start: int, verse_end: int, content: str) -> str:
    book_name = BOOK_NAMES.get(book_code.lower(), book_code)
    verse_range = f"{verse_start}-{verse_end}" if verse_end != verse_start else f"{verse_start}"
    return f"{book_name} {chapter}:{verse_range}\n{content}"


def select_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def main():
    parser = argparse.ArgumentParser(description="Build canonical overlapping Bible chunks and BGE CLS embeddings.")
    parser.add_argument("-i", "--input_file", default=DEFAULT_INPUT, help="Path to canonical VPL XML file")
    parser.add_argument("-m", "--model_name", default=DEFAULT_MODEL, help="HuggingFace embedding model")
    parser.add_argument("-o", "--output_dir", default=DEFAULT_OUTPUT, help="Output directory for per-book .zip files")
    parser.add_argument("--max_chars", type=int, default=CHUNK_MAX_CHARS)
    parser.add_argument("--overlap_verses", type=int, default=CHUNK_OVERLAP_VERSES)
    parser.add_argument("--batch_size", type=int, default=128)
    parser.add_argument("--local_files_only", action="store_true")
    parser.add_argument("--no_header", action="store_true", help="Embed raw passage text without Book Chapter:Range header")
    args = parser.parse_args()

    started = datetime.now()
    xml_text = Path(args.input_file).read_text(encoding="utf-8")
    books = parse_vpl_xml(xml_text)

    records_by_book = collections.OrderedDict()
    all_embed_texts = []
    index_map = []

    for book_code, chapters in books.items():
        book_lower = book_code.lower()
        testament = "NT" if book_lower in NT_BOOKS else "OT"
        records_by_book[book_lower] = []
        for chapter, verses in chapters.items():
            for chunk in chunk_chapter_verses(verses, max_chars=args.max_chars, overlap_verses=args.overlap_verses):
                record = {
                    "content": chunk["content"],
                    "metadata": {
                        "book": book_code,
                        "chapter": chapter,
                        "testament": testament,
                        "verseStart": chunk["verseStart"],
                        "verseEnd": chunk["verseEnd"],
                    },
                }
                rec_idx = len(records_by_book[book_lower])
                records_by_book[book_lower].append(record)
                embed_text = (
                    chunk["content"]
                    if args.no_header
                    else format_embedding_text(
                        book_code, chapter, chunk["verseStart"], chunk["verseEnd"], chunk["content"]
                    )
                )
                all_embed_texts.append(embed_text)
                index_map.append((book_lower, rec_idx))

    print(f"Prepared {len(all_embed_texts)} overlapping chunks across {len(records_by_book)} books.")
    device = select_device()
    print(f"Loading {args.model_name} on {device}...")
    tokenizer = AutoTokenizer.from_pretrained(args.model_name, local_files_only=args.local_files_only)
    model = AutoModel.from_pretrained(args.model_name, local_files_only=args.local_files_only).to(device).eval()

    embeddings = []
    with torch.no_grad():
        for start in range(0, len(all_embed_texts), args.batch_size):
            batch = all_embed_texts[start : start + args.batch_size]
            encoded = tokenizer(batch, padding=True, truncation=True, max_length=512, return_tensors="pt").to(device)
            # BAAI/bge-large-en-v1.5 uses CLS pooling + L2 normalization
            cls_vecs = model(**encoded).last_hidden_state[:, 0]
            norm_vecs = torch.nn.functional.normalize(cls_vecs, p=2, dim=1)
            embeddings.extend(norm_vecs.cpu().tolist())
            done = min(start + args.batch_size, len(all_embed_texts))
            if done % 1024 == 0 or done == len(all_embed_texts):
                print(f"Embedded {done}/{len(all_embed_texts)} chunks")

    for (book_lower, rec_idx), vec in zip(index_map, embeddings):
        records_by_book[book_lower][rec_idx]["embedding"] = [round(x, 7) for x in vec]

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for book_lower, records in records_by_book.items():
        zip_path = out_dir / f"{book_lower}.zip"
        payload = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            zf.writestr(f"{book_lower}.json", payload)

    elapsed = (datetime.now() - started).total_seconds()
    print(f"Wrote {len(records_by_book)} book ZIPs to {out_dir} in {elapsed:.1f}s.")


if __name__ == "__main__":
    main()
