import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../pages/api/search.js';
import {
  buildPericopeMapFromEntries,
  formatRerankDocument,
  resetServerPericopeMapCache,
} from '../lib/pericope-rerank.js';

function createMockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function buildUpstreamCandidates(count = 50) {
  return Array.from({ length: count }, (_, idx) => {
    if (idx === 35) {
      return {
        book: 'luk',
        chapter: 15,
        testament: 'NT',
        content: 'He arose and came to his father. But while he was still far off, his father saw him...',
        similarity: 0.4912,
        extraIgnoredField: 'drop-me',
      };
    }
    return {
      book: 'psa',
      chapter: idx + 1,
      testament: 'OT',
      content: `Blessed is the man who walks in the counsel of the LORD (${idx + 1}).`,
      similarity: Number((0.75 - idx * 0.005).toFixed(4)),
    };
  });
}

function buildHybridCandidates(count = 50) {
  return Array.from({ length: count }, (_, idx) => {
    if (idx === 35) {
      return {
        book: 'luk',
        chapter: 15,
        testament: 'NT',
        content:
          '“He arose and came to his father. But while he was still far off, his father saw him and was moved with compassion.”',
        similarity: 0.6635,
        verseStart: 20,
        verseEnd: 24,
        matchSource: 'dense',
      };
    }
    if (idx === 24) {
      return {
        book: '1co',
        chapter: 13,
        testament: 'NT',
        content: 'Love is patient and is kind. Love doesn’t envy. Love doesn’t brag, is not proud.',
        similarity: 0.541,
        verseStart: 4,
        verseEnd: 8,
        matchSource: 'bm25',
      };
    }
    return {
      book: 'pro',
      chapter: (idx % 31) + 1,
      testament: 'OT',
      content: `The fear of the LORD is the beginning of knowledge (${idx + 1}).`,
      similarity: Number((0.72 - idx * 0.004).toFixed(4)),
      verseStart: 1,
      verseEnd: 7,
      matchSource: idx % 3 === 0 ? 'hybrid' : 'dense',
    };
  });
}

const ENV_KEYS = [
  'BIBLOS_SEARCH_API_URL',
  'OPENAI_API_KEY',
  'OPENAI_EMBED_API_URL',
  'OPENAI_EMBED_MODEL',
  'OPENAI_EMBED_DIMS',
  'OPENAI_EMBED_TIMEOUT_MS',
  'VOYAGE_API_KEY',
  'VOYAGE_API_URL',
  'VOYAGE_RERANK_MODEL',
  'VOYAGE_RERANK_TIMEOUT_MS',
];

function snapshotEnv() {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  };
}

