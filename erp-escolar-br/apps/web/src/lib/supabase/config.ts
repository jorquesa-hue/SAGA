// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are read from
// the environment normally. The fallbacks below exist ONLY because the
// tooling available when this app was first deployed had no way to set
// Vercel project environment variables (see erp-escolar-br/README.md) —
// they are the same public values in .env.example, safe to inline since
// RLS, not secrecy of these values, is what protects data (spec §3.7).
// Setting the real env vars in the Vercel project (recommended for
// maintainability) overrides these without a code change.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://xozhqzdniagwjlxoiarx.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_mVVELF7O3ZoG3TfWZuCQ2w_igUhucR2";
