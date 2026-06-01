# Deploying Daimon (free, public)

Daimon ships as a **Docker app** that listens on port `7860`. The instructions below target **Hugging Face Spaces** (free, persistent option, great for an ML portfolio), but the same image runs on Render, Fly.io, Railway, or any Docker host.

Each visitor gets an anonymous session cookie, so everyone has their own private correspondence — no login required. A shared, rate-limited Groq key powers the letters.

---

## Hugging Face Spaces (recommended)

1. **Create a Space** at https://huggingface.co/new-space
   - **SDK:** Docker → *Blank*
   - **Name:** e.g. `daimon` (your URL becomes `https://<you>-daimon.hf.space`)
   - **Hardware:** the free CPU basic tier is enough.

2. **Push this project to the Space.** A Space is just a git repo:
   ```bash
   git init                      # if not already a repo
   git add -A && git commit -m "Daimon"
   git remote add space https://huggingface.co/spaces/<you>/daimon
   git push space main           # use your HF access token as the password
   ```
   (Create a token at https://huggingface.co/settings/tokens — role **write**.)

3. **Add your Groq key as a secret.** In the Space: **Settings → Variables and secrets → New secret**
   - `GROQ_API_KEY` = your `gsk_...` key (free at https://console.groq.com)
   - Optional secret `DAIMON_USER` (e.g. your name) for the salutation.
   - Optional rate-limit tuning (as *variables*, not secrets):
     `DAIMON_RATE_SESSION_PER_HOUR` (default 20), `DAIMON_RATE_GLOBAL_PER_DAY` (default 500).

4. **Wait for the build.** The Space builds the Docker image — this also downloads + bakes the embedding model and prebuilds the vector index, so the live app starts fast. When it's green, share the URL.

> **Note on history:** the free Space disk is ephemeral and resets when the Space rebuilds. Visitors' correspondences persist while it's running but not across rebuilds. For durable history, attach **persistent storage** in Space settings and set the variable `DAIMON_DB=/data/daimon.db`.

The README's YAML frontmatter (`sdk: docker`, `app_port: 7860`) is what tells HF how to run it — keep it at the top of `README.md`.

---

## Test the container locally (optional)

```bash
docker build -t daimon .
docker run --rm -p 7860:7860 -e GROQ_API_KEY=gsk_your_key daimon
# open http://localhost:7860
```

Without a key it still runs — letters and salon fall back to bundled samples.

---

## Other hosts

- **Render:** New → Web Service → from your GitHub repo → *Docker* runtime. Add `GROQ_API_KEY` env var. (Free tier sleeps when idle; disk is ephemeral.)
- **Fly.io:** `fly launch` (it detects the Dockerfile), `fly secrets set GROQ_API_KEY=...`, `fly deploy`. Add a volume mounted at `/data` and set `DAIMON_DB=/data/daimon.db` for persistent history.

---

## Protecting your Groq key

The deployed app uses **your** key for everyone, guarded by:
- a **per-visitor hourly cap** (`DAIMON_RATE_SESSION_PER_HOUR`, default 20 actions), and
- a **global daily cap** (`DAIMON_RATE_GLOBAL_PER_DAY`, default 500 actions; a salon counts as one action per philosopher).

When a cap is hit, the API returns HTTP 429 with a friendly message. Tune the numbers to your Groq tier, or lower them if traffic spikes.
