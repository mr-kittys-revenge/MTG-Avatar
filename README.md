# Avatar: The Last Airbender — MTG Set Tracker

Mobile-first tracker for the Avatar Universes Beyond MTG set. **937 unique printings** across 9 sub-sets (main, eternal, promos, jumpstart, art series, tokens, beginner box). Built for two-person households who want a shared collection that syncs in real time.

Production deploy: **https://jewpapi.pages.dev** (Cloudflare Pages).

## What it does

| Capability | How |
|---|---|
| **Track** every printing — nonfoil, foil, etched | +/- on each tile, or tap detail for notes/wishlist |
| **Quick-add mode** for fast bootstrapping | ⚡ in header → tap any card to +1 |
| **Bulk import** from text or CSV | More → Bulk add from text — supports plaintext deck-list format and Manabox/Deckbox CSV |
| **Camera scan** (single or fanned multi-card) | 📷 in header — Gemini reads cards from a photo |
| **Live conversation mode** with voice + camera | 🎙 in header — uses Gemini Live API (`gemini-3.1-flash-live-preview`); shows tap-to-add card panels |
| **Deck builder** (Casual 60 or Commander) | More → Decks → Build me a deck — Gemini drafts a list from your owned cards |
| **Deck editing** | Open a saved deck → Edit → +/-/✕ per card, search-add new cards, save |
| **Wishlist + sharing** | Star button per card; More → Copy wishlist as text for shopping lists |
| **"Explain this card"** with follow-ups | ✨ button in card detail modal |
| **Search** by name, or by name + rules text + type | Search bar — tap **N**/**A** scope toggle |
| **Image zoom** in card detail | Tap the big card image |
| **Filters / sort** | Gear icon — set, color, rarity, status, sort |
| **Per-set completion stats** | Stats bar above the grid |
| **Shared cloud datastore** with periodic resync | Cloudflare KV; pulls every 30s + on focus |
| **Offline-tolerant** with cached state | PWA service worker caches shell + images |
| **Daily automated backups** | GitHub Actions workflow → uploads JSON snapshot to artifacts |
| **Manual JSON export/import** | More → Export / Import; round-trips collection + decks |

## Architecture

```
┌────────────────────────────────────┐
│  Static SPA (HTML / JS / cards.json) │
│  • Mobile-first, responsive          │
│  • Service worker for offline + cache │
│  • Quick-add, scan, decks, live, etc. │
└──────────────┬─────────────────────┘
               │ HTTPS, X-App-Password header
               ▼
┌────────────────────────────────────┐
│  Cloudflare Pages Functions /api/* │
│  • _middleware: auth + rate limit  │
│  • auth, collection, decks, scan,   │
│    explain, deck-build, live, export │
└────────────┬───────────────┬───────┘
             │               │
             ▼               ▼
       ┌────────────┐   ┌──────────────┐
       │ Cloudflare │   │ Gemini API   │
       │ KV         │   │ (REST + Live │
       │ (state)    │   │  WebSocket)  │
       └────────────┘   └──────────────┘
```

- **Frontend**: vanilla HTML + JS, no build step. Deployed as static files.
- **Backend**: Cloudflare Pages Functions (one file per route in `functions/api/`). Auth + per-minute rate limiting in `functions/_middleware.js`.
- **Storage**: one Cloudflare KV namespace bound as `COLLECTION`. Three keys: `collection` (card counts + wishlist + notes), `decks` (saved deck objects), `collection_meta` (versioning).
- **AI**: Gemini API. REST for scan / explain / deck builder; Live (WebSocket) for the voice + camera conversational mode.
- **Auth**: shared password gate. Set in Cloudflare env vars; entered once per device.
- **Backups**: GitHub Actions workflow pulls `/api/export` daily, uploads as a 90-day artifact.

## Production setup (one-time)

See **[CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md)** for the click-by-click walkthrough.

Required Cloudflare environment variables on the Pages project:

| Name | Type | Value |
|---|---|---|
| `SHARED_PASSWORD` | Secret | password you and your partner share |
| `GEMINI_API_KEY` | Secret | from https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | Plain | `gemini-2.5-flash` (cheap+fast for scan/explain) |
| `GEMINI_MODEL_SMART` | Plain *(optional)* | `gemini-2.5-pro` or any Pro model — used by the deck builder for better reasoning |
| `GEMINI_RATE_LIMIT` | Plain *(optional)* | per-minute global cap on Gemini calls; default 60 |

Required Cloudflare bindings on the Pages project:

| Variable | Type | Resource |
|---|---|---|
| `COLLECTION` | KV namespace | a KV namespace (we created one called `MTG_COLLECTION`) |

## Backups

The GitHub Actions workflow [`.github/workflows/backup.yml`](.github/workflows/backup.yml) runs daily at 09:17 UTC and uploads a snapshot as an artifact. To enable it, add two **repo secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `APP_URL` | `https://jewpapi.pages.dev` |
| `APP_PASSWORD` | the same value as Cloudflare's `SHARED_PASSWORD` |

Run it once manually via Actions tab → "Daily KV backup" → Run workflow to verify.

To restore: download a backup artifact, then in the app go to More → Import JSON file.

## Local development

```bash
git clone https://github.com/mr-kittys-revenge/MTG-Avatar.git
cd MTG-Avatar
python3 -m http.server 8765
# open http://localhost:8765
```

Functions don't run with the static server — they only execute on Cloudflare's edge. To run them locally:

```bash
npm install -g wrangler
cp .dev.vars.example .dev.vars       # then edit with your real keys
wrangler pages dev .                  # http://localhost:8788
```

## Refreshing card data

Card data is baked into `cards.json` from Scryfall. To update (e.g., new promos):

```bash
python3 scripts/fetch_cards.py
git commit -am "Refresh card data"
git push
```

## File map

| File | Purpose |
|---|---|
| `index.html` | App shell, all CSS |
| `app.js` | All client logic (~1900 lines) |
| `cards.json` | 937 cards from Scryfall (~1.1 MB) |
| `sw.js` | Service worker — caches shell + Scryfall images, skips `/api/*` |
| `manifest.json`, `icon.svg` | PWA install metadata |
| `functions/_middleware.js` | Auth gate + Gemini rate limit |
| `functions/api/auth.js` | Login |
| `functions/api/collection.js` | GET / PUT / PATCH / DELETE shared card state |
| `functions/api/decks.js` | GET / POST / PUT / DELETE saved decks |
| `functions/api/scan.js` | Camera image → Gemini → identified cards |
| `functions/api/explain.js` | Card → Gemini → rules / strategy explanation |
| `functions/api/deck-build.js` | Owned cards + format/commander/vibe → Gemini → deck list |
| `functions/api/live.js` | WebSocket relay between browser and Gemini Live |
| `functions/api/export.js` | Full state dump for backup |
| `.github/workflows/backup.yml` | Daily KV snapshot to GH artifact |
| `scripts/fetch_cards.py` | Re-fetch card data from Scryfall |

## Tips

- **Stuck on a stale build?** Visit `https://jewpapi.pages.dev/?reset=1` once. It unregisters the service worker, clears caches + localStorage, and reloads. Sign in again.
- **Bulk-flag a precon you own:** filter to `tle` (Eternal sub-set), turn on Quick-add, tap each tile.
- **Build a better deck:** set `GEMINI_MODEL_SMART=gemini-2.5-pro` (or a 3.x Pro). Only the deck builder uses it — scan/explain stay on the cheaper Flash.
- **Ripping foils:** in scan or quick-add, toggle the finish to Foil before tapping.

## Data attribution

Card data and images come from [Scryfall](https://scryfall.com). Images are loaded directly from Scryfall's CDN; nothing is bundled in the repo.
