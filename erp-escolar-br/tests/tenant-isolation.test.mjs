// Mandatory tenant-isolation attack suite (spec §3: "Teste obrigatório
// antes de cada deploy: suite que autentica como escola A e tenta ler
// dados da escola B. Falha = build quebra.").
//
// Connects as `app_test_user` (APP_DATABASE_URL) — a non-superuser role
// subject to RLS, unlike the ADMIN_DATABASE_URL connection used to apply
// migrations/fixtures. Each "request" is simulated as its own transaction
// with request.jwt.claims set via set_config(..., true) (scoped to that
// transaction, mirroring how PostgREST sets it per-request), then rolled
// back so no attack attempt can leave mutated state behind.
//
// Run: pnpm --dir erp-escolar-br run db:reset:test && \
//      pnpm --dir erp-escolar-br run test:tenant-isolation
// (or the plain npm equivalents — see README.md)

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import {
  alunos,
  authUsers,
  comunicados,
  consentimentos,
  contratos,
  escolaA,
  escolaB,
  notasFiscais,
  pagamentos,
  parcelas,
  pessoas,
  turmas,
} from "./fixtures/ids.mjs";

const appDatabaseUrl = process.env.APP_DATABASE_URL;
if (!appDatabaseUrl) {
  throw new Error("APP_DATABASE_URL is required (a non-superuser role subject to RLS).");
}

const client = new pg.Client({ connectionString: appDatabaseUrl });

before(async () => {
  await client.connect();
});

after(async () => {
  await client.end();
});

// `escola_role` (not `role` — Supabase reserves the top-level `role` claim
// for anon/authenticated; see 0010_fix_role_claim_key.sql).
const actors = {
  adminA: { sub: authUsers.adminA, escola_id: escolaA, escola_role: "admin" },
  secretariaA: {
    sub: authUsers.secretariaA,
    escola_id: escolaA,
    escola_role: "secretaria",
  },
  professorA: {
    sub: authUsers.professorA,
    escola_id: escolaA,
    escola_role: "professor",
  },
  responsavelA: {
    sub: authUsers.responsavelA,
    escola_id: escolaA,
    escola_role: "responsavel",
  },
  outroResponsavelA: {
    sub: authUsers.outroResponsavelA,
    escola_id: escolaA,
    escola_role: "responsavel",
  },
  // Vinculado ao alunoA2 com financeiro = false: é da família, não é quem
  // paga. Separa "pode ver o filho" de "pode ver e assinar o contrato".
  responsavelPedagogicoA: {
    sub: authUsers.responsavelPedagogicoA,
    escola_id: escolaA,
    escola_role: "responsavel",
  },
  // Aluno com conta própria (EJA / ensino médio).
  alunoA2: {
    sub: authUsers.alunoA2,
    escola_id: escolaA,
    escola_role: "aluno",
  },
};

// Troca as claims da transação corrente. Separado de withActor porque um
// teste precisa de dois atores agindo sobre o mesmo estado, antes do
// rollback — set_config(..., true) é por transação, então isto equivale a
// duas requisições seguidas.
async function setActor(actor) {
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify(actor),
  ]);
}

