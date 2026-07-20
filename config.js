// Kempoka shared-backend config — optional. Leave blank to play fully offline/local
// (unlimited private "My Fighters", no shared roster, no highscore list — exactly how the
// game behaved before this feature). Fill in all three to turn on the shared public fighter
// slot and the tournament highscore list; see README.md's "Shared roster & highscores" section
// for the exact Supabase + Cloudflare Turnstile setup steps.
//
// These are all meant to be public (shipped in client code) — the Supabase publishable key
// (formerly called the "anon" key; Supabase is retiring that name) grants nothing beyond what
// supabase-schema.sql's row-level-security policies allow (public reads, no direct writes), and
// the Turnstile *site* key is a public widget id, not a secret.
window.KEMPOKA_CONFIG = {
  SUPABASE_URL: 'https://lkvcjwkhmaluceuqaoli.supabase.co',              // e.g. 'https://xxxxxxxx.supabase.co'
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_Il1Su_CRfMoQbb1i3SPXag_6Y3M1UC6',  // Project Settings → API Keys → Publishable key (starts sb_publishable_...)
  TURNSTILE_SITE_KEY: '0x4AAAAAAD56_dC8AAVqmyCs',        // Cloudflare Turnstile → your widget's Site Key
};
