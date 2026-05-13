// POST /api/scan  { imageBase64, mimeType }  → identification JSON from Gemini
//
// Env: GEMINI_API_KEY (required), GEMINI_MODEL (optional, defaults to gemini-2.5-flash)

const IDENTIFY_PROMPT = `You are looking at a photo containing one OR MORE Magic: The Gathering cards from the "Avatar: The Last Airbender" Universes Beyond release. Cards may be fanned, side-by-side, in a grid, or stacked with overlap.

PROCEDURE:
1. First, scan the entire image and count how many DISTINCT card rectangles you can see. Pay attention to small cards in the corners and partially overlapped cards — don't miss any.
2. For EACH card rectangle, zoom your attention to read:
   - The title at the top
   - The set code (small text bottom-left or bottom-center). Allowed values: TLA, TLE, PTLA, JTLA, ATLA, ATLE, TTLA, TTLE, FTLA.
   - The collector number (small number near the set code, e.g. "0123/394" — extract just "123")
   - Any special treatment (borderless, showcase, extended art, anime, etched-foil printing)
3. Output ALL of them in a single JSON object.

OUTPUT (ONLY this JSON, no markdown, no commentary):
{
  "cards": [
    { "name": "...", "set_code": "TLA", "collector_number": "123", "treatment": null, "confidence": "high" }
  ]
}

Rules:
- ALWAYS use the "cards" array, even for a single card or for zero cards.
- For each field you can't read clearly, use null and lower the confidence.
- Set code and collector number are critical — they uniquely identify the printing. Try hard to read them.
- If a card is partially obscured by another, still report what you can see.
- Don't invent cards that aren't actually visible.`;

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
