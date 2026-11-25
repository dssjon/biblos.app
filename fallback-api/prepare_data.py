"""
Data preparation script for Hugging Face Spaces deployment
Extracts Bible embeddings from ZIP files and prepares them for the API
"""

import json
import zipfile
from pathlib import Path
import shutil

# Book list from the main app
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


def extract_embeddings_from_zip(source_dir: Path, output_dir: Path, use_ios: bool = False):
    """
    Extract Bible embeddings from ZIP files in the source directory

    Args:
        source_dir: Path to the source directory (e.g., ../public/data or ../public/ios-bge-large)
        output_dir: Path to the output directory (e.g., ./data)
        use_ios: Whether to use iOS embeddings (smaller, quantized)
    """

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    extracted_count = 0
    failed_books = []

    print(f"Extracting embeddings from: {source_dir}")
    print(f"Output directory: {output_dir}")
    print(f"Using {'iOS' if use_ios else 'desktop'} embeddings")
    print("-" * 60)

    for book in ALL_BOOKS:
        zip_path = source_dir / f"{book}.zip"
        json_output = output_dir / f"{book}.json"

        # Skip if already extracted
        if json_output.exists():
            print(f"✓ {book}.json already exists, skipping")
            extracted_count += 1
            continue

        # Check if ZIP exists
        if not zip_path.exists():
            print(f"✗ {book}.zip not found")
            failed_books.append(book)
            continue

        try:
            # Extract JSON from ZIP
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                json_filename = f"{book}.json"

                # Check if JSON exists in ZIP
                if json_filename not in zip_ref.namelist():
                    print(f"✗ {json_filename} not found in {book}.zip")
                    failed_books.append(book)
                    continue

                # Extract and read JSON
                with zip_ref.open(json_filename) as json_file:
                    data = json.load(json_file)

                    # Validate data structure
                    if not isinstance(data, list):
                        data = [data]

                    # Verify embeddings exist and are valid
                    valid_entries = []
                    for entry in data:
                        if 'embedding' in entry and 'content' in entry and 'metadata' in entry:
                            # Check embedding is valid
                            emb = entry['embedding']
                            if isinstance(emb, list) and len(emb) > 0:
                                valid_entries.append(entry)

                    if not valid_entries:
                        print(f"✗ {book}.json contains no valid entries")
                        failed_books.append(book)
                        continue

                    # Write to output directory
                    with open(json_output, 'w') as out_file:
                        json.dump(valid_entries, out_file)

                    print(f"✓ {book}.json extracted ({len(valid_entries)} entries)")
                    extracted_count += 1

        except Exception as e:
            print(f"✗ Error extracting {book}: {e}")
            failed_books.append(book)

    print("-" * 60)
    print(f"\nExtraction complete:")
    print(f"  Successfully extracted: {extracted_count}/{len(ALL_BOOKS)} books")

    if failed_books:
        print(f"  Failed books: {', '.join(failed_books)}")

    # Calculate total size
    total_size = sum(f.stat().st_size for f in output_dir.glob("*.json"))
    print(f"  Total size: {total_size / 1024 / 1024:.2f} MB")

    return extracted_count, failed_books


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Prepare Bible embeddings for the Biblos fallback API")
    parser.add_argument(
        "--source",
        type=str,
        default="../public/data",
        help="Source directory containing ZIP files (default: ../public/data)"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="./data",
        help="Output directory for extracted JSON files (default: ./data)"
    )

    args = parser.parse_args()

    source_dir = Path(args.source)
    output_dir = Path(args.output)

    # Check source directory exists
    if not source_dir.exists():
        print(f"Error: Source directory does not exist: {source_dir}")
        print("\nPlease ensure you're running this from the fallback-api/ directory")
        print("and that the compressed book archives exist in ../public/data.")
        return 1

    # Extract embeddings
    extracted, failed = extract_embeddings_from_zip(source_dir, output_dir, False)

    if extracted == 0:
        print("\nNo embeddings were extracted. Please check the source directory.")
        return 1

    print("\n✓ Data preparation complete!")
    print("\nNext steps:")
    print("  1. Review the extracted files in the 'data/' directory")
    print("  2. Run locally with `uvicorn app:app --host 0.0.0.0 --port 7860`")
    print("  3. Or build and deploy this fallback-api/ directory as a Docker Space on Hugging Face")
    print("  4. Point BIBLOS_SEARCH_API_URL in the root Next.js app to your deployed URL")

    return 0


if __name__ == "__main__":
    exit(main())
