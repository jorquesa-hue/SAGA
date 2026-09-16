-- ERP Escolar BR — Fase 1, Milestone 1: Schema + RLS
-- Spec: erp-escolar-br-arquitetura.md

create extension if not exists pgcrypto;

-- All dates in this product are interpreted in America/Sao_Paulo (spec §6).
-- timestamptz columns are still stored internally as UTC; this only sets the
-- session/display default for tooling (psql, migrations, seed scripts)
-- connecting to this database.
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Sao_Paulo');
end
$$;
