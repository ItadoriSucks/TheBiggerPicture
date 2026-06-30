# Campaign Studio (DNA Studio integration)

The **Campaigns** tab generates real AI social-media campaigns (per-platform
captions + hashtags) from a website. It's powered by a local, self-hosted
instance of [DNA Studio](https://github.com/moesaif/dna-studio), which runs the
generation on **Groq** (a free, no-credit-card, OpenAI-compatible LLM API).

## How it fits together
- `server/dnaClient.js` — holds a service session with DNA Studio and proxies
  brand analysis + campaign generation (DNA Studio's API is NextAuth-gated and
  streams SSE).
- `server/routes/campaign.js` — `POST /api/campaign` (auth) runs analyze →
  generate and saves the result to the `campaigns` table; `GET` lists them.
- Frontend "Campaign Studio" page calls `/api/campaign` and renders/saves the
  output like any other asset.

## Running DNA Studio locally
DNA Studio is a separate app (Next.js + Postgres + Redis), run via Docker on
**port 3100** (so it doesn't collide with this app on 3000):

```bash
git clone https://github.com/moesaif/dna-studio.git
cd dna-studio
# .env: LLM_PROVIDER=openai, OPENAI_BASE_URL=https://api.groq.com/openai/v1,
#       OPENAI_MODEL=llama-3.3-70b-versatile, OPENAI_API_KEY=<your free Groq key>
# patch src/lib/llm/providers/openai.ts to pass `baseURL` from OPENAI_BASE_URL,
# remap the app port to 3100 in docker-compose.yml, then:
docker compose up -d --build
```

Get a free Groq key (no card) at https://console.groq.com/keys.

This app reaches DNA Studio at `http://localhost:3100` by default; override with
`DNA_STUDIO_URL` if needed. The Groq key lives only in DNA Studio's own `.env`
(gitignored) — never in this repo.
