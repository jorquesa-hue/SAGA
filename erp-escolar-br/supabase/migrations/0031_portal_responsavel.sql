-- O que o responsável consegue FAZER pelo portal, além de olhar: assinar o
-- contrato do filho e manter o próprio e-mail em dia.
--
-- As duas operações têm o mesmo formato — função SECURITY DEFINER com
-- autorização escrita à mão — e pelo mesmo motivo, que vale explicar uma
-- vez só:
--
-- Uma política de RLS autoriza LINHAS, não COLUNAS. Dar ao responsável um
-- `pessoas_update_self` resolveria o e-mail e abriria um buraco enorme
-- junto, porque `authenticated` tem UPDATE na tabela inteira: com a
-- política valendo, um POST direto em /rest/v1/pessoas trocaria o próprio
-- `papeis` para {admin}. Escalada de privilégio em uma linha de JSON.
-- GRANT por coluna também não serve: é por ROLE, e secretaria e
-- responsável são o mesmo role `authenticated` — separá-los por coluna
-- tiraria da secretaria o que ela precisa.
--
-- Função definer resolve porque ela É a fronteira: recebe só o que pode
-- mudar, decide sozinha de quem, e não existe caminho para pedir mais.

-- ── Assinar o contrato ────────────────────────────────────────────────────
--
-- O texto e o hash NÃO entram por parâmetro. São produzidos aqui dentro,
-- por fn_contrato_texto (0029), no mesmo instante da gravação. Se viessem
-- do navegador, um POST forjado assinaria um contrato com outro valor de
-- anuidade e o dossiê provaria exatamente a coisa errada — que é o oposto
-- do que uma assinatura serve para fazer.
--
-- sha256() é built-in do PostgreSQL (11+), de propósito: pgcrypto vive no
-- schema `extensions` no Supabase e em nenhum lugar no Postgres puro que a
-- suíte local usa, e uma prova de integridade não deve depender de onde
-- uma extensão foi instalada.
--
-- Limite declarado do p_ip: quem chama informa. O caminho honesto é o
-- route handler /api/assinar-contrato, que o lê do x-forwarded-for da
-- requisição; uma chamada direta ao PostgREST poderia informar outro. É a
-- mesma postura já aceita em consentimentos_lgpd.ip, e a diferença que
-- importa está garantida: o que o signatário NÃO consegue escolher é o
-- conteúdo que está assinando.
create or replace function fn_assinar_contrato(
  p_contrato_id uuid,
  p_ip inet,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pessoa_id uuid;
  v_escola_id uuid;
  v_vinculo vinculo_responsavel;
  v_nome text;
  v_cpf text;
  v_texto text;
  v_id uuid;
begin
  if p_ip is null then
    raise exception 'ip_obrigatorio' using errcode = '22023';
  end if;

  v_escola_id := fn_jwt_escola_id();
  v_pessoa_id := fn_current_pessoa_id();
  if v_pessoa_id is null or v_escola_id is null then
    raise exception 'sem_identidade' using errcode = '42501';
  end if;

  -- Autorização explícita, porque SECURITY DEFINER desligou a RLS: quem
  -- assina é o responsável FINANCEIRO do aluno daquele contrato. É a
  -- mesma condição de contratos_select_responsavel — quem pode ler é quem
  -- pode assinar —, escrita aqui porque a política não está mais valendo.
  select ra.vinculo, pe.nome, pe.cpf
    into v_vinculo, v_nome, v_cpf
    from contratos c
    join matriculas m
      on m.id = c.matricula_id and m.escola_id = c.escola_id
    join responsaveis_alunos ra
      on ra.aluno_id = m.aluno_id and ra.escola_id = m.escola_id
    join pessoas pe
      on pe.id = ra.responsavel_pessoa_id and pe.escola_id = ra.escola_id
   where c.id = p_contrato_id
     and c.escola_id = v_escola_id
     and c.deleted_at is null
     and m.deleted_at is null
     and ra.responsavel_pessoa_id = v_pessoa_id
     and ra.financeiro = true
     and ra.deleted_at is null
     and pe.deleted_at is null
   limit 1;

  if not found then
    -- Mesma mensagem para "não existe" e para "não é seu": responder
    -- coisas diferentes transformaria este endpoint em um jeito de
    -- descobrir quais contratos existem.
    raise exception 'contrato_nao_encontrado' using errcode = '42501';
  end if;

  if exists (
    select 1 from contratos_assinaturas
     where contrato_id = p_contrato_id and escola_id = v_escola_id
  ) then
    raise exception 'contrato_ja_assinado' using errcode = '23505';
  end if;

  v_texto := fn_contrato_texto(p_contrato_id);
  if v_texto is null then
    raise exception 'contrato_nao_encontrado' using errcode = '42501';
  end if;

  insert into contratos_assinaturas (
    escola_id, contrato_id, signatario_pessoa_id, signatario_nome,
    signatario_cpf, vinculo, documento_texto, documento_hash, ip, user_agent
  )
  values (
    v_escola_id, p_contrato_id, v_pessoa_id, v_nome,
    v_cpf, v_vinculo, v_texto,
    encode(sha256(convert_to(v_texto, 'UTF8')), 'hex'),
    p_ip, left(p_user_agent, 500)
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function fn_assinar_contrato (uuid, inet, text) is
  'Registra a assinatura eletrônica simples do contrato pelo responsável financeiro. Renderiza e faz o hash do texto no servidor — nada do conteúdo assinado vem do cliente.';

revoke all on function fn_assinar_contrato (uuid, inet, text) from public, anon;
grant execute on function fn_assinar_contrato (uuid, inet, text) to authenticated;

-- ── Manter o próprio e-mail ───────────────────────────────────────────────
--
-- É o endereço para onde vai nota fiscal e régua de cobrança (0027, 0028).
-- Depender da secretaria para corrigir uma letra errada é o jeito mais
-- barato de a família parar de receber e ninguém descobrir por meses.
--
-- Só o e-mail. Nome e CPF continuam com a secretaria de propósito: são o
-- que identifica a pessoa em contrato e em nota fiscal, e o CPF é o que
-- amarra a assinatura já registrada. Quem assinou não reescreve depois
-- quem era.
create or replace function fn_atualizar_meu_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pessoa_id uuid;
  v_email text;
begin
  v_pessoa_id := fn_current_pessoa_id();
  if v_pessoa_id is null then
    raise exception 'sem_identidade' using errcode = '42501';
  end if;

  -- Vazio e nulo são a mesma intenção: apagar o contato. O formato é
  -- conferido por pessoas_email_formato (0027) — a checagem mora na
  -- tabela, não aqui, para valer também para a secretaria.
  v_email := nullif(btrim(p_email), '');

  update pessoas
     set email = v_email
   where id = v_pessoa_id
     and escola_id = fn_jwt_escola_id()
     and deleted_at is null;
end;
$$;

comment on function fn_atualizar_meu_email (text) is
  'Permite à pessoa autenticada corrigir o próprio e-mail de contato, e só ele. Política de UPDATE em pessoas não serve: RLS autoriza linhas, não colunas.';

revoke all on function fn_atualizar_meu_email (text) from public, anon;
grant execute on function fn_atualizar_meu_email (text) to authenticated;
