// Milestone 8: called by the Make.com daily régua scenario (spec §5:
// "D-3 lembrete, D+1, D+7, D+15, D+30... Fronteira: Make nunca escreve
// direto no Postgres. Chama Edge Functions."). Returns every parcela
// due for a reminder today, across all escolas — this is a
// platform-level batch job, not a per-tenant user request, so it uses
// service_role and is authorized by a shared token instead of RLS.
//
// STUBBED auth: REGUAS_API_TOKEN is unset in this account, so every call
// is rejected with reguas_not_configured until an operator sets it
// (Supabase project secrets) and configures the same value in the Make
// scenario's HTTP module header. See erp-escolar-br/README.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const OFFSETS: Record<string, number> = { "D-3": -3, "D+1": 1, "D+7": 7, "D+15": 15, "D+30": 30 };

interface ParcelaBusca {
  id: string;
  valor_liquido: string;
  vencimento: string;
  contratos: {
    matriculas: {
      alunos: {
        pessoas: { nome: string } | null;
        responsaveis_alunos: { financeiro: boolean; pessoas: { nome: string } | null }[];
      } | null;
    } | null;
  } | null;
}

Deno.serve(async (req: Request) => {
  const expectedToken = Deno.env.get("REGUAS_API_TOKEN");
  if (!expectedToken) return json({ error: "reguas_not_configured" }, 501);

  if (req.headers.get("Authorization") !== `Bearer ${expectedToken}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const itens: Record<string, unknown>[] = [];

  for (const [bucket, offset] of Object.entries(OFFSETS)) {
    const target = new Date();
    target.setUTCDate(target.getUTCDate() + offset);
    const dataAlvo = target.toISOString().slice(0, 10);

    const { data, error } = await admin
      .from("parcelas")
      .select(
        "id, valor_liquido, vencimento, contratos(matriculas(alunos(pessoas(nome), responsaveis_alunos(financeiro, pessoas(nome)))))",
      )
      .in("status", ["pendente", "atrasado"])
      .eq("vencimento", dataAlvo)
      .is("deleted_at", null)
      .returns<ParcelaBusca[]>();

    if (error) continue;

    for (const p of data ?? []) {
      const aluno = p.contratos?.matriculas?.alunos;
      const responsavelFinanceiro = aluno?.responsaveis_alunos?.find((r) => r.financeiro);
      itens.push({
        parcela_id: p.id,
        bucket,
        vencimento: p.vencimento,
        valor_liquido: p.valor_liquido,
        aluno_nome: aluno?.pessoas?.nome ?? null,
        responsavel_nome: responsavelFinanceiro?.pessoas?.nome ?? null,
      });
    }
  }

  return json({ gerado_em: new Date().toISOString(), itens });
});
