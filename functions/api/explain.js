// POST /api/explain  { card, followup? }  → { text }
//
// `card` is the slim card object from cards.json.
// `followup` is an optional string question for a follow-up exchange.

export async function onRequestPost(context) {
  try { return await handleExplain(context); }
  catch (e) {
    console.log('[explain] unhandled:', e?.message, e?.stack);
    return json({ error: 'server crashed in /api/explain', detail: e?.message }, 500);
  }
}

async function handleExplain({ request, env }) {
  if (!env.GEMINI_API_KEY) return json({ error: 'server not configured: GEMINI_API_KEY missing' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { card, followup } = body || {};
  if (!card || typeof card !== 'object') return json({ error: 'card required' }, 400);

  const prompt = followup ? followupPrompt(card, followup) : explainPrompt(card);

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const reqBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
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

  let data;
  try { data = await res.json(); }
  catch (e) { return json({ error: 'gemini response was not JSON', detail: e?.message }, 502); }
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';
  return json({ text });
}

function cardSummary(card) {
  return [
    `Card name: ${card.name}`,
    `Type: ${card.type_line || '(unknown)'}`,
    card.mana_cost ? `Mana cost: ${card.mana_cost}` : null,
    card.power ? `Power/Toughness: ${card.power}/${card.toughness}` : null,
    card.loyalty ? `Loyalty: ${card.loyalty}` : null,
    `Rarity: ${card.rarity}`,
    `Set: ${card.set_name} (${(card.set || '').toUpperCase()})`,
    card.oracle_text ? `\nRules text:\n${card.oracle_text}` : null,
    card.flavor_text ? `\nFlavor text:\n${card.flavor_text}` : null,
  ].filter(Boolean).join('\n');
}

function explainPrompt(card) {
  return `You are a Magic: The Gathering rules expert. Explain this card for a player who knows the basics of MTG. Cover:

1. **What it does** in plain English (1-2 sentences)
2. **Key interactions / rulings** if any
3. **Where it shines** — what kind of deck or situation
4. **Watch out for** — common mistakes or pitfalls

Keep it concise (under 200 words). Use markdown bold for the section headings exactly as shown above.

Card details:
${cardSummary(card)}`;
}

function followupPrompt(card, question) {
  return `Card: ${card.name}
Type: ${card.type_line || '(unknown)'}
Rules text: ${card.oracle_text || '(none)'}
${card.power ? `P/T: ${card.power}/${card.toughness}` : ''}

User follow-up question: ${question}

Answer concisely. Use markdown.`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
