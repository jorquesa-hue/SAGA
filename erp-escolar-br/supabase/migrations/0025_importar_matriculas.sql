-- fn_importar_matriculas — migração de uma escola que já opera.
--
-- Recebe uma planilha desnormalizada (uma linha por aluno/matrícula/
-- contrato, já convertida em JSON pelo navegador) e cria, em UMA
-- transação, toda a cadeia: pessoa do aluno → aluno → pessoa do
-- responsável → vínculo → matrícula → contrato → parcelas → pagamentos
-- já quitados.
--
-- Cinco decisões estruturam a função:
--
-- 1. SECURITY INVOKER, deliberadamente. É o único ponto do sistema que
--    escreve em nove tabelas de uma vez; fazê-la DEFINER trocaria o
--    isolamento por RLS (que já cobre todas as nove, com políticas
--    *_insert_staff) por uma checagem manual de escola_id repetida nove
--    vezes — nove chances de esquecer uma. Como INVOKER, uma linha que
--    tentasse escrever em outro tenant é barrada pela mesma política que
--    protege o CRUD normal, sem código novo. As checagens de papel logo
--    abaixo existem só para dar mensagem de erro decente; quem garante o
--    isolamento é a RLS.
--
-- 2. Duas fases, tudo-ou-nada. A fase 1 valida as N linhas sem escrever
--    nada e devolve um relatório linha a linha. Se qualquer linha tem
--    erro, a função devolve o relatório e não escreve nada — não existe
--    "importou 340 de 500". Uma migração parcial é pior que nenhuma:
--    ninguém consegue dizer o que ficou de fora.
--
-- 3. Dry-run é o padrão (p_dry_run default true). Chamar por engano não
--    escreve nada.
--
-- 4. Reaproveita fn_gerar_parcelas (0013) em vez de gerar parcelas por
--    conta própria. As competências, os arredondamentos e os descontos da
--    importação têm que ser bit a bit iguais aos de um contrato assinado
--    pela tela — senão o relatório financeiro passa a ter duas verdades.
--
-- 5. Os pagamentos migrados são inseridos em ordem crescente de
--    competência. Isso não é detalhe de implementação: é o que faz o
--    trigger trg_pagamentos_ordem (0019) aceitar o backfill sem ser
--    desligado. Quitar fev, mar, abr nessa ordem sempre satisfaz "não há
--    parcela anterior em aberto". Nenhum bypass, nenhum alter table
--    disable trigger — a regra de negócio continua valendo durante a
--    própria migração.

