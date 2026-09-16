-- Synthetic fixture: two unrelated escolas (A and B), each with staff,
-- turma, aluno, responsavel and a full financeiro chain, plus a second
-- aluno/turma in escola A that professor A is NOT assigned to (to prove
-- role-scoping within the same tenant, not just cross-tenant isolation).
-- All names/CPFs/CNPJs are synthetic placeholders (CLAUDE.md invariant 7)
-- with correct check digits so they pass fn_cpf_valido/fn_cnpj_valido.
-- Applied by scripts/db-reset.mjs (APPLY_FIXTURES=1) using the superuser
-- connection, so RLS does not interfere with seeding.

insert into escolas (id, razao_social, plano) values
  ('a0000000-0000-0000-0000-000000000000', 'Escola Teste A Ltda', 'standard'),
  ('b0000000-0000-0000-0000-000000000000', 'Escola Teste B Ltda', 'standard');

-- Two unidades under escola A (distinct CNPJs, distinct municípios — the
-- multi-CNPJ-per-network case) and one under escola B.
insert into unidades (id, escola_id, nome, endereco, razao_social, cnpj, municipio_ibge) values
  ('a0000000-0000-0000-0000-0000000000c0', 'a0000000-0000-0000-0000-000000000000', 'Unidade Sede A', '{"cidade": "Sao Paulo"}'::jsonb, 'Escola Teste A Ltda', '11122233000183', '3550308'),
  ('a0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000000', 'Unidade Norte A', '{"cidade": "Campinas"}'::jsonb, 'Escola Teste A Filial Norte Ltda', '11444777000161', '3509502'),
  ('b0000000-0000-0000-0000-0000000000c0', 'b0000000-0000-0000-0000-000000000000', 'Unidade Sede B', '{"cidade": "Rio de Janeiro"}'::jsonb, 'Escola Teste B Ltda', '22233344000183', '3304557');

insert into anos_letivos (id, escola_id, ano, data_inicio, data_fim, status) values
  ('a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000000', 2026, '2026-02-01', '2026-12-15', 'ativo'),
  ('b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000000', 2026, '2026-02-01', '2026-12-15', 'ativo');

insert into cursos (id, escola_id, nome, etapa_ensino) values
  ('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000000', 'Fundamental I', 'fundamental_i'),
  ('b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000000', 'Fundamental I', 'fundamental_i');

-- 3o Ano A stays at the sede unidade; 3o Ano B is at the Norte unidade —
-- proves a contrato's CNPJ can differ by turma within the same escola.
insert into turmas (id, escola_id, ano_letivo_id, curso_id, unidade_id, nome, turno, capacidade) values
  ('a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000c0', '3o Ano A', 'manha', 25),
  ('a0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000c1', '3o Ano B', 'tarde', 25),
  ('b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-0000000000c0', '3o Ano A', 'manha', 25);

insert into pessoas (id, escola_id, nome, cpf, data_nascimento, papeis, auth_user_id) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'Admin A', '11122233043', '1980-01-01', array['admin']::pessoa_papel[], 'a0000000-0000-0000-0000-0000000000f1'),
  ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'Secretaria A', '11122234015', '1982-02-02', array['secretaria']::pessoa_papel[], 'a0000000-0000-0000-0000-0000000000f2'),
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000000', 'Professor A', '11122235097', '1985-03-03', array['professor']::pessoa_papel[], 'a0000000-0000-0000-0000-0000000000f3'),
  ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000000', 'Responsavel A', '11122236069', '1979-04-04', array['responsavel']::pessoa_papel[], 'a0000000-0000-0000-0000-0000000000f4'),
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000000', 'Aluno A', null, '2016-05-05', array['aluno']::pessoa_papel[], null),
  ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000000', 'Outro Responsavel A', '11122237030', '1981-06-06', array['responsavel']::pessoa_papel[], 'a0000000-0000-0000-0000-0000000000f6'),
  ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000000', 'Aluno A2', null, '2016-07-07', array['aluno']::pessoa_papel[], null),

  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000000', 'Admin B', '22233344073', '1980-01-01', array['admin']::pessoa_papel[], 'b0000000-0000-0000-0000-0000000000f1'),
  ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000000', 'Secretaria B', '22233345045', '1982-02-02', array['secretaria']::pessoa_papel[], 'b0000000-0000-0000-0000-0000000000f2'),
  ('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000000', 'Professor B', '22233346017', '1985-03-03', array['professor']::pessoa_papel[], 'b0000000-0000-0000-0000-0000000000f3'),
  ('b0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000000', 'Responsavel B', '22233347099', '1979-04-04', array['responsavel']::pessoa_papel[], 'b0000000-0000-0000-0000-0000000000f4'),
  ('b0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000000', 'Aluno B', null, '2016-05-05', array['aluno']::pessoa_papel[], null);

