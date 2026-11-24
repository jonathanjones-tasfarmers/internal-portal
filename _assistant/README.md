# LEL Staff Portal assistant

Stage 4 of the Sea Forest Hub requests (24 Nov 2026). This is a chat assistant for the Staff Portal. It answers questions from the Project's public data layers.

- **`src/`** is a small Cloudflare Worker.
  - It keeps the Anthropic API key, which the public GitHub Pages files cannot hold.
  - It reads the public LEL layers that the portal pages already read without a token: Trial Headline, Emissions, Economics, OptiWeigh weights, ADG comparison, lick block usage and model assumptions.
  - It builds one compact data snapshot every 30 minutes.
  - It answers with `claude-opus-5-5`, with refusal fallbacks switched on.
  - It is read-only. It never writes to ArcGIS.
- **`../staff-assistant-embed.html`** is the chat panel. Embed it in the Staff Portal home page with an iframe, like the other `*-embed.html` pages.

## Protection

The panel is on a public website, so the service guards against misuse in four ways:

- It only answers requests from the allowed page origin (`ALLOWED_ORIGINS` in `wrangler.toml`).
- It needs the shared **staff access code** (`STAFF_CODE`). Staff enter it once and the browser remembers it.
- It limits each IP address to 30 questions an hour. This is best effort.
- It cuts off long conversations. It keeps the last 12 messages and up to 2,000 characters per message.

Also set a **monthly spend limit** on the Anthropic account. That is the hard cap on cost.

The assistant only sees data that is already public. Staff questions are sent to Anthropic to be answered.

## One-off setup (TasFarmers)

1. **Anthropic account.** Create an organisation at console.anthropic.com in TasFarmers' name and add billing.
   - Set a monthly spend limit, for example $50.
   - Create an API key named `lel-staff-assistant`.
2. **Cloudflare account.** Create a free account at dash.cloudflare.com in TasFarmers' name. Note the Account ID shown on the Workers page.
   - Create an API token with the "Edit Cloudflare Workers" template.
3. **GitHub.** In this repository's Settings > Secrets and variables > Actions, add two secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. **First deploy.** Run Actions > "Staff assistant" > Run workflow > `deploy`. The log shows the Worker's address, for example `https://lel-staff-assistant.<name>.workers.dev`.
5. **Worker secrets.** In Cloudflare, go to Workers > lel-staff-assistant > Settings > Variables and Secrets. Add two secrets:
   - `ANTHROPIC_API_KEY`: the key from step 1.
   - `STAFF_CODE`: a passphrase to share with staff.
6. **Panel.** Put the Worker's address in `ASSISTANT_URL` near the bottom of `staff-assistant-embed.html` and commit it.
   - Then add an iframe to the Staff Portal home page: `https://jonathanjones-tasfarmers.github.io/internal-portal/staff-assistant-embed.html`, about 700 px high.
7. **Check.** Open `<worker address>/health`. It should show `"ok": true` and today's date.

## Day to day

- **Pull requests** that touch this folder run the tests and print the live data snapshot the assistant would answer from.
- **Deploy after a change:** Actions > "Staff assistant" > `deploy`.
- **Change the staff code:** edit `STAFF_CODE` in Cloudflare. Staff are asked for the new code the next time they ask a question.
- **Tests:** `npm ci && npm test`. Live snapshot: `node scripts-snapshot.mjs`.

## Later: Producer Portals

Each producer must see only their own farm. Before the assistant can go into the Producer Portals, the Worker needs to check the person's ArcGIS sign-in and then filter the snapshot to their farm.
