-- Domain enums for the Fase 1 core schema (spec §4).

-- Perfis de acesso (spec §3: admin, secretaria, professor, responsável) plus
-- 'aluno' as a papel a pessoa can hold in `pessoas.papeis` (a pessoa is not
-- necessarily a system user — an aluno usually is not).
create type pessoa_papel as enum ('admin', 'secretaria', 'professor', 'responsavel', 'aluno');

create type etapa_ensino as enum ('infantil', 'fundamental_i', 'fundamental_ii', 'medio');
create type modalidade_curso as enum ('presencial', 'hibrido', 'ead');
create type turno as enum ('manha', 'tarde', 'integral', 'noite');
create type ano_letivo_status as enum ('planejamento', 'ativo', 'encerrado');
create type matricula_status as enum ('pre', 'ativa', 'trancada', 'transferida', 'concluida');
create type vinculo_responsavel as enum ('mae', 'pai', 'avo', 'ava', 'tutor_legal', 'outro');
create type desconto_tipo as enum ('bolsa', 'irmao', 'pontualidade', 'convenio');
create type parcela_status as enum ('pendente', 'pago', 'atrasado', 'cancelado', 'isento');
create type meio_pagamento as enum ('boleto', 'pix', 'cartao', 'dinheiro', 'transferencia');
create type nota_fiscal_status as enum ('pendente', 'emitida', 'cancelada', 'erro');
create type publico_alvo as enum ('todos', 'responsaveis', 'professores', 'turma_especifica');
create type acao_log as enum ('insert', 'update', 'delete');
