import { JSDOM } from 'jsdom';
import { PassThrough } from 'stream';

const MAX_INPUT_LENGTH = 1000; // Adjust as needed
const DEBUG_MODE = false; // Set this to false when you're ready for production

// List of available voices from OpenAI
const AVAILABLE_VOICES = [
  { name: 'alloy', language: 'en' },
  { name: 'echo', language: 'en' },
  { name: 'fable', language: 'en' },
  { name: 'onyx', language: 'en' },
  { name: 'nova', language: 'en' },
  { name: 'shimmer', language: 'en' },
];

// Load OpenAI API key from environment variables
const apiKey = process.env.OPENAI_API_KEY;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Return available voices
    return res.status(200).json({ voices: AVAILABLE_VOICES });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OpenAI API key in environment variables' });
  }

  try {
    const { htmlContent, voiceName } = req.body;

    // Remove verse numbers using HTML structure
    const textWithoutVerseNumbers = removeVerseNumbers(htmlContent);

    // Debug: Limit text to first chapter
    let limitedText = textWithoutVerseNumbers;
    if (DEBUG_MODE) {
      const chapters = limitedText.split(/Chapter \d+/);
      limitedText = chapters.slice(0, 1).join('Chapter '); // Include chapter headings
    }

    // Split the text into chunks
    const textChunks = splitTextIntoChunks(limitedText, MAX_INPUT_LENGTH);

    // Set headers for streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Process chunks and stream audio
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      console.log(`Processing chunk ${i + 1}/${textChunks.length}:`);

      const voice = AVAILABLE_VOICES.find(v => v.name === voiceName) || AVAILABLE_VOICES[0];

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: voice.name,
          input: chunk,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error from OpenAI API:', errorData);
        return res.status(500).json({ error: `OpenAI API error: ${errorData.error.message}` });
      }

      // Stream the audio chunk
      const audioBuffer = await response.arrayBuffer();
      res.write(Buffer.from(audioBuffer));

      console.log(`Chunk ${i + 1} synthesized and streamed successfully`);
    }

    // End the response after all chunks are processed
    res.end();
    console.log('All chunks synthesized and streamed successfully');
  } catch (error) {
    console.error('Error in Text-to-Speech API:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message, stack: error.stack });
    }
  }
}

function removeVerseNumbers(htmlContent) {
  const dom = new JSDOM(htmlContent);
  const document = dom.window.document;

  // Remove verse number elements
  document.querySelectorAll('.verse-num').forEach(el => el.remove());

  // Get the text content of the body
  const textContent = document.body.textContent || document.body.innerText;

  // Trim whitespace and remove extra spaces
  return textContent.trim().replace(/\s+/g, ' ');
}

function splitTextIntoChunks(text, maxLength) {
  const words = text.split(/\s+/);
  const chunks = [];
  let currentChunk = '';

  for (const word of words) {
    if ((currentChunk + ' ' + word).length <= maxLength) {
      currentChunk += (currentChunk ? ' ' : '') + word;
    } else {
      chunks.push(currentChunk);
      currentChunk = word;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