test('GET /api/search returns 405 without calling fetch', async (t) => {
  const origFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called on GET');
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const res = createMockRes();
  await handler({ method: 'GET', body: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { error: 'Method not allowed' });
  assert.equal(fetchCalled, false);
});

test('POST /api/search with missing/blank query or invalid candidates returns 400 without calling fetch', async (t) => {
  const origFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called on invalid body');
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  for (const badBody of [
    {},
    { query: '' },
    { query: '   ' },
    { query: 123 },
    { query: 'love', candidates: 'not-an-array' },
  ]) {
    const res = createMockRes();
    await handler({ method: 'POST', body: badBody }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.error);
  }
  assert.equal(fetchCalled, false);
});

test('post-hybrid { query, candidates } mode reranks top-40 in place with book/pericope headers without altering canonical content', async (t) => {
  resetServerPericopeMapCache();
  const origFetch = globalThis.fetch;
  const restoreEnv = snapshotEnv();
  t.after(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  process.env.VOYAGE_API_KEY = 'voyage-test-key';
  process.env.VOYAGE_API_URL = 'https://voyage.example/v1/rerank';
  delete process.env.VOYAGE_RERANK_MODEL;

  const hybridCandidates = buildHybridCandidates(50);
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url !== 'https://voyage.example/v1/rerank') {
      throw new Error(`Expected only Voyage rerank call in candidates mode, got: ${url}`);
    }

    assert.equal(options.headers.Authorization, 'Bearer voyage-test-key');
    const parsedBody = JSON.parse(options.body);
    assert.equal(parsedBody.model, 'rerank-3-lite');
    assert.equal(parsedBody.query, 'What does the parable of the Prodigal Son reveal about love and forgiveness?');
    assert.equal(parsedBody.documents.length, 40);
    assert.ok(parsedBody.documents[35].startsWith('Luke 15:20-24'));
    assert.ok(parsedBody.documents[35].endsWith(`\n${hybridCandidates[35].content}`));
    assert.ok(parsedBody.documents[24].startsWith('1 Corinthians 13:4-8'));
    assert.ok(parsedBody.documents[24].endsWith(`\n${hybridCandidates[24].content}`));

    const data = [
      { index: 35, relevance_score: 0.8921 }, // Luke 15:20-24 (dense, rank 36 -> promoted into top-40)
      { index: 24, relevance_score: 0.8114 }, // 1 Corinthians 13:4-8 (bm25, rank 25 -> promoted into top-40)
    ];
    for (let i = 0; i < 40; i += 1) {
      if (i !== 35 && i !== 24) {
        data.push({ index: i, relevance_score: Number((0.62 - i * 0.005).toFixed(4)) });
      }
    }

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const res = createMockRes();
  await handler(
    {
      method: 'POST',
      body: {
        query: '  What does the parable of the Prodigal Son reveal about love and forgiveness?  ',
        candidates: hybridCandidates,
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reranked, true);
  assert.equal(res.body.results.length, 50);
  assert.equal(calls.length, 1);

  // Rank 0: Luke 15:20-24 with canonical content and all PR #3/#6 fields untouched
  assert.deepEqual(res.body.results[0], {
    ...hybridCandidates[35],
    rerankScore: 0.8921,
  });

  // Rank 1: BM25-rescued 1 Corinthians 13:4-8 with verseStart/verseEnd/matchSource untouched
  assert.deepEqual(res.body.results[1], {
    ...hybridCandidates[24],
    rerankScore: 0.8114,
  });

  // Tail indices 40..49 remain untouched in exact hybrid order
  for (let i = 40; i < 50; i += 1) {
    assert.deepEqual(res.body.results[i], hybridCandidates[i]);
  }
});

test('direct { query, limit } mode fetches upstream HF Space, reorders top-40 via rerank-3-lite, preserves BGE similarity, and keeps indices 40..49 intact', async (t) => {
  resetServerPericopeMapCache();
  const origFetch = globalThis.fetch;
  const restoreEnv = snapshotEnv();
  t.after(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  delete process.env.OPENAI_API_KEY;
  process.env.BIBLOS_SEARCH_API_URL = 'https://upstream.example';
  process.env.VOYAGE_API_KEY = 'voyage-test-key';
  process.env.VOYAGE_API_URL = 'https://voyage.example/v1/rerank';
  delete process.env.VOYAGE_RERANK_MODEL;

  const candidates = buildUpstreamCandidates(50);
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://upstream.example/search') {
      const parsedBody = JSON.parse(options.body);
      assert.deepEqual(parsedBody, {
        query: 'What lessons can we learn from the Prodigal Son?',
        limit: 50,
      });
      return new Response(JSON.stringify({ results: candidates }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url === 'https://voyage.example/v1/rerank') {
      assert.equal(options.headers.Authorization, 'Bearer voyage-test-key');
      const parsedBody = JSON.parse(options.body);
      assert.equal(parsedBody.model, 'rerank-3-lite');
      assert.equal(parsedBody.documents.length, 40);
      assert.ok(parsedBody.documents[35].startsWith('Luke 15'));

      const data = [
        { index: 35, relevance_score: 0.9421 },
        { index: 2, relevance_score: 0.7815 },
      ];
      for (let i = 0; i < 40; i += 1) {
        if (i !== 35 && i !== 2) {
          data.push({ index: i, relevance_score: Number((0.6 - i * 0.005).toFixed(4)) });
        }
      }

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const res = createMockRes();
  await handler(
    {
      method: 'POST',
      body: {
        query: '  What lessons can we learn from the Prodigal Son?  ',
        limit: 999,
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reranked, true);
  assert.equal(res.body.results.length, 50);
  assert.equal(calls.length, 2);

  assert.equal(res.body.results[0].book, 'luk');
  assert.equal(res.body.results[0].chapter, 15);
  assert.equal(res.body.results[0].similarity, 0.4912);
  assert.equal(res.body.results[0].rerankScore, 0.9421);
  assert.equal('extraIgnoredField' in res.body.results[0], false);

  assert.equal(res.body.results[1].book, 'psa');
  assert.equal(res.body.results[1].chapter, 3);
  assert.equal(res.body.results[1].similarity, candidates[2].similarity);
  assert.equal(res.body.results[1].rerankScore, 0.7815);

  for (let i = 40; i < 50; i += 1) {
    assert.deepEqual(res.body.results[i], {
      book: candidates[i].book,
      chapter: candidates[i].chapter,
      testament: candidates[i].testament,
      content: candidates[i].content,
      similarity: candidates[i].similarity,
    });
  }
});

test('formatRerankDocument prepends Book Chapter:Range, pericope title, speakers, and caution without altering content', () => {
  const sampleMap = buildPericopeMapFromEntries([
    {
      book: 'luk',
      chapter: 15,
      verseStart: 11,
      verseEnd: 24,
      title: 'The Parable of the Prodigal Son',
      altTitles: ['The Lost Son'],
      speakers: ['Jesus'],
      caution: null,
    },
    {
      book: 'job',
      chapter: 8,
      verseStart: 1,
      verseEnd: 7,
      title: "Bildad's First Speech",
      altTitles: [],
      speakers: ['Bildad the Shuhite'],
      caution: 'Rebuked human counsel (Job 42:7).',
    },
  ]);

  const lukDoc = formatRerankDocument(
    { book: 'luk', chapter: 15, verseStart: 20, verseEnd: 24, content: 'He arose and came to his father.' },
    sampleMap
  );
  assert.equal(
    lukDoc,
    'Luke 15:20-24 [The Parable of the Prodigal Son / The Lost Son | Speakers: Jesus]\nHe arose and came to his father.'
  );

  const jobDoc = formatRerankDocument(
    { book: 'job', chapter: 8, verseStart: 1, verseEnd: 7, content: 'Then Bildad the Shuhite answered.' },
    sampleMap
  );
  assert.match(jobDoc, /^Job 8:1-7 \[Bildad's First Speech \| Speakers: Bildad the Shuhite \| Caution: Rebuked human counsel/);
  assert.ok(jobDoc.endsWith('\nThen Bildad the Shuhite answered.'));
});

test('partial Voyage rerank subset appends unreturned head items in original order before tail', async (t) => {
  const origFetch = globalThis.fetch;
  const restoreEnv = snapshotEnv();
  t.after(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  process.env.VOYAGE_API_KEY = 'voyage-test-key';
  process.env.VOYAGE_API_URL = 'https://voyage.example/v1/rerank';

  const candidates = buildHybridCandidates(45);

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { index: 35, relevance_score: 0.91 },
          { index: 5, relevance_score: 0.82 },
        ],
      }),
      { status: 200 }
    );

  const res = createMockRes();
  await handler({ method: 'POST', body: { query: 'prodigal son', candidates } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reranked, true);
  assert.equal(res.body.results.length, 45);
  assert.equal(res.body.results[0].book, 'luk');
  assert.equal(res.body.results[0].verseStart, 20);
  assert.equal(res.body.results[0].rerankScore, 0.91);
  assert.equal(res.body.results[1].chapter, candidates[5].chapter);
  assert.equal(res.body.results[1].rerankScore, 0.82);
  assert.deepEqual(res.body.results[2], candidates[0]);
  assert.deepEqual(res.body.results[40], candidates[40]);
});

test('missing VOYAGE_API_KEY skips Voyage call and returns reranked: false in both candidates and limit modes', async (t) => {
  const origFetch = globalThis.fetch;
  const restoreEnv = snapshotEnv();
  t.after(() => {
    globalThis.fetch = origFetch;
    restoreEnv();
  });

  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  process.env.BIBLOS_SEARCH_API_URL = 'https://upstream.example';

  const hybridCandidates = buildHybridCandidates(22);
  let voyageCalled = false;

  globalThis.fetch = async (url) => {
    if (url === 'https://upstream.example/search') {
      return new Response(JSON.stringify({ results: buildUpstreamCandidates(22) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    voyageCalled = true;
    throw new Error(`Voyage should not be called when VOYAGE_API_KEY is unset: ${url}`);
  };

  const resCandidates = createMockRes();
  await handler({ method: 'POST', body: { query: 'forgiveness', candidates: hybridCandidates } }, resCandidates);
  assert.equal(resCandidates.statusCode, 200);
  assert.equal(resCandidates.body.reranked, false);
  assert.deepEqual(resCandidates.body.results, hybridCandidates);

  const resUpstream = createMockRes();
  await handler({ method: 'POST', body: { query: 'forgiveness', limit: 22 } }, resUpstream);
  assert.equal(resUpstream.statusCode, 200);
  assert.equal(resUpstream.body.reranked, false);
  assert.equal(resUpstream.body.results.length, 22);
  assert.equal(voyageCalled, false);
});

test('Voyage 429/500, malformed/duplicate indices, and timeout abort gracefully fall back to 200 with reranked: false', async (t) => {
  const origFetch = globalThis.fetch;
  const origWarn = console.warn;
  const restoreEnv = snapshotEnv();
  console.warn = () => {};
  t.after(() => {
    globalThis.fetch = origFetch;
    console.warn = origWarn;
    restoreEnv();
  });

  process.env.VOYAGE_API_KEY = 'voyage-test-key';
  process.env.VOYAGE_API_URL = 'https://voyage.example/v1/rerank';

  const candidates = buildHybridCandidates(22);

  for (const status of [429, 500]) {
    globalThis.fetch = async () => new Response('Voyage Error', { status });
    const resErr = createMockRes();
    await handler({ method: 'POST', body: { query: 'prodigal son', candidates } }, resErr);
    assert.equal(resErr.statusCode, 200);
    assert.equal(resErr.body.reranked, false);
    assert.deepEqual(resErr.body.results, candidates);
  }

  for (const badData of [
    [{ index: 99, relevance_score: 0.9 }],
    [
      { index: 1, relevance_score: 0.9 },
      { index: 1, relevance_score: 0.8 },
    ],
    [{ index: 0, relevance_score: Number.NaN }],
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: badData }), { status: 200 });
    const resBad = createMockRes();
    await handler({ method: 'POST', body: { query: 'prodigal son', candidates } }, resBad);
    assert.equal(resBad.statusCode, 200);
    assert.equal(resBad.body.reranked, false);
    assert.deepEqual(resBad.body.results, candidates);
  }

  process.env.VOYAGE_RERANK_TIMEOUT_MS = '20';
  let sawAbort = false;

  globalThis.fetch = async (_url, options) =>
    new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        sawAbort = true;
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });

  const resTimeout = createMockRes();
  await handler({ method: 'POST', body: { query: 'prodigal son', candidates } }, resTimeout);
  assert.equal(sawAbort, true);
  assert.equal(resTimeout.statusCode, 200);
  assert.equal(resTimeout.body.reranked, false);
  assert.deepEqual(resTimeout.body.results, candidates);
});

test('upstream HF Space error or invalid payload in { query, limit } mode returns 502', async (t) => {
  const origFetch = globalThis.fetch;
  const origError = console.error;
  const restoreEnv = snapshotEnv();
  console.error = () => {};
  t.after(() => {
    globalThis.fetch = origFetch;
    console.error = origError;
    restoreEnv();
  });

  delete process.env.OPENAI_API_KEY;
  process.env.BIBLOS_SEARCH_API_URL = 'https://upstream.example';
  process.env.VOYAGE_API_KEY = 'voyage-test-key';

  globalThis.fetch = async () => new Response('Service Unavailable', { status: 503 });
  const res503 = createMockRes();
  await handler({ method: 'POST', body: { query: 'grace' } }, res503);
  assert.equal(res503.statusCode, 502);
  assert.ok(res503.body?.error);

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const resBadShape = createMockRes();
  await handler({ method: 'POST', body: { query: 'grace' } }, resBadShape);
  assert.equal(resBadShape.statusCode, 502);
  assert.ok(resBadShape.body?.error);

  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const resNetwork = createMockRes();
  await handler({ method: 'POST', body: { query: 'grace' } }, resNetwork);
  assert.equal(resNetwork.statusCode, 502);
  assert.ok(resNetwork.body?.error);
});
