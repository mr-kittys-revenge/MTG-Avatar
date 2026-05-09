# Avatar: The Last Airbender — MTG Set Tracker

Mobile-friendly tracker for the Avatar Universes Beyond MTG set. **937 unique printings** across 9 sub-sets (main, eternal, promos, jumpstart, art series, tokens, beginner box).

## Phase 1 (done) — local tracker

- Card grid with images, search, filters, and sort
- Tracks **nonfoil**, **foil**, and **etched-foil** quantities per printing
- Wishlist toggle and per-card notes
- Stats bar with overall + per-set completion %
- JSON export/import for backup
- Works offline once cached (PWA service worker)

## Run it locally

```
cd ~/Documents/MTG-Avatar-Tracker
python3 -m http.server 8765
```

Then open http://localhost:8765 in your browser.

## Run on your phone (same Wi-Fi)

1. Find your Mac's local IP: System Settings → Network → Wi-Fi → Details → TCP/IP
2. On your phone, visit `http://<your-mac-ip>:8765`
3. iOS Safari: Share → Add to Home Screen — installs as an app

## Hosting (recommended for camera scanning)

The camera in Phase 2 needs **HTTPS**, which `localhost` won't give you on a phone. Easiest options:

- **GitHub Pages** (free): push this folder to a repo, enable Pages → instant HTTPS at `<user>.github.io/<repo>`
- **Cloudflare Pages**, **Netlify**, **Vercel**: drag-and-drop deploy

Once hosted, "Add to Home Screen" on iOS gives you a real app icon and full-screen mode.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell + styles |
| `app.js` | All app logic |
| `cards.json` | 937 card records (Scryfall-sourced, 813 KB) |
| `manifest.json` | PWA manifest |
| `sw.js` | Service worker (offline cache) |
| `icon.svg` | App icon |
| `scripts/fetch_cards.py` | Re-fetch card data from Scryfall |

## Refreshing card data

Re-run `python3 scripts/fetch_cards.py` to pull the latest from Scryfall (e.g., if new promos drop).

## Phase 2 (done) — Gemini AI camera scanning + explanations

- **Camera scan**: tap the camera icon in the header, frame a card, tap shutter. Gemini reads the title + set code + collector number and matches against the local catalog.
- **Foil / Etched / Keep-open toggles** in the scan view. With "Keep open" checked, tap +1 and the scanner stays ready for the next card.
- **Explain this card**: from any card detail, tap "✨ Explain this card" for a Gemini-written rules explanation tailored to your knowledge level.
- **Bring your own key**: enter a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) in Settings (More → AI Settings). Stored only in your browser.

### Setting up Gemini

1. Go to https://aistudio.google.com/apikey, click **Create API key** (free)
2. In the tracker: bottom bar → **More** → **⚙ AI Settings (Gemini)**
3. Paste the key, hit **Send a test ping** to verify, then **Save**

The free tier easily covers thousands of scans/month for personal use.

### Camera notes

- iOS/Android browsers require **HTTPS** (or localhost) for camera access. Once deployed to GitHub Pages, your phone can access the camera fine.
- Best lighting + flat card on a contrasting background = best identification accuracy.
- For variant treatments (showcase, borderless, etc.), make sure the bottom of the card with the collector number is in frame — that's how Gemini distinguishes printings.

## Data attribution

Card data and images: [Scryfall](https://scryfall.com). Images are loaded directly from Scryfall's CDN; no images are bundled.
