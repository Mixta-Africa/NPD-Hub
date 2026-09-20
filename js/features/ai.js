/* features/ai.js — AI provider chain (Groq, Cerebras, SambaNova) and askAI(). */

import { CEREBRAS_API_KEY, GROQ_API_KEY, SAMBANOVA_API_KEY } from '../core/config.js';

/* ══════════════════════════════════════════════════════════════
   ASK — question answering over task and project data

   ACCESS MODEL (this is the important part):
   The model never queries the database. The frontend builds the
   context, and it can only build context from items the signed-in
   user is already permitted to see — the same visibility test the
   Products list uses. An admin's context includes everything; a
   member's includes only what they own, are shared on, or that their
   department is assigned to. The model cannot widen its own scope
   because it never sees anything outside the context it is handed.
   ══════════════════════════════════════════════════════════════ */
/* All three providers are OpenAI-compatible, so each exposes GET /v1/models.
   Model IDs get deprecated without warning — Groq retired
   llama-3.3-70b-versatile in June 2026 — so rather than hardcoding one ID we
   list preferences and DISCOVER what the account can actually reach at
   runtime. `prefer` entries are matched as substrings, best first; if none
   match we fall back to any chat model the provider offers. */
export const AI_PROVIDERS = [
  { name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    key:  () => GROQ_API_KEY,
    prefer: ['gpt-oss-120b', 'qwen3', 'gpt-oss-20b', 'llama-4', 'llama-3.3-70b'] },
  { name: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    key:  () => CEREBRAS_API_KEY,
    prefer: ['llama-3.3-70b', 'llama3.3-70b', 'qwen-3', 'gpt-oss', 'llama-4'] },
  { name: 'SambaNova',
    base: 'https://api.sambanova.ai/v1',
    key:  () => SAMBANOVA_API_KEY,
    prefer: ['Llama-3.3-70B', 'Llama-4', 'DeepSeek', 'Qwen3'] },
];

// Cache of resolved model IDs so we only hit /models once per session
export const _aiModelCache = {};

export async function discoverModel(p) {
  if (_aiModelCache[p.name]) return _aiModelCache[p.name];
  const resp = await fetch(p.base + '/models', {
    headers: { 'Authorization': 'Bearer ' + p.key() },
  });
  if (!resp.ok) throw new Error(p.name + ' model list returned ' + resp.status);
  const data = await resp.json();
  const ids  = (data.data || []).map(m => m.id).filter(Boolean);
  if (ids.length === 0) throw new Error(p.name + ' returned no models for this key');

  // First preference that actually exists
  for (const want of p.prefer) {
    const hit = ids.find(id => id.toLowerCase().includes(want.toLowerCase()));
    if (hit) { _aiModelCache[p.name] = hit; return hit; }
  }
  // Nothing preferred — take any chat-capable model, skipping non-chat ones
  const chat = ids.find(id => !/whisper|tts|embed|guard|ocr|rerank/i.test(id));
  const pick = chat || ids[0];
  _aiModelCache[p.name] = pick;
  console.info(p.name + ': no preferred model available, using ' + pick);
  return pick;
}

export function providerConfigured(p) {
  const k = p.key();
  return !!k && !k.startsWith('__');   // unreplaced placeholder means not configured
}

async function callProvider(p, model, messages, maxTokens) {
  const resp = await fetch(p.base + '/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + p.key(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens || 1200, temperature: 0.2, messages }),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    const msg = e.error?.message || (p.name + ' returned ' + resp.status);
    const err = new Error(msg);
    // Flag a stale/absent model so the caller can re-discover and retry
    err.modelGone = resp.status === 404 || /does not exist|decommission|deprecat|not found/i.test(msg);
    throw err;
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(p.name + ' returned an empty response');
  return text;
}

export async function askAI(messages, maxTokens) {
  const available = AI_PROVIDERS.filter(providerConfigured);
  if (available.length === 0) {
    throw new Error('No AI provider is configured. Add GROQ_API_KEY, CEREBRAS_API_KEY or SAMBANOVA_API_KEY to your deployment secrets.');
  }
  const failures = [];
  for (const p of available) {
    try {
      let model = await discoverModel(p);
      try {
        return { text: await callProvider(p, model, messages, maxTokens), provider: p.name, model };
      } catch(err) {
        if (!err.modelGone) throw err;
        // Model was deprecated since we cached it — re-discover once and retry
        delete _aiModelCache[p.name];
        model = await discoverModel(p);
        return { text: await callProvider(p, model, messages, maxTokens), provider: p.name, model };
      }
    } catch(err) {
      failures.push(p.name + ': ' + err.message);
      console.warn(p.name + ' failed, trying next provider:', err.message);
    }
  }
  throw new Error('All providers failed.\n' + failures.join('\n'));
}
