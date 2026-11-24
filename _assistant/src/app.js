// LEL Staff Portal assistant (logic; src/worker.js is the Worker entry): a Cloudflare Worker that holds the Anthropic API key, reads the
// public LEL layers and answers staff questions. Read-only: it never writes to ArcGIS.
//
// POST /chat   {"code": "<staff access code>", "messages": [{"role": "user"|"assistant", "content": "..."}]}
//          ->  {"answer": "..."}  or  {"error": "..."}
// GET  /health ->  {"ok": true, "snapshot_as_of": "..."}
//
// Secrets (wrangler secret put): ANTHROPIC_API_KEY, STAFF_CODE.
// Vars (wrangler.toml): ALLOWED_ORIGINS (comma separated).

import Anthropic from "@anthropic-ai/sdk";
import { fetchSnapshot } from "./data.js";
import { SYSTEM_RULES, snapshotBlock } from "./prompt.js";

export const MODEL = "claude-opus-5-5";
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const MAX_TURNS = 12;          // most recent messages kept
const MAX_CHARS = 2000;        // per message
const RATE_LIMIT = 30;         // questions per IP per hour (best effort, per worker instance)

let cache = { at: 0, snapshot: null };
const hits = new Map();

function cors(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin : "null",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

function limited(ip, now) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

// Equal-time string compare, so the access code can't be guessed from response timing.
function same(a, b) {
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

export function cleanMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const out = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_TURNS);
  while (out.length && out[0].role !== "user") out.shift();
  return out.length && out[out.length - 1].role === "user" ? out : null;
}

async function getSnapshot(fetchFn, now) {
  if (!cache.snapshot || now - cache.at > SNAPSHOT_TTL_MS) {
    cache = { at: now, snapshot: await fetchSnapshot(fetchFn, now) };
  }
  return cache.snapshot;
}

export async function answer(client, snapshot, messages) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: SYSTEM_RULES, cache_control: { type: "ephemeral" } },
      { type: "text", text: snapshotBlock(snapshot), cache_control: { type: "ephemeral" } },
    ],
    messages,
  });
  if (response.stop_reason === "refusal") {
    return "Sorry, I can't help with that one. Try asking about the Project's mobs, figures or methods.";
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (response.stop_reason === "max_tokens") return text + "\n\n(Answer cut short. Ask a narrower question.)";
  return text || "Sorry, I didn't get an answer for that. Please try again.";
}

export default {
  async fetch(request, env, ctx, deps = {}) {
    const url = new URL(request.url);
    const { ok, headers } = cors(request.headers.get("Origin"), env);
    if (request.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers });
    const fetchFn = deps.fetch || fetch;
    const now = deps.now || Date.now();

    if (request.method === "GET" && url.pathname === "/health") {
      try {
        const s = await getSnapshot(fetchFn, now);
        return json({ ok: true, snapshot_as_of: s.as_of, mobs: s.mobs.length }, 200, headers);
      } catch (e) {
        return json({ ok: false, error: String(e.message || e) }, 502, headers);
      }
    }
    if (request.method !== "POST" || url.pathname !== "/chat") return json({ error: "Not found" }, 404, headers);
    if (!ok) return json({ error: "This page is not allowed to use the assistant." }, 403, headers);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400, headers); }
    if (!env.STAFF_CODE || !same(body.code, env.STAFF_CODE)) return json({ error: "Wrong staff access code." }, 401, headers);
    const messages = cleanMessages(body.messages);
    if (!messages) return json({ error: "Ask a question first." }, 400, headers);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (limited(ip, now)) return json({ error: "That's a lot of questions this hour. Please try again shortly." }, 429, headers);

    let snapshot;
    try {
      snapshot = await getSnapshot(fetchFn, now);
    } catch (e) {
      console.error("snapshot failed", e);
      return json({ error: "I couldn't read the Project data just now. Please try again in a minute." }, 502, headers);
    }
    try {
      const client = deps.client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      return json({ answer: await answer(client, snapshot, messages), as_of: snapshot.as_of }, 200, headers);
    } catch (e) {
      console.error("answer failed", e);
      const busy = e instanceof Anthropic.RateLimitError || (e && e.status >= 500);
      return json({ error: busy ? "The assistant is busy. Please try again in a minute." : "Something went wrong answering that." }, 502, headers);
    }
  },
};

export function _resetForTests() { cache = { at: 0, snapshot: null }; hits.clear(); }
