import assert from 'node:assert/strict';
import { test } from 'node:test';
import searchSummary from '../pages/api/summary.js';
import dailySummary from '../pages/api/summary-daily.js';
import { parseAnthropicCitedResponse } from '../lib/anthropic-summary.js';

for (const [name, handler, body, expectedTitle] of [
  [
    'search',
    searchSummary,
    {
      query: 'hope',
      searchResults: [
        {
          book: 'jhn',
          chapter: 1,
          verseStart: 4,
          verseEnd: 5,
          content: 'In him was life, and the life was the light of men. The light shines in the darkness.',
        },
      ],
    },
    'JHN 1:4–5',
  ],
  [
    'daily',
    dailySummary,
    {
      book: 'john',
      chapter: 1,
      commentaryData: [
        {
          father_name: 'John Chrysostom',
          source_title: 'Homilies on John',
          book: 'john',
          chapter: 1,
          txt: 'The light overcomes darkness and illuminates every soul.',
        },
      ],
    },
    'John Chrysostom — Homilies on John',
  ],
]) {
  test(`${name} summary uses Opus 5.5 medium with native Citations API`, async (t) => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-only-key';
    t.after(() => {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    });
    t.mock.method(console, 'error', () => {});

    let responseBody;
    let lastRequest;
    let calls = 0;

    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      calls++;
      lastRequest = JSON.parse(options.body);
      assert.equal(lastRequest.model, 'claude-opus-5-5');
      assert.equal(lastRequest.output_config.effort, 'medium');
      assert.equal('temperature' in lastRequest, false);
      assert.equal('format' in lastRequest.output_config, false);

      const content = lastRequest.messages[0].content;
      assert.ok(Array.isArray(content), 'message content should be structured blocks');
      const docs = content.filter((b) => b.type === 'document');
      assert.equal(docs.length, 1);
      assert.equal(docs[0].title, expectedTitle);
      assert.deepEqual(docs[0].citations, { enabled: true });
      assert.equal(docs[0].source.type, 'text');
      assert.equal(docs[0].source.media_type, 'text/plain');

      const instructionBlock = content[content.length - 1];
      assert.equal(instructionBlock.type, 'text');
      assert.match(instructionBlock.text, /strictly on the provided/i);

      return { ok: true, json: async () => responseBody };
    });

    const invoke = async (method = 'POST') => {
      const res = {
        code: 200,
        payload: null,
        setHeader() {},
        status(code) {
          this.code = code;
          return this;
        },
        json(payload) {
          this.payload = payload;
          return this;
        },
      };
      await handler({ method, body }, res);
      return res;
    };

    // 1. Native cited response: adjacent text blocks join without splitting sentences
    responseBody = {
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'private reasoning' },
        { type: 'text', text: 'The passage affirms that ' },
        {
          type: 'text',
          text: 'the light shines in the darkness',
          citations: [
            {
              type: 'char_location',
              cited_text: 'The light shines in the darkness.',
              document_index: 0,
              document_title: expectedTitle,
              start_char_index: 52,
              end_char_index: 85,
            },
          ],
        },
        { type: 'text', text: '.' },
      ],
    };
    const citedRes = await invoke();
    assert.equal(citedRes.code, 200);
    assert.equal(citedRes.payload.summary, 'The passage affirms that the light shines in the darkness.');
    assert.equal(citedRes.payload.citations.length, 1);
    assert.equal(citedRes.payload.citations[0].id, 1);
    assert.equal(citedRes.payload.citations[0].documentTitle, expectedTitle);
    assert.equal(citedRes.payload.segments.length, 3);
    assert.equal(citedRes.payload.segments[1].citations[0].id, 1);

    // 2. Non-cited response with thinking block between text blocks still preserves paragraph break
    responseBody = {
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'private reasoning' },
        { type: 'text', text: 'First insight.' },
        { type: 'redacted_thinking', data: 'hidden' },
        { type: 'text', text: 'Second insight.' },
      ],
    };
    const plainRes = await invoke();
    assert.equal(plainRes.code, 200);
    assert.equal(plainRes.payload.summary, 'First insight.\n\nSecond insight.');
    assert.deepEqual(plainRes.payload.citations, []);

    // 3. Fail-closed on truncation, refusal, and thinking-only output
    for (const stop of ['max_tokens', 'refusal']) {
      responseBody = { ...responseBody, stop_reason: stop };
      assert.equal((await invoke()).code, 500);
    }
    responseBody = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'No answer' }] };
    assert.equal((await invoke()).code, 500);

    // 4. Reject GET without calling Anthropic
    const before = calls;
    assert.equal((await invoke('GET')).code, 405);
    assert.equal(calls, before);
  });
}

test('parseAnthropicCitedResponse deduplicates identical citation spans', () => {
  const parsed = parseAnthropicCitedResponse({
    stop_reason: 'end_turn',
    content: [
      {
        type: 'text',
        text: 'First claim',
        citations: [
          {
            type: 'char_location',
            cited_text: 'Exact verse.',
            document_index: 0,
            document_title: 'JHN 3:16',
            start_char_index: 0,
            end_char_index: 12,
          },
        ],
      },
      { type: 'text', text: ' and ' },
      {
        type: 'text',
        text: 'second reference to same verse.',
        citations: [
          {
            type: 'char_location',
            cited_text: 'Exact verse.',
            document_index: 0,
            document_title: 'JHN 3:16',
            start_char_index: 0,
            end_char_index: 12,
          },
        ],
      },
    ],
  });
  assert.equal(parsed.summary, 'First claim and second reference to same verse.');
  assert.equal(parsed.citations.length, 1);
  assert.equal(parsed.segments[0].citations[0].id, 1);
  assert.equal(parsed.segments[2].citations[0].id, 1);
});
