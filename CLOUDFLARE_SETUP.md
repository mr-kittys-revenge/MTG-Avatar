# Cloudflare Pages setup — step by step

You'll do this once. After this, every `git push` to `main` auto-deploys.

## 1. Connect the repo

1. Sign in to https://dash.cloudflare.com
2. Left sidebar → **Workers & Pages**
3. **Create application** → **Pages** tab → **Connect to Git**
4. Authorize Cloudflare to read your GitHub repos
5. Pick **`mr-kittys-revenge/MTG-Avatar`** → **Begin setup**

## 2. Build settings

| Field | Value |
|---|---|
| Project name | `mtg-avatar-tracker` (becomes `mtg-avatar-tracker.pages.dev`) |
| Production branch | `main` |
| Build command | *(leave blank)* |
| Build output directory | `/` |
| Root directory | *(leave blank)* |

Click **Save and Deploy**. The first deploy takes ~1 min.

## 3. Create the KV namespace (storage)

After the first deploy succeeds:

1. Sidebar → **Workers & Pages** → **KV**
2. **Create a namespace** → name it `MTG_COLLECTION` → **Add**
3. Go back to your Pages project → **Settings** → **Functions** → **KV namespace bindings**
4. **Add binding**:
   - **Variable name**: `COLLECTION` *(must be exactly this)*
   - **KV namespace**: `MTG_COLLECTION`
5. Save

## 4. Set environment variables

Same Settings page → **Environment variables**:

| Variable | Type | Value |
|---|---|---|
| `SHARED_PASSWORD` | Secret (encrypt) | a password you and your partner will both type once |
| `GEMINI_API_KEY` | Secret (encrypt) | your key from https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | Plain text | `gemini-2.5-flash` |

Make sure to add them under **Production** (and optionally Preview too).

## 5. Trigger a redeploy

After adding bindings/env vars, the existing build doesn't pick them up — you need a new deploy:

- Pages project → **Deployments** → **... (kebab on latest)** → **Retry deployment**
- Or just push any commit (`echo "" >> README.md && git commit -am "redeploy"`)

## 6. Verify it works on `*.pages.dev`

Open `https://mtg-avatar-tracker.pages.dev` (or whatever Cloudflare gave you).

You should see the password screen. Enter the `SHARED_PASSWORD` you set. After login, the card grid loads from the server (empty at first).

Test it:
- +1 a card → should briefly show "Saving…" then "Saved" indicator top-right
- Refresh the page → count persists (it's coming from KV now, not localStorage)
- Open in another browser/private window → enter password → see the same count

## 7. Custom domain — `mtg.franklinmerritt.com`

### In Cloudflare Pages

1. Pages project → **Custom domains** → **Set up a custom domain**
2. Enter `mtg.franklinmerritt.com`
3. Cloudflare will show you **one CNAME record** to add at GoDaddy:
   ```
   Type:   CNAME
   Name:   mtg
   Value:  mtg-avatar-tracker.pages.dev
   ```

### In GoDaddy

1. https://dcc.godaddy.com → My Products → DNS for `franklinmerritt.com`
2. **Add record** → Type **CNAME**, Name `mtg`, Value `mtg-avatar-tracker.pages.dev`, TTL 1 hour
3. Save

DNS propagates in 5–60 min. Cloudflare auto-issues an HTTPS cert. Your final URL: **`https://mtg.franklinmerritt.com`**.

Once that works, you can disable the GitHub Pages deploy at https://github.com/mr-kittys-revenge/MTG-Avatar/settings/pages (Source → None).

## Troubleshooting

**Login fails with "wrong password"**: env var typo or you didn't redeploy after setting it.

**+1 doesn't persist**: KV binding name is wrong. Must be exactly `COLLECTION`. Check Settings → Functions → KV.

**Camera scan errors with "GEMINI_API_KEY missing"**: env var not set or not redeployed.

**"Cannot read properties of undefined" in Function logs**: pop a Pages **Function log** under **Deployments → Functions** and read the stack trace.

## Local development with `wrangler pages dev`

If you want to develop locally with Functions enabled:

```bash
npm install -g wrangler        # one-time
cp .dev.vars.example .dev.vars
# edit .dev.vars and put a real GEMINI_API_KEY + SHARED_PASSWORD
wrangler pages dev .
```

Open `http://localhost:8788`. Local KV is in-memory and resets when the process restarts.
