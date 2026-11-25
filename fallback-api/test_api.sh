#!/bin/bash

# Biblos API Test Script
# Tests the semantic search API with expected results

API_URL="https://dssjon-biblos-api.hf.space"
QUERY="what did jesus say about eternal life"
EXPECTED_BOOK="jhn"
EXPECTED_CHAPTER=17
MIN_SIMILARITY=0.77

echo "======================================"
echo "Biblos API Test Suite"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass_count=0
fail_count=0

print_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((pass_count++))
}

print_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((fail_count++))
}

# Test 1: Health Check
echo "Test 1: Health Check (GET /)"
health=$(curl -s "$API_URL/")
status=$(echo "$health" | jq -r '.status' 2>/dev/null)

if [ "$status" = "online" ]; then
    print_pass "API is online and responding"
else
    print_fail "API health check failed"
fi

books=$(echo "$health" | jq -r '.books_loaded' 2>/dev/null)
if [ "$books" = "66" ]; then
    print_pass "All 66 books loaded"
else
    print_fail "Expected 66 books, got $books"
fi
echo ""

# Test 2: Semantic Search
echo "Test 2: Semantic Search"
echo "Query: \"$QUERY\""
search=$(curl -s -X POST "$API_URL/search" \
    -H "Content-Type: application/json" \
    -d "{\"query\":\"$QUERY\",\"limit\":3}")

# Check if we got results
results_count=$(echo "$search" | jq -r '.results | length' 2>/dev/null)
if [ "$results_count" -gt 0 ]; then
    print_pass "Search returned $results_count results"
else
    print_fail "No search results returned"
    exit 1
fi
echo ""

# Test 3: Validate Top Result
echo "Test 3: Validate Top Result"
book=$(echo "$search" | jq -r '.results[0].book')
chapter=$(echo "$search" | jq -r '.results[0].chapter')
similarity=$(echo "$search" | jq -r '.results[0].similarity')
content=$(echo "$search" | jq -r '.results[0].content' | head -c 80)

echo "Top Result:"
echo "  Book: $book"
echo "  Chapter: $chapter"
echo "  Similarity: $similarity"
echo "  Content: ${content}..."
echo ""

if [ "$book" = "$EXPECTED_BOOK" ]; then
    print_pass "Book matches expected: $EXPECTED_BOOK"
else
    print_fail "Expected book '$EXPECTED_BOOK', got '$book'"
fi

if [ "$chapter" = "$EXPECTED_CHAPTER" ]; then
    print_pass "Chapter matches expected: $EXPECTED_CHAPTER"
else
    print_fail "Expected chapter $EXPECTED_CHAPTER, got $chapter"
fi

# Check similarity threshold
if (( $(echo "$similarity >= $MIN_SIMILARITY" | bc -l) )); then
    print_pass "Similarity score $similarity >= $MIN_SIMILARITY"
else
    print_fail "Similarity score $similarity < $MIN_SIMILARITY"
fi
echo ""

# Test 4: Testament Filter
echo "Test 4: Testament Filter"
nt_search=$(curl -s -X POST "$API_URL/search" \
    -H "Content-Type: application/json" \
    -d '{"query":"love","testament":"new","limit":1}')
testament=$(echo "$nt_search" | jq -r '.results[0].testament')

if [ "$testament" = "NT" ]; then
    print_pass "Testament filter working correctly"
else
    print_fail "Testament filter returned: $testament"
fi
echo ""

# Test 5: Interactive Docs
echo "Test 5: Interactive Documentation"
docs_code=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/docs")

if [ "$docs_code" = "200" ]; then
    print_pass "Interactive docs accessible at /docs"
else
    print_fail "Docs endpoint returned HTTP $docs_code"
fi
echo ""

# Summary
echo "======================================"
echo "Test Summary"
echo "======================================"
total=$((pass_count + fail_count))
echo -e "${GREEN}Passed: $pass_count/$total${NC}"

if [ $fail_count -gt 0 ]; then
    echo -e "${RED}Failed: $fail_count/$total${NC}"
    echo ""
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
else
    echo ""
    echo -e "${GREEN}All tests passed! ✓${NC}"
    exit 0
fi