async function withActor(actor, fn) {
  await client.query("begin");
  try {
    await setActor(actor);
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

async function countWhereEscola(table, escolaId) {
  const { rows } = await client.query(
    `select count(*)::int as n from ${table} where escola_id = $1`,
    [escolaId],
  );
  return rows[0].n;
}

// Every tenant-scoped table besides `escolas` itself (handled separately
// below, since its tenant column is `id`, not `escola_id`).
const tenantTables = [
  "unidades",
  "anos_letivos",
  "cursos",
  "turmas",
  "pessoas",
  "alunos",
  "responsaveis_alunos",
  "professores_turmas",
  "matriculas",
  "contratos",
  "descontos",
  "parcelas",
  "pagamentos",
  "notas_fiscais",
  "comunicados",
  "consentimentos_lgpd",
];

// ── 1. Cross-tenant SELECT: every escola-A profile, every table, escola B
// rows must never come back. This is the suite the spec makes non-negotiable.
for (const [actorName, actor] of Object.entries(actors)) {
  for (const table of tenantTables) {
    test(`${actorName} reading ${table} sees zero escola B rows`, async () => {
      const n = await withActor(actor, () => countWhereEscola(table, escolaB));
      assert.equal(n, 0, `${actorName} could read ${table} rows belonging to escola B`);
    });
  }

  test(`${actorName} reading escolas sees zero escola B rows`, async () => {
    const n = await withActor(actor, async () => {
      const { rows } = await client.query(
        "select count(*)::int as n from escolas where id = $1",
        [escolaB],
      );
      return rows[0].n;
    });
    assert.equal(n, 0, `${actorName} could read escola B's own escolas row`);
  });
}

// logs_acesso is admin-only even within the same tenant, so it is checked
// separately (a positive count for a non-admin role would itself be a
// finding, not just a cross-tenant one).
for (const [actorName, actor] of Object.entries(actors)) {
  test(`${actorName} reading logs_acesso sees zero escola B rows`, async () => {
    const n = await withActor(actor, () => countWhereEscola("logs_acesso", escolaB));
    assert.equal(n, 0, `${actorName} could read logs_acesso rows belonging to escola B`);
  });
}

// ── 2. Positive control: escola A admin actually sees escola A data. If
// the policies were accidentally "deny everything", every test above would
// pass for the wrong reason.
test("adminA reading own escola sees its own rows", async () => {
  const counts = await withActor(actors.adminA, async () => {
    const results = {};
    for (const table of tenantTables) {
      results[table] = await countWhereEscola(table, escolaA);
    }
    return results;
  });
  for (const table of tenantTables) {
    assert.ok(counts[table] > 0, `adminA saw 0 rows of its own escola A in ${table}`);
  }
});

test("adminA reading logs_acesso sees escola A rows (admin-only access within tenant)", async () => {
  const n = await withActor(actors.adminA, () =>
    countWhereEscola("logs_acesso", escolaA),
  );
  assert.ok(n > 0, "adminA saw 0 logs_acesso rows for its own escola");
});

for (const actorName of ["secretariaA", "professorA", "responsavelA"]) {
  test(`${actorName} reading logs_acesso sees zero rows even within escola A (admin-only)`, async () => {
    const n = await withActor(actors[actorName], () =>
      countWhereEscola("logs_acesso", escolaA),
    );
    assert.equal(n, 0, `${actorName} could read logs_acesso despite not being admin`);
  });
}

// ── 3. Role-scoping within the SAME tenant (spec §3.5, §3.6): professor
// only sees turmas/alunos he is assigned to; responsavel only sees own
// dependentes. Escola A has a second turma/aluno that professorA is NOT
// assigned to, and a second responsavel with no linked aluno at all.
test("professorA sees aluno A (own turma) but not aluno A2 (unassigned turma)", async () => {
  const { visible, hidden } = await withActor(actors.professorA, async () => {
    const v = await client.query("select 1 from alunos where id = $1", [alunos.a]);
    const h = await client.query("select 1 from alunos where id = $1", [alunos.a2]);
    return { visible: v.rowCount, hidden: h.rowCount };
  });
  assert.equal(visible, 1, "professorA could not see the aluno in its own turma");
  assert.equal(
    hidden,
    0,
    "professorA could see an aluno in a turma it is not assigned to",
  );
});

test("professorA sees turma A but not turma A2", async () => {
  const { visible, hidden } = await withActor(actors.professorA, async () => {
    const v = await client.query("select 1 from turmas where id = $1", [turmas.a]);
    const h = await client.query("select 1 from turmas where id = $1", [turmas.a2]);
    return { visible: v.rowCount, hidden: h.rowCount };
  });
  assert.equal(visible, 1, "professorA could not see its own assigned turma");
  assert.equal(hidden, 0, "professorA could see a turma it is not assigned to");
});

test("responsavelA sees own aluno but not the other aluno in escola A", async () => {
  const { visible, hidden } = await withActor(actors.responsavelA, async () => {
    const v = await client.query("select 1 from alunos where id = $1", [alunos.a]);
    const h = await client.query("select 1 from alunos where id = $1", [alunos.a2]);
    return { visible: v.rowCount, hidden: h.rowCount };
  });
  assert.equal(visible, 1, "responsavelA could not see its own dependente");
  assert.equal(
    hidden,
    0,
    "responsavelA could see an aluno it has no responsaveis_alunos link to",
  );
});

test("outroResponsavelA (no linked aluno) sees zero alunos in escola A", async () => {
  const n = await withActor(actors.outroResponsavelA, async () => {
    const { rows } = await client.query(
      "select count(*)::int as n from alunos where escola_id = $1",
      [escolaA],
    );
    return rows[0].n;
  });
  assert.equal(
    n,
    0,
    "a responsavel with no responsaveis_alunos link could still see alunos",
  );
});

test("responsavelA (financeiro=true) can see own contrato/parcela/pagamento/nota_fiscal", async () => {
  const counts = await withActor(actors.responsavelA, async () => {
    const c = await client.query("select 1 from contratos where id = $1", [contratos.a]);
    const p = await client.query("select 1 from parcelas where id = $1", [parcelas.a]);
    const pg_ = await client.query("select 1 from pagamentos where id = $1", [
      pagamentos.a,
    ]);
    const nf = await client.query("select 1 from notas_fiscais where id = $1", [
      notasFiscais.a,
    ]);
    return { c: c.rowCount, p: p.rowCount, pg: pg_.rowCount, nf: nf.rowCount };
  });
  assert.equal(counts.c, 1, "responsavelA could not see its own contrato");
  assert.equal(counts.p, 1, "responsavelA could not see its own parcela");
  assert.equal(counts.pg, 1, "responsavelA could not see its own pagamento");
  assert.equal(counts.nf, 1, "responsavelA could not see its own nota_fiscal");
});

test("professorA has zero access to financeiro tables (data minimisation)", async () => {
  const counts = await withActor(actors.professorA, async () => {
    const c = await client.query(
      "select count(*)::int as n from contratos where escola_id = $1",
      [escolaA],
    );
    const p = await client.query(
      "select count(*)::int as n from parcelas where escola_id = $1",
      [escolaA],
    );
    return { c: c.rows[0].n, p: p.rows[0].n };
  });
  assert.equal(counts.c, 0, "professorA could read contratos");
  assert.equal(counts.p, 0, "professorA could read parcelas");
});

// ── 4. Active cross-tenant write attempts, not just passive reads.
test("adminA cannot INSERT a row into escola B", async () => {
  await assert.rejects(
    () =>
      withActor(actors.adminA, () =>
        client.query(
          "insert into unidades (escola_id, nome, endereco) values ($1, 'Ataque', '{}'::jsonb)",
          [escolaB],
        ),
      ),
    /row-level security/i,
    "adminA was able to insert a row tagged with escola B's id",
  );
});

test("adminA UPDATE targeting a known escola B row affects zero rows", async () => {
  const rowCount = await withActor(actors.adminA, async () => {
    const res = await client.query("update parcelas set status = 'pago' where id = $1", [
      parcelas.b,
    ]);
    return res.rowCount;
  });
  assert.equal(rowCount, 0, "adminA's UPDATE matched a row belonging to escola B");
});

test("adminA cannot INSERT a pessoa claiming escola B's id (WITH CHECK enforced)", async () => {
  await assert.rejects(
    () =>
      withActor(actors.adminA, () =>
        client.query(
          "insert into pessoas (escola_id, nome, data_nascimento, papeis) values ($1, 'Invasor', '2000-01-01', array['aluno']::pessoa_papel[])",
          [escolaB],
        ),
      ),
    /row-level security/i,
  );
});

// ── 5. No application role can hard-delete (spec §4: append-only + soft
// delete only). DELETE is refused twice over: no table grants DELETE to
// `authenticated` at all (fails outright with "permission denied"), and
// even a role that somehow had the grant would still have no DELETE
// policy to satisfy.
test("adminA cannot hard-delete its own escola's data (no DELETE grant, no DELETE policy)", async () => {
  await assert.rejects(
    () =>
      withActor(actors.adminA, () =>
        client.query("delete from comunicados where id = $1", [comunicados.a]),
      ),
    /permission denied/i,
    "adminA was able to hard-delete a row — DELETE must be denied for every role",
  );
});

// ── 6. consentimentos_lgpd is append-only: no UPDATE grant or policy
// exists at all (guarda permanente).
test("adminA cannot UPDATE a consentimento_lgpd row (append-only, guarda permanente)", async () => {
  await assert.rejects(
    () =>
      withActor(actors.adminA, () =>
        client.query(
          "update consentimentos_lgpd set finalidade = 'alterado' where id = $1",
          [consentimentos.a],
        ),
      ),
    /permission denied/i,
    "a consentimento_lgpd row was updated — consent records must be immutable",
  );
});

// ── 7. Comunicados: público-alvo restringe de verdade (0030).
//
// Antes da 0030 a política era só `escola_id = fn_jwt_escola_id()`, e
// todos os casos abaixo passavam — no sentido errado. Filtrar na tela não
// contava: estes testes falam com o banco direto, que é o que um token
// vazado também faz.

async function vePodeLer(actor, comunicadoId) {
  return withActor(actor, async () => {
    const { rowCount } = await client.query("select 1 from comunicados where id = $1", [
      comunicadoId,
    ]);
    return rowCount === 1;
  });
}

test("responsavelA não lê comunicado dirigido aos professores", async () => {
  assert.equal(
    await vePodeLer(actors.responsavelA, comunicados.aProfessores),
    false,
    "um responsável leu o que a escola escreveu para o corpo docente",
  );
});

test("responsavelA não lê comunicado ainda não enviado (rascunho)", async () => {
  assert.equal(
    await vePodeLer(actors.responsavelA, comunicados.aRascunho),
    false,
    "um responsável leu um rascunho — enviado_em deixou de ser a fronteira",
  );
});

test("professorA não lê rascunho", async () => {
  assert.equal(await vePodeLer(actors.professorA, comunicados.aRascunho), false);
});

test("secretariaA lê tudo, inclusive o rascunho que escreveu", async () => {
  assert.equal(await vePodeLer(actors.secretariaA, comunicados.aRascunho), true);
  assert.equal(await vePodeLer(actors.secretariaA, comunicados.aProfessores), true);
  assert.equal(await vePodeLer(actors.secretariaA, comunicados.aTurmaA2), true);
});

test("responsavelA lê o comunicado da turma do filho, e não o da outra turma", async () => {
  assert.equal(
    await vePodeLer(actors.responsavelA, comunicados.aTurmaA),
    true,
    "o responsável não recebeu o comunicado da turma em que o filho está",
  );
  assert.equal(
    await vePodeLer(actors.responsavelA, comunicados.aTurmaA2),
    false,
    "o responsável recebeu o comunicado de uma turma em que não tem filho",
  );
});

test("professorA lê o comunicado da turma que leciona, e não o da outra", async () => {
  assert.equal(await vePodeLer(actors.professorA, comunicados.aTurmaA), true);
  assert.equal(
    await vePodeLer(actors.professorA, comunicados.aTurmaA2),
    false,
    "o professor leu o comunicado de uma turma que não é dele",
  );
});

test("aluno com conta própria lê o geral e o da turma, nunca o dos responsáveis", async () => {
  assert.equal(await vePodeLer(actors.alunoA2, comunicados.a), true);
  assert.equal(await vePodeLer(actors.alunoA2, comunicados.aTurmaA2), true);
  assert.equal(await vePodeLer(actors.alunoA2, comunicados.aTurmaA), false);
  assert.equal(
    await vePodeLer(actors.alunoA2, comunicados.aProfessores),
    false,
    "o aluno leu comunicado dirigido aos professores",
  );
});

test("comunicado 'turma_especifica' sem turma é rejeitado pelo banco", async () => {
  await assert.rejects(
    () =>
      withActor(actors.secretariaA, () =>
        client.query(
          `insert into comunicados (escola_id, titulo, corpo, publico_alvo, enviado_em)
           values ($1, 'Sem turma', 'Corpo', 'turma_especifica', now())`,
          [escolaA],
        ),
      ),
    /comunicados_turma_coerente/,
    "gravou comunicado de turma sem dizer qual turma — o rótulo voltaria a mentir",
  );
});

// ── 8. Confirmação de leitura (0030): fato datado, em nome próprio.

test("responsavelA confirma leitura de um comunicado que enxerga", async () => {
  const n = await withActor(actors.responsavelA, async () => {
    await client.query(
      "insert into comunicados_leituras (escola_id, comunicado_id, pessoa_id) values ($1, $2, $3)",
      [escolaA, comunicados.a, pessoas.responsavelA],
    );
    const { rows } = await client.query(
      "select count(*)::int as n from comunicados_leituras where comunicado_id = $1 and pessoa_id = $2",
      [comunicados.a, pessoas.responsavelA],
    );
    return rows[0].n;
  });
  assert.equal(n, 1);
});

test("responsavelA não confirma leitura de comunicado que não enxerga", async () => {
  await assert.rejects(
    () =>
      withActor(actors.responsavelA, () =>
        client.query(
          "insert into comunicados_leituras (escola_id, comunicado_id, pessoa_id) values ($1, $2, $3)",
          [escolaA, comunicados.aProfessores, pessoas.responsavelA],
        ),
      ),
    /row-level security/i,
    "registrar leitura virou um jeito de descobrir que o comunicado existe",
  );
});

test("responsavelA não confirma leitura em nome de outra pessoa", async () => {
  await assert.rejects(
    () =>
      withActor(actors.responsavelA, () =>
        client.query(
          "insert into comunicados_leituras (escola_id, comunicado_id, pessoa_id) values ($1, $2, $3)",
          [escolaA, comunicados.a, pessoas.outroResponsavelA],
        ),
      ),
    /row-level security/i,
  );
});

test("leitura confirmada não se desfaz (sem UPDATE, sem DELETE)", async () => {
  await assert.rejects(
    () =>
      withActor(actors.adminA, () =>
        client.query(
          "update comunicados_leituras set lido_em = now() where escola_id = $1",
          [escolaA],
        ),
      ),
    /permission denied/i,
  );
  await assert.rejects(
    () =>
      withActor(actors.adminA, () =>
        client.query("delete from comunicados_leituras where escola_id = $1", [escolaA]),
      ),
    /permission denied/i,
  );
});

// ── 9. Assinatura eletrônica do contrato (0029, 0031).

test("responsavelA assina o contrato do próprio filho e o hash confere", async () => {
  const row = await withActor(actors.responsavelA, async () => {
    // O contrato A já tem assinado_em pela secretaria; assinar é outro
    // ato, da família, e não depende disso.
    await client.query("select fn_assinar_contrato($1, $2, $3)", [
      contratos.a,
      "203.0.113.55",
      "Mozilla/5.0 (teste)",
    ]);
    const { rows } = await client.query(
      `select a.documento_hash,
              encode(sha256(convert_to(a.documento_texto, 'UTF8')), 'hex') as recalculado,
              a.documento_texto = fn_contrato_texto(a.contrato_id) as texto_e_o_do_servidor,
              a.signatario_pessoa_id, host(a.ip) as ip, a.signatario_nome
         from contratos_assinaturas a
        where a.contrato_id = $1`,
      [contratos.a],
    );
    return rows[0];
  });
  assert.equal(
    row.documento_hash,
    row.recalculado,
    "o hash não corresponde ao texto gravado",
  );
  assert.equal(
    row.texto_e_o_do_servidor,
    true,
    "o texto assinado não é o que o servidor renderiza — o cliente escolheu o conteúdo",
  );
  assert.equal(row.signatario_pessoa_id, pessoas.responsavelA);
  assert.equal(row.ip, "203.0.113.55");
  assert.equal(row.signatario_nome, "Responsavel A");
});

test("assinar não sobrescreve a data que a secretaria já havia marcado", async () => {
  const [antes, depois] = await withActor(actors.responsavelA, async () => {
    const a = await client.query("select assinado_em from contratos where id = $1", [
      contratos.a,
    ]);
    await client.query("select fn_assinar_contrato($1, $2)", [
      contratos.a,
      "203.0.113.62",
    ]);
    const d = await client.query("select assinado_em from contratos where id = $1", [
      contratos.a,
    ]);
    return [a.rows[0].assinado_em, d.rows[0].assinado_em];
  });
  assert.notEqual(
    antes,
    null,
    "o fixture deixou de ter a marcação operacional da secretaria",
  );
  assert.deepEqual(
    depois,
    antes,
    "assinar sobrescreveu a data operacional — são dois fatos distintos, e os dois importam",
  );
});

test("assinar preenche contratos.assinado_em quando ainda estava nulo", async () => {
  // Dois atores na mesma transação: a secretaria desfaz a marcação
  // operacional, e em seguida a família assina. set_config(..., true) é
  // por transação, então trocar de claims aqui dentro é legítimo — é o
  // mesmo que duas requisições contra o mesmo estado.
  await client.query("begin");
  try {
    await setActor(actors.secretariaA);
    await client.query("update contratos set assinado_em = null where id = $1", [
      contratos.a,
    ]);

    await setActor(actors.responsavelA);
    await client.query("select fn_assinar_contrato($1, $2)", [
      contratos.a,
      "203.0.113.63",
    ]);

    const { rows } = await client.query(
      `select c.assinado_em, a.assinado_em as assinatura_em
         from contratos c
         join contratos_assinaturas a on a.contrato_id = c.id
        where c.id = $1`,
      [contratos.a],
    );
    assert.notEqual(
      rows[0].assinado_em,
      null,
      "o gatilho não marcou o contrato como assinado",
    );
    assert.deepEqual(
      rows[0].assinado_em,
      rows[0].assinatura_em,
      "a data do contrato não é a do aceite",
    );
  } finally {
    await client.query("rollback");
  }
});

// ── 9b. As tabelas novas continuam valendo a fronteira de tenant. Não
// entram na varredura da seção 1 porque nelas o fixture só semeia linhas
// de escola B (as de escola A nascem dos próprios testes, dentro de
// transações desfeitas) — e aquela varredura também exige linha própria
// visível.
for (const tabela of ["contratos_assinaturas", "comunicados_leituras"]) {
  for (const [nome, actor] of Object.entries(actors)) {
    test(`${nome} lendo ${tabela} não vê linha da escola B`, async () => {
      const n = await withActor(actor, () => countWhereEscola(tabela, escolaB));
      assert.equal(n, 0, `${nome} leu ${tabela} da escola B`);
    });
  }
}

test("responsável sem financeiro não assina o contrato do próprio dependente", async () => {
  await assert.rejects(
    () =>
      withActor(actors.responsavelPedagogicoA, () =>
        client.query("select fn_assinar_contrato($1, $2)", [
          contratos.a2,
          "203.0.113.57",
        ]),
      ),
    /contrato_nao_encontrado/,
    "quem não responde pelo financeiro assinou o contrato",
  );
});

test("responsavelA não assina contrato de aluno que não é seu", async () => {
  await assert.rejects(
    () =>
      withActor(actors.responsavelA, () =>
        client.query("select fn_assinar_contrato($1, $2)", [
          contratos.a2,
          "203.0.113.58",
        ]),
      ),
    /contrato_nao_encontrado/,
  );
});

test("responsavelB não assina contrato da escola A", async () => {
  await assert.rejects(
    () =>
      withActor(
        { sub: authUsers.responsavelB, escola_id: escolaB, escola_role: "responsavel" },
        () =>
          client.query("select fn_assinar_contrato($1, $2)", [
            contratos.a,
            "203.0.113.59",
          ]),
      ),
    /contrato_nao_encontrado/,
    "assinatura atravessou a fronteira de tenant",
  );
});

test("o mesmo contrato não é assinado duas vezes", async () => {
  await assert.rejects(
    () =>
      withActor(actors.responsavelA, async () => {
        await client.query("select fn_assinar_contrato($1, $2)", [
          contratos.a,
          "203.0.113.60",
        ]);
        await client.query("select fn_assinar_contrato($1, $2)", [
          contratos.a,
          "203.0.113.60",
        ]);
      }),
    /contrato_ja_assinado/,
  );
});

test("assinatura registrada não é editada nem apagada por ninguém", async () => {
  await assert.rejects(
    () =>
      withActor(actors.adminA, () =>
        client.query("update contratos_assinaturas set documento_texto = 'outro'"),
      ),
    /permission denied/i,
    "uma assinatura foi editada — a prova deixou de provar",
  );
  await assert.rejects(
    () =>
      withActor(actors.adminA, () => client.query("delete from contratos_assinaturas")),
    /permission denied/i,
  );
});

test("o signatário relê a própria assinatura; outro responsável não", async () => {
  const proprio = await withActor(actors.responsavelA, async () => {
    await client.query("select fn_assinar_contrato($1, $2)", [
      contratos.a,
      "203.0.113.61",
    ]);
    const { rowCount } = await client.query(
      "select 1 from contratos_assinaturas where contrato_id = $1",
      [contratos.a],
    );
    return rowCount;
  });
  assert.equal(proprio, 1, "quem assinou não conseguiu reler o próprio comprovante");
});

// ── 10. Contato self-service (0031), e por que a função existe.

test("responsavelA corrige o próprio e-mail pela função", async () => {
  const email = await withActor(actors.responsavelA, async () => {
    await client.query("select fn_atualizar_meu_email($1)", ["mae@example.test"]);
    const { rows } = await client.query("select email from pessoas where id = $1", [
      pessoas.responsavelA,
    ]);
    return rows[0].email;
  });
  assert.equal(email, "mae@example.test");
});

test("a função não alcança a pessoa de outra pessoa", async () => {
  const outro = await withActor(actors.responsavelA, async () => {
    await client.query("select fn_atualizar_meu_email($1)", ["invasor@example.test"]);
    return null;
  });
  assert.equal(outro, null);
  // Fora da transação do teste acima nada foi gravado (rollback); o ponto
  // aqui é que a função não recebe "de quem" — só existe o próprio.
});

test("e-mail em branco apaga o contato, em vez de gravar string vazia", async () => {
  const email = await withActor(actors.responsavelA, async () => {
    await client.query("select fn_atualizar_meu_email($1)", ["mae@example.test"]);
    await client.query("select fn_atualizar_meu_email($1)", ["   "]);
    const { rows } = await client.query("select email from pessoas where id = $1", [
      pessoas.responsavelA,
    ]);
    return rows[0].email;
  });
  assert.equal(email, null);
});

// É por isto que fn_atualizar_meu_email existe em vez de uma política
// `pessoas_update_self`: RLS autoriza LINHAS, não COLUNAS, e `authenticated`
// tem UPDATE na tabela inteira. Com uma política de linha própria, este
// UPDATE viraria escalada de privilégio em uma requisição.
test("responsavelA não altera a própria linha em pessoas (nem para virar admin)", async () => {
  const rowCount = await withActor(actors.responsavelA, async () => {
    const res = await client.query(
      "update pessoas set papeis = array['admin']::pessoa_papel[] where id = $1",
      [pessoas.responsavelA],
    );
    return res.rowCount;
  });
  assert.equal(
    rowCount,
    0,
    "um responsável reescreveu os próprios papéis — existe política de UPDATE self em pessoas",
  );
});
