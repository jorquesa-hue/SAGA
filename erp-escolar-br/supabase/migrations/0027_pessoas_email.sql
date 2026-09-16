-- E-mail em pessoas.
--
-- Até aqui o schema não tinha nenhum campo de e-mail: nem em pessoas, nem
-- em lugar nenhum. Quem entra pelo convite (invite-pessoa) tem e-mail em
-- auth.users, mas isso é credencial de login, não dado de contato — a
-- maioria dos responsáveis nunca acessa o portal, e aluno nunca tem conta.
-- Sem esta coluna não existe para onde mandar recibo, nota fiscal ou
-- régua de cobrança.
--
-- Deliberadamente NÃO é único. Dois irmãos compartilham o e-mail da mãe;
-- uma mãe usa o mesmo endereço para si e para o filho menor. Unicidade
-- aqui rejeitaria cadastros legítimos e corriqueiros.
--
-- A validação é proposital e conscientemente frouxa: exige algo antes do
-- @, algo depois, e um ponto no domínio. Validar e-mail "de verdade" por
-- regex é folclore — o RFC 5322 admite formas que nenhuma regex razoável
-- cobre, e toda tentativa de ser rigorosa acaba rejeitando endereço válido
-- de gente real. O que prova que um e-mail existe é uma mensagem chegar
-- nele, e é isso que emails_transacionais (0028) registra.

alter table pessoas add column email text;

alter table pessoas add constraint pessoas_email_formato
  check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

create index idx_pessoas_email on pessoas (escola_id, email)
  where email is not null and deleted_at is null;

comment on column pessoas.email is
  'E-mail de contato (recibo, nota fiscal, régua de cobrança). Não é credencial de login — essa vive em auth.users.';

-- Backfill de quem já tem login: o endereço já foi confirmado pelo fluxo
-- de convite do Supabase Auth, então é melhor dado do que campo vazio.
-- Só preenche onde está nulo, para nunca sobrescrever um contato que
-- alguém tenha cadastrado à mão.
update pessoas p
   set email = u.email
  from auth.users u
 where p.auth_user_id = u.id
   and p.email is null
   and u.email is not null
   and u.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
