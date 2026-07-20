// Kempoka's ONLY write path for shared characters/scores. Deploy with:
//   supabase functions deploy kempoka-write --project-ref <ref>
// Then set its one non-Supabase secret (never in the client, never in this repo):
//   supabase secrets set TURNSTILE_SECRET_KEY=... --project-ref <ref>
// SUPABASE_URL and the project's publishable/secret keys are auto-injected by the platform for
// every Edge Function — nothing to configure for those. Supabase is retiring the legacy
// SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY single-string vars in favor of
// SUPABASE_PUBLISHABLE_KEYS/SUPABASE_SECRET_KEYS — JSON objects keyed by key name (a project can
// have more than one named key) — so firstKey() below picks whichever is configured, falling back
// to the legacy vars for a project that hasn't migrated its keys yet.
//
// Why a function instead of letting the client write directly: supabase-schema.sql gives the
// characters/scores tables read-only RLS (no write policies at all), so a direct client write is
// always denied — even from a signed-in-anonymously user. This function is the sole writer. Per
// request it: (1) resolves the caller's identity from their anonymous-auth JWT, (2) verifies a
// Cloudflare Turnstile token so scripted/parallel spam can't reach the database, (3) clamps every
// field to the same bounds the Create-fighter form enforces (mirrors normalizeCharacter in
// game-logic.js — duplicated here on purpose: Deno edge runtime, not Node, can't require() that
// file), then (4) writes with the secret key (full access, bypasses RLS), forcing owner_id to the
// caller's own uid.
import { createClient } from "npm:@supabase/supabase-js@2";

function firstKey(json: string | undefined): string | undefined {
  if (!json) return undefined;
  try { return Object.values(JSON.parse(json))[0] as string; } catch { return undefined; }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLISHABLE_KEY = firstKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SECRET_KEY = firstKey(Deno.env.get("SUPABASE_SECRET_KEYS")) ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---- validation (mirrors normalizeCharacter's clamps/enums in game-logic.js) ----
const HAIR_ORDER = ['short','braid','bald','punk','leia','headguard'];
const BEARD_ORDER = ['none','full','moustache','goatee','long'];
const SPECIAL_TYPE_IDS = ['combo','throw','lunge','spin','cleaver'];
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const BELT_CHOICES = [null,
  'kyu12','kyu11','kyu10','kyu9','kyu8','kyu7','kyu6','kyu5','kyu4','kyu3','kyu2','kyu1',
  'dan1','dan2','dan3','dan4','dan5'];

function num(v: unknown, min: number, max: number, dflt: number): number {
  return (typeof v === 'number' && Number.isFinite(v)) ? Math.min(max, Math.max(min, v)) : dflt;
}
function str(v: unknown, max: number, dflt: string): string {
  return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : dflt;
}
function hex(v: unknown, dflt: string): string {
  return (typeof v === 'string' && HEX_RE.test(v)) ? v : dflt;
}

function clampCharacter(raw: any) {
  const b = raw?.build || {}, h = raw?.hair || {}, s = raw?.stats || {}, sp = raw?.special || {};
  return {
    name: str(raw?.name, 16, 'Fighter'),
    beltRank: BELT_CHOICES.includes(raw?.beltRank) ? raw.beltRank : null,
    outfit: raw?.outfit === 'spandex' ? 'spandex' : 'gi',
    gi: hex(raw?.gi, '#16bcbc'),
    build: { scale: num(b.scale, 0.8, 1.25, 1.0), girth: num(b.girth, 0.75, 1.5, 1.0) },
    skin: hex(raw?.skin, '#e8b98f'),
    hair: { color: hex(h.color, '#2a2a2a'), style: HAIR_ORDER.includes(h.style) ? h.style : 'short' },
    beard: raw?.beard === true || BEARD_ORDER.includes(raw?.beard) ? raw.beard : false,
    stats: {
      maxHp: num(s.maxHp, 80, 140, 100), speed: num(s.speed, 0.8, 1.35, 1.0),
      power: num(s.power, 0.8, 1.4, 1.0), defense: num(s.defense, 0.8, 1.2, 1.0),
    },
    special: { name: str(sp?.name, 22, 'Special'), type: SPECIAL_TYPE_IDS.includes(sp?.type) ? sp.type : 'combo' },
  };
}

async function verifyTurnstile(token: unknown, ip: string | null): Promise<boolean> {
  if (typeof token !== 'string' || !token) return false;
  const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const result = await res.json();
    return result.success === true;
  } catch {
    return false;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

  // Identity comes from the caller's own anonymous-auth JWT — never trust a client-supplied id.
  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'bad json' }, 400); }
  const { action, payload, turnstileToken } = body || {};

  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for');
  if (!(await verifyTurnstile(turnstileToken, ip))) return jsonResponse({ error: 'turnstile verification failed' }, 403);

  const admin = createClient(SUPABASE_URL, SECRET_KEY);

  if (action === 'publish_character') {
    // char_id and data.id must match: the client's normalizeCharacter() requires a non-empty
    // `id` on every record or drops it, and it re-normalizes every row read back from
    // listCharacters() — so `data` here has to be the FULL shape normalizeCharacter produces,
    // id included, not just the clamped stat/appearance fields.
    const charId = str(payload?.id, 40, 'custom_' + user.id.slice(0, 8));
    const clamped = { id: charId, ...clampCharacter(payload) };
    const { error } = await admin.from('characters').upsert({
      owner_id: user.id,
      char_id: charId,
      name: clamped.name,
      data: clamped,
      updated_at: new Date().toISOString(),
    });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ ok: true });
  }

  if (action === 'unpublish_character') {
    const { error } = await admin.from('characters').delete().eq('owner_id', user.id);
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ ok: true });
  }

  if (action === 'submit_score') {
    const name = str(payload?.name, 16, 'Player');
    const score = Math.max(0, Math.min(100000, Math.trunc(Number(payload?.score) || 0)));
    const beaten = Math.max(0, Math.min(999, Math.trunc(Number(payload?.beaten) || 0)));
    const { error } = await admin.from('scores').insert({ owner_id: user.id, name, score, beaten });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'unknown action' }, 400);
});
