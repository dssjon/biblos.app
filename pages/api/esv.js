export default async function handler(req, res) {
  const { q, endpoint } = req.query;
  const API_KEY = process.env.NEXT_PUBLIC_ESV_API_KEY;
  const BASE_URL = 'https://api.esv.org/v3/passage/';

  if (!API_KEY) {
    return res.status(500).json({ error: 'ESV API key is not configured.' });
  }

  const params = new URLSearchParams({
    q: endpoint === 'search' ? q : q,
    'page-size': '20',
    'page': '1',
    'include-passage-references': 'true',
    'include-verse-numbers': 'true',
    'include-footnotes': 'false',
    'include-headings': 'false',
    'include-short-copyright': 'false',
    'include-css-link': 'false',
    'wrapping-div': 'false',
    'include-book-titles': 'false',
    'include-verse-anchors': 'true',
    'include-chapter-numbers': 'true',
    'include-audio-link': 'false',
  });

  try {
    let url;
    if (endpoint === 'search') {
      url = `https://api.esv.org/v3/passage/search/?${params}`;
    } else {
      url = `${BASE_URL}${endpoint}/?${params}`;
    }

    console.log(`Fetching ESV ${endpoint}:`, url);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Token ${API_KEY}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ESV API Error: ${response.status}`, errorText);
      throw new Error(`API response was not ok: ${response.status} ${errorText}`);
    }

    if (endpoint === 'audio') {
      const audioBuffer = await response.arrayBuffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(Buffer.from(audioBuffer));
    } else if (endpoint === 'search') {
      const data = await response.json();
      return res.status(200).json(data);
    } else {
      const data = await response.json();
      return res.status(200).json(data);
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
