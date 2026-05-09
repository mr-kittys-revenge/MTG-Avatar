// POST /api/deck-build  { format, commander_id?, vibe?, theme?, owned, format_size }
// Sends the user's owned-card spec to Gemini, returns a structured deck list.
//
// `owned` is a compact array of card summaries provided by the client (the client already
// has the catalog; sending the slim list keeps the prompt tight).

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) return json({ error: 'server not configured: GEMINI_API_KEY missing' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const format = body.format === 'casual60' ? 'casual60' : 'commander';
  const formatSize = format === 'commander' ? 100 : 60;
  const commander = body.commander || null; // optional commander card object
  const vibe = (body.vibe || 'auto').toString().slice(0, 40);
  const theme = (body.theme || '').toString().slice(0, 300);
  const owned = Array.isArray(body.owned) ? body.owned.slice(0, 1500) : [];

  const ownedSummary = owned.map(c => formatCardLine(c)).join('\n');

  const sys = makePrompt({ format, formatSize, commander, vibe, theme, ownedSummary });

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const reqBody = {
    contents: [{ role: 'user', parts: [{ text: sys }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
  };

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
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
  } catch (e) {
    return json({ error: 'gemini returned non-JSON', raw: text.slice(0, 500) }, 502);
  }

  return json({ deck: parsed });
}

function formatCardLine(c) {
  // Compact one-liner so we can fit lots of cards in the prompt.
  // Includes: name, set/number, mana cost, type, owned counts, oracle (truncated).
  const ot = (c.oracle_text || '').replace(/\n/g, ' ').slice(0, 160);
  const cost = c.mana_cost || '';
  const pt = c.power ? ` ${c.power}/${c.toughness}` : '';
  const owned = c.owned ? ` [${c.owned.n}NF/${c.owned.f}F${c.owned.e ? '/' + c.owned.e + 'E' : ''}]` : '';
  return `- ${c.name} | ${c.set.toUpperCase()} #${c.collector_number} | ${cost} ${c.type_line || ''}${pt}${owned} | ${ot}`;
}

function makePrompt({ format, formatSize, commander, vibe, theme, ownedSummary }) {
  const formatBlurb = format === 'commander'
    ? `100-card singleton Commander deck. Exactly 1 copy of each non-basic-land card. Include the commander as 1 card. Aim for ~37 lands.`
    : `60-card casual deck. Up to 4 copies of each non-basic-land card. Aim for ~24 lands. No commander.`;

  const commanderBlurb = commander
    ? `\n## COMMANDER\nThe user has chosen this commander:\n  ${commander.name} | ${(commander.set || '').toUpperCase()} #${commander.collector_number} | ${commander.mana_cost || ''} ${commander.type_line || ''}\n  Oracle: ${(commander.oracle_text || '').replace(/\n/g, ' ')}\n  Color identity: ${JSON.stringify(commander.color_identity || [])}\n\nAll non-land cards in the deck MUST share this color identity. Lands MUST not produce mana outside this color identity unless they're basic lands the commander can use.\n`
    : '';

  return `You are a Magic: The Gathering deck-building expert. Build a ${formatBlurb}

## VIBE
${vibe || 'auto (you choose what works best with the available cards)'}

## THEME
${theme || '(none specified — use the commander or available cards to choose a coherent theme)'}
${commanderBlurb}
## OWNED CARDS
You can ONLY use the cards listed below for non-basic-land non-commander slots. Use the exact name + set + collector_number for each card so we can match them.
Basic lands (Plains, Island, Swamp, Mountain, Forest) are ALWAYS available — use as many as you need.

${ownedSummary || '(no cards owned)'}

## OUTPUT
Return ONLY a JSON object of this exact shape:

{
  "name": "<short, evocative deck name>",
  "strategy": "<2-3 paragraphs in markdown explaining the gameplan, key synergies, mulligan tips, and notable interactions>",
  "cards": [
    { "name": "...", "set": "tla", "collector_number": "4", "count": 1, "role": "commander|creature|spell|ramp|removal|draw|utility|land|other", "reason": "<one-line why this card>" }
  ],
  "missing_recommended": [
    { "name": "Sol Ring", "reason": "<one-line — why it'd improve the deck>" }
  ]
}

CRITICAL:
- Total cards (sum of counts) MUST equal ${formatSize}.
- Use the exact card name + set + collector_number from the OWNED CARDS list. For basic lands, use set "tla" and collector_number "" — they'll be matched separately.
- Do not include the same printing twice.
- Color identity must be valid for the format.
- 5–10 entries in missing_recommended is reasonable; only suggest cards that would meaningfully improve the deck.

No markdown, no commentary outside the JSON.`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
