// Milestone 8: called by the Make.com weekly report scenario (spec §5:
// "Relatório semanal de inadimplência para a direção"). Returns overdue
// totals grouped by escola, across the whole platform — same
// service_role + shared-token authorization pattern as
// reguas-cobranca-pendentes (see that function's header comment).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface ParcelaVencida {
  id: string;
  escola_id: string;
  valor_liquido: string;
  escolas: { razao_social: string } | null;
}

interface ResumoEscola {
  escola_id: string;
  escola_nome: string | null;
  total_parcelas: number;
  total_valor: number;
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

  const hoje = new Date().toISOString().slice(0, 10);

  const { data, error } = await admin
    .from("parcelas")
    .select("id, escola_id, valor_liquido, escolas(razao_social)")
    .in("status", ["pendente", "atrasado"])
    .lt("vencimento", hoje)
    .is("deleted_at", null)
    .returns<ParcelaVencida[]>();

  if (error) return json({ error: "query_failed", detail: error.message }, 500);

  const porEscola = new Map<string, ResumoEscola>();
  for (const p of data ?? []) {
    const entry = porEscola.get(p.escola_id) ?? {
      escola_id: p.escola_id,
      escola_nome: p.escolas?.razao_social ?? null,
      total_parcelas: 0,
      total_valor: 0,
    };
    entry.total_parcelas += 1;
    entry.total_valor += Number(p.valor_liquido);
    porEscola.set(p.escola_id, entry);
  }

  return json({ gerado_em: new Date().toISOString(), escolas: [...porEscola.values()] });
});
