-- Adds the 'migracao' payment method.
--
-- A school that is already operating arrives with a payment position, not a
-- payment history: the sheet says "as mensalidades de fevereiro a junho
-- estão quitadas", and nobody remembers (or exported) whether each one was
-- a boleto, a PIX or cash at the secretaria. Recording those settlements as
-- 'dinheiro' or 'boleto' would be inventing facts, and would poison every
-- report that breaks revenue down by meio de pagamento.
--
-- 'migracao' says exactly what is true: this parcela was already settled
-- before the school started using the system, and the original instrument
-- is not known. Reports can then exclude it from "como recebemos" analyses
-- without excluding it from "quanto recebemos".
--
-- This is its own migration on purpose: PostgreSQL will not let a new enum
-- value be *used* in the same transaction that adds it, and
-- fn_importar_matriculas (0025) inserts pagamentos with exactly this value.

alter type meio_pagamento add value if not exists 'migracao';