create or replace function fn_importar_matriculas(
  p_linhas jsonb,
  p_dry_run boolean default true,
  p_arquivo_nome text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_escola_id uuid := fn_jwt_escola_id();
  v_role text := fn_jwt_role();
  v_total int;
  v_idx int;
  v_linha int;
  v_row jsonb;

  v_erros text[];
  v_avisos text[];

  v_txt text;
  v_slug text;
  v_n int;

  v_aluno_nome text;
  v_aluno_nasc date;
  v_aluno_cpf text;
  v_matricula_codigo text;
  v_turma_nome text;
  v_ano_txt text;
  v_ano int;
  v_turma_id uuid;
  v_ano_letivo_id uuid;
  v_matricula_data date;
  v_matricula_status matricula_status;

  v_resp_nome text;
  v_resp_nasc date;
  v_resp_cpf text;
  v_resp_vinculo vinculo_responsavel;

  v_valor_anuidade numeric(12, 2);
  v_num_parcelas int;
  v_vencimento_dia int;
  v_assinado_em date;
  v_desc_tipo desconto_tipo;
  v_desc_percentual numeric(5, 2);
  v_desc_valor numeric(12, 2);
  v_pagas_ate date;
  v_num numeric;

  v_pessoa_aluno_id uuid;
  v_aluno_id uuid;
  v_resp_pessoa_id uuid;
  v_acao text;

  r record;
  p record;
  v_contrato_id uuid;
  v_matricula_id uuid;
  v_importadas int := 0;

  v_relatorio jsonb;
  v_importacao_id uuid;
  v_com_erro int;
  v_ja int;
  v_criar int;
begin
  if v_escola_id is null then
    raise exception 'Sessão sem escola vinculada. Faça login novamente.'
      using errcode = 'insufficient_privilege';
  end if;
  -- v_role é NULL para quem não tem papel nenhum; sem o teste explícito,
  -- "NULL not in (...)" é NULL e o IF não dispararia — a RLS barraria
  -- depois, mas com uma mensagem que ninguém entende.
  if v_role is null or v_role not in ('admin', 'secretaria') then
    raise exception 'Somente admin ou secretaria podem importar matrículas.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'p_linhas deve ser um array JSON de linhas.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_total := jsonb_array_length(p_linhas);
  if v_total = 0 then
    raise exception 'O arquivo não tem nenhuma linha de dados.'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Teto defensivo: uma escola de porte médio migra centenas de alunos,
  -- não dezenas de milhares. Acima disso quase certamente é arquivo
  -- errado, e a transação única ficaria longa demais.
  if v_total > 2000 then
    raise exception 'O arquivo tem % linhas; o limite por importação é 2000. Divida em arquivos menores.', v_total
      using errcode = 'invalid_parameter_value';
  end if;

  drop table if exists pg_temp._import_plano;
  create temp table _import_plano (
    linha int primary key,
    acao text not null,
    erros text[] not null default '{}',
    avisos text[] not null default '{}',
    aluno_nome text,
    aluno_nasc date,
    aluno_cpf text,
    matricula_codigo text,
    turma_nome text,
    turma_id uuid,
    ano_letivo_id uuid,
    matricula_data date,
    matricula_status matricula_status,
    resp_nome text,
    resp_nasc date,
    resp_cpf text,
    resp_vinculo vinculo_responsavel,
    valor_anuidade numeric(12, 2),
    num_parcelas int,
    vencimento_dia int,
    assinado_em date,
    desc_tipo desconto_tipo,
    desc_percentual numeric(5, 2),
    desc_valor numeric(12, 2),
    pagas_ate date,
    pessoa_aluno_id uuid,
    aluno_id uuid,
    resp_pessoa_id uuid
  ) on commit drop;

  -- ══════════════════════════════════════════════════════════════════════
  -- FASE 1 — validação (nenhuma escrita no domínio)
  -- ══════════════════════════════════════════════════════════════════════
  for v_idx in 0 .. v_total - 1 loop
    v_row := p_linhas -> v_idx;
    v_linha := v_idx + 1;
    v_erros := '{}';
    v_avisos := '{}';
    v_turma_id := null;
    v_ano_letivo_id := null;
    v_pessoa_aluno_id := null;
    v_aluno_id := null;
    v_resp_pessoa_id := null;
    v_desc_tipo := null;
    v_desc_percentual := null;
    v_desc_valor := null;
    v_acao := 'criar';

    if jsonb_typeof(v_row) <> 'object' then
      insert into pg_temp._import_plano (linha, acao, erros)
      values (v_linha, 'erro', array['A linha não é um objeto de dados válido.']);
      continue;
    end if;

    -- ── aluno ───────────────────────────────────────────────────────────
    v_aluno_nome := fn_import_txt(v_row, 'aluno_nome');
    if v_aluno_nome is null then
      v_erros := v_erros || 'aluno_nome é obrigatório.';
    end if;

    v_txt := fn_import_txt(v_row, 'aluno_data_nascimento');
    v_aluno_nasc := fn_import_data(v_txt);
    if v_txt is null then
      v_erros := v_erros || 'aluno_data_nascimento é obrigatório.';
    elsif v_aluno_nasc is null then
      v_erros := v_erros || format('aluno_data_nascimento "%s" não é uma data válida (use AAAA-MM-DD ou DD/MM/AAAA).', v_txt);
    elsif v_aluno_nasc > current_date then
      v_erros := v_erros || 'aluno_data_nascimento está no futuro.';
    end if;

    v_aluno_cpf := fn_import_txt(v_row, 'aluno_cpf');
    if v_aluno_cpf is not null and not fn_cpf_valido(v_aluno_cpf) then
      v_erros := v_erros || format('aluno_cpf "%s" é inválido (dígito verificador não confere).', v_aluno_cpf);
    end if;

    v_matricula_codigo := fn_import_txt(v_row, 'matricula_codigo');
    if v_matricula_codigo is null then
      v_erros := v_erros || 'matricula_codigo é obrigatório — é a chave que identifica o aluno entre importações.';
    end if;

    -- ── turma / ano letivo ──────────────────────────────────────────────
    v_turma_nome := fn_import_txt(v_row, 'turma_nome');
    v_ano_txt := fn_import_txt(v_row, 'ano_letivo');
    v_ano := null;
    if v_ano_txt is not null then
      v_num := fn_import_numero(v_ano_txt);
      if v_num is null or v_num <> trunc(v_num) or v_num < 2000 or v_num > 2100 then
        v_erros := v_erros || format('ano_letivo "%s" não é um ano válido.', v_ano_txt);
      else
        v_ano := v_num::int;
      end if;
    end if;

    if v_turma_nome is null then
      v_erros := v_erros || 'turma_nome é obrigatório.';
    else
      -- A turma tem que existir. A importação nunca cria turma, curso ou
      -- ano letivo: são decisões pedagógicas (etapa, turno, capacidade,
      -- unidade/CNPJ) que não cabem numa coluna de planilha, e inventá-las
      -- em massa produziria uma estrutura escolar plausível e errada.
      select count(*)
        into v_n
        from turmas t
        join anos_letivos al on al.id = t.ano_letivo_id and al.escola_id = t.escola_id
       where t.escola_id = v_escola_id
         and t.deleted_at is null
         and al.deleted_at is null
         and fn_import_slug(t.nome) = fn_import_slug(v_turma_nome)
         and (v_ano is null or al.ano = v_ano);

      if v_n = 0 then
        v_erros := v_erros || format(
          'turma "%s"%s não existe. Cadastre a turma em Escola → Turmas antes de importar.',
          v_turma_nome,
          case when v_ano is null then '' else format(' no ano letivo %s', v_ano) end
        );
      elsif v_n > 1 then
        v_erros := v_erros || format(
          'existe mais de uma turma chamada "%s". Acrescente a coluna ano_letivo para desambiguar.',
          v_turma_nome
        );
      else
        select t.id, t.ano_letivo_id, al.ano
          into v_turma_id, v_ano_letivo_id, v_ano
          from turmas t
          join anos_letivos al on al.id = t.ano_letivo_id and al.escola_id = t.escola_id
         where t.escola_id = v_escola_id
           and t.deleted_at is null
           and al.deleted_at is null
           and fn_import_slug(t.nome) = fn_import_slug(v_turma_nome)
           and (v_ano is null or al.ano = v_ano);
      end if;
    end if;

    -- ── contrato ────────────────────────────────────────────────────────
    v_txt := fn_import_txt(v_row, 'contrato_assinado_em');
    v_assinado_em := fn_import_data(v_txt);
    if v_txt is null then
      v_erros := v_erros || 'contrato_assinado_em é obrigatório — é o mês da primeira parcela.';
    elsif v_assinado_em is null then
      v_erros := v_erros || format('contrato_assinado_em "%s" não é uma data válida.', v_txt);
    end if;

    v_txt := fn_import_txt(v_row, 'contrato_valor_anuidade');
    v_num := fn_import_numero(v_txt);
    v_valor_anuidade := null;
    if v_txt is null then
      v_erros := v_erros || 'contrato_valor_anuidade é obrigatório.';
    elsif v_num is null then
      v_erros := v_erros || format('contrato_valor_anuidade "%s" não é um número válido.', v_txt);
    elsif v_num <= 0 then
      v_erros := v_erros || 'contrato_valor_anuidade deve ser maior que zero.';
    else
      v_valor_anuidade := round(v_num, 2);
    end if;

    v_txt := fn_import_txt(v_row, 'contrato_num_parcelas');
    v_num := fn_import_numero(v_txt);
    v_num_parcelas := null;
    if v_txt is null then
      v_erros := v_erros || 'contrato_num_parcelas é obrigatório.';
    elsif v_num is null or v_num <> trunc(v_num) then
      v_erros := v_erros || format('contrato_num_parcelas "%s" não é um número inteiro.', v_txt);
    elsif v_num < 1 or v_num > 12 then
      v_erros := v_erros || format('contrato_num_parcelas deve estar entre 1 e 12 (recebido: %s).', v_txt);
    else
      v_num_parcelas := v_num::int;
    end if;

    v_txt := fn_import_txt(v_row, 'contrato_vencimento_dia');
    v_num := fn_import_numero(v_txt);
    v_vencimento_dia := null;
    if v_txt is null then
      v_erros := v_erros || 'contrato_vencimento_dia é obrigatório.';
    elsif v_num is null or v_num <> trunc(v_num) then
      v_erros := v_erros || format('contrato_vencimento_dia "%s" não é um número inteiro.', v_txt);
    elsif v_num < 1 or v_num > 28 then
      -- 28 é o teto do schema: um vencimento dia 30 não existe em
      -- fevereiro, e silenciosamente "ajustar" para o dia 28 mudaria a
      -- data de vencimento contratada do aluno.
      v_erros := v_erros || format('contrato_vencimento_dia deve estar entre 1 e 28 (recebido: %s).', v_txt);
    else
      v_vencimento_dia := v_num::int;
    end if;

    if v_assinado_em is not null and v_ano is not null
       and extract(year from v_assinado_em)::int <> v_ano then
      v_avisos := v_avisos || format(
        'contrato assinado em %s mas a turma é do ano letivo %s — confira se a data está certa.',
        to_char(v_assinado_em, 'DD/MM/YYYY'), v_ano
      );
    end if;

    -- ── desconto (opcional) ─────────────────────────────────────────────
    v_txt := fn_import_txt(v_row, 'desconto_tipo');
    if v_txt is not null then
      v_slug := fn_import_slug(v_txt);
      v_desc_tipo := case
        when v_slug in ('bolsa', 'bolsista', 'bolsa_social') then 'bolsa'
        when v_slug in ('irmao', 'irmaos', 'irma', 'desconto_irmao') then 'irmao'
        when v_slug in ('pontualidade', 'pontual') then 'pontualidade'
        when v_slug in ('convenio', 'convenios', 'parceria') then 'convenio'
        else null
      end::desconto_tipo;
      if v_desc_tipo is null then
        v_erros := v_erros || format(
          'desconto_tipo "%s" não é reconhecido. Use bolsa, irmao, pontualidade ou convenio.', v_txt
        );
      end if;
    end if;

    v_txt := fn_import_txt(v_row, 'desconto_percentual');
    if v_txt is not null then
      v_num := fn_import_numero(v_txt);
      if v_num is null then
        v_erros := v_erros || format('desconto_percentual "%s" não é um número válido.', v_txt);
      elsif v_num < 0 or v_num > 100 then
        v_erros := v_erros || format('desconto_percentual deve estar entre 0 e 100 (recebido: %s).', v_txt);
      else
        v_desc_percentual := round(v_num, 2);
      end if;
    end if;

    v_txt := fn_import_txt(v_row, 'desconto_valor');
    if v_txt is not null then
      v_num := fn_import_numero(v_txt);
      if v_num is null then
        v_erros := v_erros || format('desconto_valor "%s" não é um número válido.', v_txt);
      elsif v_num < 0 then
        v_erros := v_erros || 'desconto_valor não pode ser negativo.';
      else
        v_desc_valor := round(v_num, 2);
      end if;
    end if;

    if v_desc_tipo is not null and v_desc_percentual is null and v_desc_valor is null then
      v_erros := v_erros || 'desconto_tipo foi informado sem desconto_percentual nem desconto_valor.';
    end if;
    if v_desc_tipo is null and (v_desc_percentual is not null or v_desc_valor is not null) then
      v_erros := v_erros || 'desconto informado sem desconto_tipo (bolsa, irmao, pontualidade ou convenio).';
    end if;

    -- ── matrícula ───────────────────────────────────────────────────────
    v_txt := fn_import_txt(v_row, 'matricula_data');
    v_matricula_data := fn_import_data(v_txt);
    if v_txt is not null and v_matricula_data is null then
      v_erros := v_erros || format('matricula_data "%s" não é uma data válida.', v_txt);
    end if;
    if v_matricula_data is null then
      v_matricula_data := v_assinado_em;
    end if;

    v_txt := fn_import_txt(v_row, 'matricula_status');
    v_matricula_status := 'ativa';
    if v_txt is not null then
      v_slug := fn_import_slug(v_txt);
      v_matricula_status := case
        when v_slug in ('ativa', 'ativo', 'matriculado', 'matriculada') then 'ativa'
        when v_slug in ('pre', 'pre_matricula', 'pendente') then 'pre'
        when v_slug in ('trancada', 'trancado') then 'trancada'
        when v_slug in ('transferida', 'transferido') then 'transferida'
        when v_slug in ('concluida', 'concluido', 'formado', 'formada', 'egresso') then 'concluida'
        else null
      end::matricula_status;
      if v_matricula_status is null then
        v_erros := v_erros || format(
          'matricula_status "%s" não é reconhecido. Use ativa, pre, trancada, transferida ou concluida.', v_txt
        );
      end if;
    end if;

    -- ── responsável ─────────────────────────────────────────────────────
    v_resp_nome := fn_import_txt(v_row, 'responsavel_nome');
    if v_resp_nome is null then
      v_erros := v_erros || 'responsavel_nome é obrigatório.';
    end if;

    v_txt := fn_import_txt(v_row, 'responsavel_data_nascimento');
    v_resp_nasc := fn_import_data(v_txt);
    if v_txt is null then
      -- pessoas.data_nascimento é NOT NULL. Preencher com uma data
      -- inventada criaria dado pessoal falso em massa, então a planilha
      -- precisa trazer a data de verdade.
      v_erros := v_erros || 'responsavel_data_nascimento é obrigatório.';
    elsif v_resp_nasc is null then
      v_erros := v_erros || format('responsavel_data_nascimento "%s" não é uma data válida.', v_txt);
    elsif v_resp_nasc > current_date then
      v_erros := v_erros || 'responsavel_data_nascimento está no futuro.';
    end if;

    v_resp_cpf := fn_import_txt(v_row, 'responsavel_cpf');
    if v_resp_cpf is not null and not fn_cpf_valido(v_resp_cpf) then
      v_erros := v_erros || format('responsavel_cpf "%s" é inválido (dígito verificador não confere).', v_resp_cpf);
    end if;

    v_txt := fn_import_txt(v_row, 'responsavel_vinculo');
    v_resp_vinculo := null;
    if v_txt is null then
      v_erros := v_erros || 'responsavel_vinculo é obrigatório (mae, pai, avo, ava, tutor_legal ou outro).';
    else
      v_slug := fn_import_slug(v_txt);
      -- "avô" e "avó" colidem depois de tirar o acento, e o enum separa os
      -- dois (avo/ava). O acento na palavra original é o único desempate.
      if lower(v_txt) like '%avó%' or v_slug = 'ava' then
        v_resp_vinculo := 'ava';
      elsif v_slug = 'avo' or lower(v_txt) like '%avô%' then
        v_resp_vinculo := 'avo';
      else
        v_resp_vinculo := case
          when v_slug in ('mae', 'genitora') then 'mae'
          when v_slug in ('pai', 'genitor') then 'pai'
          when v_slug in ('tutor_legal', 'tutor', 'tutora', 'responsavel_legal', 'representante_legal', 'guardiao') then 'tutor_legal'
          when v_slug in ('outro', 'outros', 'outra') then 'outro'
          else null
        end::vinculo_responsavel;
        if v_resp_vinculo is null then
          -- Padrasto, tia, irmão mais velho: são vínculos reais que o enum
          -- não modela. Vira 'outro' com aviso, em vez de barrar a
          -- migração inteira por causa de um grau de parentesco.
          v_resp_vinculo := 'outro';
          v_avisos := v_avisos || format('responsavel_vinculo "%s" não existe no sistema; gravado como "outro".', v_txt);
        end if;
      end if;
    end if;

    -- ── parcelas já quitadas ────────────────────────────────────────────
    v_txt := fn_import_txt(v_row, 'parcelas_pagas_ate');
    v_pagas_ate := fn_import_data(v_txt);
    if v_txt is not null and v_pagas_ate is null then
      v_erros := v_erros || format(
        'parcelas_pagas_ate "%s" não é uma competência válida (use AAAA-MM ou MM/AAAA).', v_txt
      );
    end if;
    if v_pagas_ate is not null and v_assinado_em is not null
       and date_trunc('month', v_pagas_ate) < date_trunc('month', v_assinado_em) then
      v_avisos := v_avisos || format(
        'parcelas_pagas_ate (%s) é anterior à primeira competência do contrato (%s) — nenhuma parcela será marcada como paga.',
        to_char(v_pagas_ate, 'MM/YYYY'), to_char(v_assinado_em, 'MM/YYYY')
      );
    end if;

    -- ── duplicidade dentro do próprio arquivo ───────────────────────────
    if v_matricula_codigo is not null and v_ano_letivo_id is not null
       and exists (
         select 1 from pg_temp._import_plano ip
          where ip.matricula_codigo = v_matricula_codigo
            and ip.ano_letivo_id = v_ano_letivo_id
       ) then
      v_erros := v_erros || format(
        'matricula_codigo "%s" aparece duas vezes no arquivo para o mesmo ano letivo.', v_matricula_codigo
      );
    end if;

    -- ── reconciliação com o que já existe no banco ──────────────────────
    if v_matricula_codigo is not null then
      select a.id, a.pessoa_id
        into v_aluno_id, v_pessoa_aluno_id
        from alunos a
       where a.escola_id = v_escola_id
         and a.matricula_codigo = v_matricula_codigo
         and a.deleted_at is null;
    end if;

    if v_aluno_id is null and v_aluno_cpf is not null then
      -- O aluno pode já existir como pessoa (cadastrado à mão antes da
      -- migração) sem estar sob esse matricula_codigo. Reaproveitar a
      -- pessoa evita duas fichas para a mesma criança.
      select pe.id into v_pessoa_aluno_id
        from pessoas pe
       where pe.escola_id = v_escola_id
         and pe.cpf = v_aluno_cpf
         and pe.deleted_at is null;
      if v_pessoa_aluno_id is not null then
        v_avisos := v_avisos || 'aluno já cadastrado como pessoa (mesmo CPF); a ficha existente será reaproveitada.';
      end if;
    end if;

    if v_aluno_id is not null and v_ano_letivo_id is not null
       and exists (
         select 1 from matriculas m
          where m.escola_id = v_escola_id
            and m.aluno_id = v_aluno_id
            and m.ano_letivo_id = v_ano_letivo_id
            and m.deleted_at is null
       ) then
      -- Reenvio do mesmo arquivo (ou de uma versão corrigida dele): essa
      -- linha já está no sistema. Não é erro e não vira duplicata.
      v_acao := 'ja_importada';
    end if;

    if v_resp_cpf is not null then
      select pe.id into v_resp_pessoa_id
        from pessoas pe
       where pe.escola_id = v_escola_id
         and pe.cpf = v_resp_cpf
         and pe.deleted_at is null;
    elsif v_resp_nome is not null and v_resp_nasc is not null then
      -- Sem CPF, nome + data de nascimento é o melhor par disponível.
      -- Só reaproveita se for inequívoco (um único candidato): contar
      -- primeiro e só então buscar o id evita reaproveitar a pessoa errada
      -- quando há homônimos.
      select count(*)
        into v_n
        from pessoas pe
       where pe.escola_id = v_escola_id
         and pe.deleted_at is null
         and pe.data_nascimento = v_resp_nasc
         and fn_import_slug(pe.nome) = fn_import_slug(v_resp_nome);

      if v_n = 1 then
        select pe.id
          into v_resp_pessoa_id
          from pessoas pe
         where pe.escola_id = v_escola_id
           and pe.deleted_at is null
           and pe.data_nascimento = v_resp_nasc
           and fn_import_slug(pe.nome) = fn_import_slug(v_resp_nome);
      else
        v_resp_pessoa_id := null;
      end if;

      if v_n > 1 then
        v_avisos := v_avisos || format(
          'existe mais de uma pessoa chamada "%s" com essa data de nascimento; um novo cadastro será criado. Informe responsavel_cpf para evitar duplicidade.',
          v_resp_nome
        );
      end if;
    end if;

    if array_length(v_erros, 1) > 0 then
      v_acao := 'erro';
    end if;

    insert into pg_temp._import_plano (
      linha, acao, erros, avisos,
      aluno_nome, aluno_nasc, aluno_cpf, matricula_codigo,
      turma_nome, turma_id, ano_letivo_id, matricula_data, matricula_status,
      resp_nome, resp_nasc, resp_cpf, resp_vinculo,
      valor_anuidade, num_parcelas, vencimento_dia, assinado_em,
      desc_tipo, desc_percentual, desc_valor, pagas_ate,
      pessoa_aluno_id, aluno_id, resp_pessoa_id
    ) values (
      v_linha, v_acao, v_erros, v_avisos,
      v_aluno_nome, v_aluno_nasc, v_aluno_cpf, v_matricula_codigo,
      v_turma_nome, v_turma_id, v_ano_letivo_id, v_matricula_data, v_matricula_status,
      v_resp_nome, v_resp_nasc, v_resp_cpf, v_resp_vinculo,
      v_valor_anuidade, v_num_parcelas, v_vencimento_dia, v_assinado_em,
      v_desc_tipo, v_desc_percentual, v_desc_valor, v_pagas_ate,
      v_pessoa_aluno_id, v_aluno_id, v_resp_pessoa_id
    );
  end loop;

  select count(*) filter (where acao = 'erro'),
         count(*) filter (where acao = 'ja_importada'),
         count(*) filter (where acao = 'criar')
    into v_com_erro, v_ja, v_criar
    from pg_temp._import_plano;

  -- ══════════════════════════════════════════════════════════════════════
  -- FASE 2 — escrita (só quando tudo validou e não é simulação)
  -- ══════════════════════════════════════════════════════════════════════
  if v_com_erro = 0 and not p_dry_run then
    for r in select * from pg_temp._import_plano where acao = 'criar' order by linha loop
      -- Quem já existe é resolvido de novo AQUI, e não reaproveitado da
      -- fase 1, porque uma linha anterior DESTE MESMO arquivo pode ter
      -- acabado de criar a pessoa. Os dois casos são corriqueiros numa
      -- migração e ambos violariam constraint se a fase 2 confiasse na
      -- foto tirada antes da primeira escrita:
      --   • dois irmãos com o mesmo responsável (uq_pessoas_escola_cpf);
      --   • o mesmo aluno em dois anos letivos na mesma planilha
      --     (alunos_escola_matricula_codigo_unique).
      -- A fase 1 continua valendo para o relatório; a fase 2 é que precisa
      -- enxergar o que ela própria já escreveu.
      v_aluno_id := null;
      v_pessoa_aluno_id := null;
      select a.id, a.pessoa_id
        into v_aluno_id, v_pessoa_aluno_id
        from alunos a
       where a.escola_id = v_escola_id
         and a.matricula_codigo = r.matricula_codigo
         and a.deleted_at is null;

      -- pessoa do aluno
      if v_pessoa_aluno_id is null and r.aluno_cpf is not null then
        select pe.id into v_pessoa_aluno_id
          from pessoas pe
         where pe.escola_id = v_escola_id
           and pe.cpf = r.aluno_cpf
           and pe.deleted_at is null;
      end if;
      if v_pessoa_aluno_id is null then
        insert into pessoas (escola_id, nome, cpf, data_nascimento, papeis)
        values (v_escola_id, r.aluno_nome, r.aluno_cpf, r.aluno_nasc, array['aluno']::pessoa_papel[])
        returning id into v_pessoa_aluno_id;
      else
        update pessoas
           set papeis = array_append(papeis, 'aluno'::pessoa_papel)
         where id = v_pessoa_aluno_id
           and escola_id = v_escola_id
           and not ('aluno' = any (papeis));
      end if;

      -- aluno
      if v_aluno_id is null then
        insert into alunos (escola_id, pessoa_id, matricula_codigo, status)
        values (
          v_escola_id, v_pessoa_aluno_id, r.matricula_codigo,
          case r.matricula_status
            when 'transferida' then 'transferido'
            when 'concluida' then 'egresso'
            when 'trancada' then 'inativo'
            else 'ativo'
          end
        )
        returning id into v_aluno_id;
      end if;

      -- pessoa do responsável
      v_resp_pessoa_id := null;
      if r.resp_cpf is not null then
        select pe.id into v_resp_pessoa_id
          from pessoas pe
         where pe.escola_id = v_escola_id
           and pe.cpf = r.resp_cpf
           and pe.deleted_at is null;
      else
        select count(*)
          into v_n
          from pessoas pe
         where pe.escola_id = v_escola_id
           and pe.deleted_at is null
           and pe.data_nascimento = r.resp_nasc
           and fn_import_slug(pe.nome) = fn_import_slug(r.resp_nome);
        if v_n = 1 then
          select pe.id
            into v_resp_pessoa_id
            from pessoas pe
           where pe.escola_id = v_escola_id
             and pe.deleted_at is null
             and pe.data_nascimento = r.resp_nasc
             and fn_import_slug(pe.nome) = fn_import_slug(r.resp_nome);
        end if;
      end if;

      if v_resp_pessoa_id is null then
        insert into pessoas (escola_id, nome, cpf, data_nascimento, papeis)
        values (v_escola_id, r.resp_nome, r.resp_cpf, r.resp_nasc, array['responsavel']::pessoa_papel[])
        returning id into v_resp_pessoa_id;
      else
        update pessoas
           set papeis = array_append(papeis, 'responsavel'::pessoa_papel)
         where id = v_resp_pessoa_id
           and escola_id = v_escola_id
           and not ('responsavel' = any (papeis));
      end if;

      -- vínculo. A planilha traz um responsável por aluno, e é esse que
      -- responde por tudo na escola: recebe o boleto, assina a autorização
      -- e busca na saída. Permissões mais finas são ajustadas depois, na
      -- tela de Alunos.
      insert into responsaveis_alunos (
        escola_id, responsavel_pessoa_id, aluno_id, vinculo, financeiro, pedagogico, retirada
      )
      values (v_escola_id, v_resp_pessoa_id, v_aluno_id, r.resp_vinculo, true, true, true)
      on conflict on constraint responsaveis_alunos_unique do nothing;

      -- matrícula
      insert into matriculas (escola_id, aluno_id, turma_id, ano_letivo_id, data, status)
      values (v_escola_id, v_aluno_id, r.turma_id, r.ano_letivo_id, r.matricula_data, r.matricula_status)
      returning id into v_matricula_id;

      -- contrato. assinado_em é timestamptz; a planilha traz uma data, que
      -- vira meia-noite em America/Sao_Paulo — o mesmo fuso que
      -- fn_gerar_parcelas usa ao fazer assinado_em::date.
      insert into contratos (escola_id, matricula_id, valor_anuidade, num_parcelas, vencimento_dia, assinado_em)
      values (
        v_escola_id, v_matricula_id, r.valor_anuidade, r.num_parcelas, r.vencimento_dia,
        (r.assinado_em::timestamp) at time zone 'America/Sao_Paulo'
      )
      returning id into v_contrato_id;

      -- desconto ANTES de gerar parcelas: fn_gerar_parcelas soma os
      -- descontos vigentes na assinatura para calcular valor_liquido.
      if r.desc_tipo is not null then
        insert into descontos (escola_id, contrato_id, tipo, percentual, valor, vigencia)
        values (
          v_escola_id, v_contrato_id, r.desc_tipo, r.desc_percentual, r.desc_valor,
          daterange(r.assinado_em, null, '[)')
        );
      end if;

      perform fn_gerar_parcelas(v_contrato_id);

      -- Parcelas sem valor a cobrar (bolsa integral) não podem virar
      -- pagamento: pagamentos.valor tem check (valor > 0). O estado
      -- correto delas é 'isento', não 'pago'.
      update parcelas
         set status = 'isento'
       where escola_id = v_escola_id
         and contrato_id = v_contrato_id
         and valor_liquido = 0;

      if r.pagas_ate is not null then
        -- Ordem crescente de competência: é o que satisfaz
        -- trg_pagamentos_ordem (0019) sem desligar o trigger.
        for p in
          select id, valor_liquido, vencimento
            from parcelas
           where escola_id = v_escola_id
             and contrato_id = v_contrato_id
             and status = 'pendente'
             and competencia <= date_trunc('month', r.pagas_ate)::date
           order by competencia
        loop
          insert into pagamentos (escola_id, parcela_id, valor, data, meio)
          values (v_escola_id, p.id, p.valor_liquido, p.vencimento, 'migracao');
          update parcelas set status = 'pago' where id = p.id and escola_id = v_escola_id;
        end loop;
      end if;

      -- O resto do ano que já venceu e não foi quitado é inadimplência —
      -- que é justamente o número que a escola quer ver no dia seguinte à
      -- migração.
      update parcelas
         set status = 'atrasado'
       where escola_id = v_escola_id
         and contrato_id = v_contrato_id
         and status = 'pendente'
         and vencimento < current_date;

      v_importadas := v_importadas + 1;
    end loop;
  end if;

  -- ══════════════════════════════════════════════════════════════════════
  -- Relatório
  -- ══════════════════════════════════════════════════════════════════════
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'linha', linha,
               'acao', acao,
               'aluno', aluno_nome,
               'matricula_codigo', matricula_codigo,
               'turma', turma_nome,
               'erros', to_jsonb(erros),
               'avisos', to_jsonb(avisos)
             )
             order by linha
           ),
           '[]'::jsonb
         )
    into v_relatorio
    from pg_temp._import_plano;

  v_relatorio := jsonb_build_object(
    'ok', v_com_erro = 0,
    'dry_run', p_dry_run,
    'total_linhas', v_total,
    'linhas_a_criar', v_criar,
    'linhas_ja_importadas', v_ja,
    'linhas_com_erro', v_com_erro,
    'linhas_importadas', v_importadas,
    'linhas', v_relatorio
  );

  if not p_dry_run then
    -- Registrado mesmo quando a validação reprova o arquivo: saber que
    -- alguém tentou subir uma planilha quebrada às 23h faz parte da
    -- história. A simulação não é registrada — ela não muda nada.
    insert into importacoes (
      escola_id, criado_por, arquivo_nome, status,
      total_linhas, linhas_importadas, linhas_ignoradas, payload, relatorio
    )
    values (
      v_escola_id, fn_current_pessoa_id(), p_arquivo_nome,
      case when v_com_erro = 0 then 'concluida' else 'erro' end,
      v_total, v_importadas, v_ja, p_linhas, v_relatorio
    )
    returning id into v_importacao_id;

    v_relatorio := v_relatorio || jsonb_build_object('importacao_id', v_importacao_id);
  end if;

  return v_relatorio;
end;
$$;

comment on function fn_importar_matriculas (jsonb, boolean, text) is
  'Importa em lote alunos, responsáveis, matrículas, contratos, parcelas e pagamentos já quitados de uma escola em operação. Valida tudo antes de escrever; p_dry_run=true (padrão) só simula.';

revoke all on function fn_importar_matriculas (jsonb, boolean, text) from public, anon;
grant execute on function fn_importar_matriculas (jsonb, boolean, text) to authenticated;