insert into alunos (id, escola_id, pessoa_id, matricula_codigo, status) values
  ('a0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000005', '2026-A-0001', 'ativo'),
  ('a0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000007', '2026-A-0002', 'ativo'),
  ('b0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000005', '2026-B-0001', 'ativo');

insert into responsaveis_alunos (id, escola_id, responsavel_pessoa_id, aluno_id, vinculo, financeiro, pedagogico, retirada) values
  ('a0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000020', 'mae', true, true, true),
  ('b0000000-0000-0000-0000-000000000030', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000020', 'mae', true, true, true);

-- professores_turmas: professor A is assigned ONLY to turma A, not turma A2.
insert into professores_turmas (id, escola_id, professor_pessoa_id, turma_id) values
  ('a0000000-0000-0000-0000-000000000040', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000012'),
  ('b0000000-0000-0000-0000-000000000040', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000012');

insert into matriculas (id, escola_id, aluno_id, turma_id, ano_letivo_id, data, status) values
  ('a0000000-0000-0000-0000-000000000050', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000010', '2026-02-01', 'ativa'),
  ('a0000000-0000-0000-0000-000000000051', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000010', '2026-02-01', 'ativa'),
  ('b0000000-0000-0000-0000-000000000050', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000010', '2026-02-01', 'ativa');

insert into contratos (id, escola_id, matricula_id, valor_anuidade, num_parcelas, vencimento_dia, assinado_em) values
  ('a0000000-0000-0000-0000-000000000060', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000050', 12000.00, 12, 10, now()),
  ('b0000000-0000-0000-0000-000000000060', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000050', 12000.00, 12, 10, now());

insert into descontos (escola_id, contrato_id, tipo, percentual, vigencia) values
  ('a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000060', 'pontualidade', 5.00, daterange('2026-01-01', '2026-12-31')),
  ('b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000060', 'pontualidade', 5.00, daterange('2026-01-01', '2026-12-31'));

insert into parcelas (id, escola_id, contrato_id, competencia, vencimento, valor_bruto, valor_desconto, valor_liquido, status) values
  ('a0000000-0000-0000-0000-000000000070', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000060', '2026-02-01', '2026-02-10', 1000.00, 0, 1000.00, 'pendente'),
  ('b0000000-0000-0000-0000-000000000070', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000060', '2026-02-01', '2026-02-10', 1000.00, 0, 1000.00, 'pendente');

insert into pagamentos (id, escola_id, parcela_id, valor, data, meio) values
  ('a0000000-0000-0000-0000-000000000080', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000070', 1000.00, '2026-02-08', 'pix'),
  ('b0000000-0000-0000-0000-000000000080', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000070', 1000.00, '2026-02-08', 'pix');

insert into notas_fiscais (id, escola_id, pagamento_id, numero, status) values
  ('a0000000-0000-0000-0000-000000000090', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000080', '1', 'emitida'),
  ('b0000000-0000-0000-0000-000000000090', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000080', '1', 'emitida');

insert into comunicados (id, escola_id, titulo, corpo, publico_alvo, enviado_em) values
  ('a0000000-0000-0000-0000-0000000000a0', 'a0000000-0000-0000-0000-000000000000', 'Aviso A', 'Comunicado da escola A.', 'todos', now()),
  ('b0000000-0000-0000-0000-0000000000a0', 'b0000000-0000-0000-0000-000000000000', 'Aviso B', 'Comunicado da escola B.', 'todos', now());

insert into consentimentos_lgpd (id, escola_id, titular_pessoa_id, responsavel_pessoa_id, finalidade, versao_termo, ip) values
  ('a0000000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000004', 'comunicacao_financeira', 'v1', '203.0.113.10'),
  ('b0000000-0000-0000-0000-0000000000b0', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'comunicacao_financeira', 'v1', '203.0.113.20');

-- ── Portal do responsável (0030, 0031) ────────────────────────────────────
--
-- Um segundo responsável de escola A, vinculado ao aluno A2 mas SEM
-- financeiro: enxerga o filho e não enxerga (nem assina) o contrato dele.
-- É o caso que separa "é da família" de "é quem paga" — a distinção que
-- contratos_select_responsavel e fn_assinar_contrato fazem.
insert into pessoas (id, escola_id, nome, cpf, data_nascimento, papeis, auth_user_id) values
  ('a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000000', 'Responsavel Pedagogico A', '11122238002', '1983-08-08', array['responsavel']::pessoa_papel[], 'a0000000-0000-0000-0000-0000000000f8');

insert into responsaveis_alunos (id, escola_id, responsavel_pessoa_id, aluno_id, vinculo, financeiro, pedagogico, retirada) values
  ('a0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000021', 'pai', false, true, true);

-- Contrato do aluno A2, ainda sem assinado_em: é o contrato pendente que
-- o portal oferece para assinar.
insert into contratos (id, escola_id, matricula_id, valor_anuidade, num_parcelas, vencimento_dia) values
  ('a0000000-0000-0000-0000-000000000061', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000051', 12000.00, 12, 10);

-- Quatro comunicados que cobrem cada ramo de comunicados_select: um só
-- para professores, um rascunho não enviado, e um por turma (A, onde o
-- aluno do responsável A está; A2, onde não está).
insert into comunicados (id, escola_id, titulo, corpo, publico_alvo, turma_id, enviado_em) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000000', 'Reuniao pedagogica', 'So para o corpo docente.', 'professores', null, now()),
  ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000000', 'Rascunho', 'Ainda nao enviado.', 'todos', null, null),
  ('a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000000', 'Passeio 3o Ano A', 'Somente a turma A.', 'turma_especifica', 'a0000000-0000-0000-0000-000000000012', now()),
  ('a0000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000000', 'Passeio 3o Ano B', 'Somente a turma A2.', 'turma_especifica', 'a0000000-0000-0000-0000-000000000013', now());

-- Aluno A2 com conta própria (o caso de EJA/ensino médio, em que o aluno
-- acessa o portal sozinho). Aluno A segue sem login, para que os dois
-- caminhos existam na base.
update pessoas set auth_user_id = 'a0000000-0000-0000-0000-0000000000f7'
 where id = 'a0000000-0000-0000-0000-000000000007';

-- Linhas de escola B nas tabelas novas, para que a varredura cross-tenant
-- da seção 1 tenha o que tentar ler. Sem elas o teste passaria por não
-- haver nada — que é passar por acaso, não por isolamento.
--
-- O hash é calculado do jeito real, a partir do texto renderizado: uma
-- constante inventada aqui passaria a checagem de formato e não provaria
-- integridade nenhuma.
insert into contratos_assinaturas (
  id, escola_id, contrato_id, signatario_pessoa_id, signatario_nome,
  signatario_cpf, vinculo, documento_texto, documento_hash, ip
)
select
  'b0000000-0000-0000-0000-0000000000d0',
  'b0000000-0000-0000-0000-000000000000',
  'b0000000-0000-0000-0000-000000000060',
  'b0000000-0000-0000-0000-000000000004',
  'Responsavel B',
  '22233347099',
  'mae',
  t.texto,
  encode(sha256(convert_to(t.texto, 'UTF8')), 'hex'),
  '203.0.113.20'
from (select fn_contrato_texto('b0000000-0000-0000-0000-000000000060') as texto) t;

insert into comunicados_leituras (id, escola_id, comunicado_id, pessoa_id) values
  ('b0000000-0000-0000-0000-0000000000e0', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-0000000000a0', 'b0000000-0000-0000-0000-000000000004');
