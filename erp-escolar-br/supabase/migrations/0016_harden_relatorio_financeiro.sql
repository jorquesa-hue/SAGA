-- Pins search_path on fn_relatorio_financeiro (0015), same fix already
-- applied to the earlier validation/JWT functions in 0009 — Supabase's
-- advisor flags any function that omits it as having a role-mutable
-- search_path. Follow-up migration rather than editing 0015 in place —
-- 0015 was already applied to the real project before this was caught.
alter function fn_relatorio_financeiro(date, date) set search_path = public, pg_temp;
