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

const actors = {
  adminA: { sub: authUsers.adminA, escola_id: escolaA, role: "admin" },
  secretariaA: { sub: authUsers.secretariaA, escola_id: escolaA, role: "secretaria" },
  professorA: { sub: authUsers.professorA, escola_id: escolaA, role: "professor" },
  responsavelA: { sub: authUsers.responsavelA, escola_id: escolaA, role: "responsavel" },
  outroResponsavelA: {
    sub: authUsers.outroResponsavelA,
    escola_id: escolaA,
    role: "responsavel",
  },
};

async function withActor(actor, fn) {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(actor),
    ]);
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
