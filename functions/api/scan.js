// POST /api/scan  { imageBase64, mimeType }  → identification JSON from Gemini
//
// Env: GEMINI_API_KEY (required), GEMINI_MODEL (optional, defaults to gemini-2.5-flash)

const IDENTIFY_PROMPT = `You are looking at a photo containing one OR MORE Magic: The Gathering cards from the "Avatar: The Last Airbender" Universes Beyond release. The cards may be fanned out, stacked partially, or laid in a grid.

Identify EVERY card you can see, even if partially obscured. For each, read:
- name: the card's printed title (string)
- set_code: the 3-4 letter set code shown at the bottom of the card. Possible values: "TLA", "TLE", "PTLA", "JTLA", "ATLA", "ATLE", "TTLA", "TTLE", "FTLA". Return uppercase. Use null if you can't read it.
- collector_number: the printed collector number from the bottom of the card (e.g. "0123/394" → return "123"). Just the number portion as a string, leading zeros stripped. Use null if unreadable.
- treatment: brief description if special (e.g., "borderless", "showcase", "extended art", "anime", "etched foil"), or null for standard.
- confidence: "high", "medium", or "low".

Return ONLY a JSON object of this exact shape:
{
  "cards": [
    { "name": "...", "set_code": "...", "collector_number": "...", "treatment": null, "confidence": "high" }
  ]
}

If you can read only one card, return an array with one element. If the photo doesn't appear to contain any MTG card, return { "cards": [] }. No markdown, no commentary.`;

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) return json({ error: 'server not configured: GEMINI_API_KEY missing' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { imageBase64, mimeType } = body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') return json({ error: 'imageBase64 required' }, 400);

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const reqBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: IDENTIFY_PROMPT },
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json' },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
  } catch (e) {
    return json({ error: 'fetch failed: ' + e.message }, 502);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); detail = j?.error?.message || detail; } catch {}
    return json({ error: 'gemini error', detail }, 502);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';

  let parsed = null;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return json({ error: 'gemini returned non-JSON', raw: text.slice(0, 300) }, 502);
  }

  return json({ identification: parsed });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
