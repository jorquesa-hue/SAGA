// Milestone 5: creates an Asaas customer (if needed) and a cobrança for
// one parcela, storing the resulting id back on parcelas.asaas_cobranca_id.
// Staff-only (admin/secretaria of the parcela's own escola) — spec §3.7:
// privileged operations live in Edge Functions, never client-side, and
// this one also needs the service_role-only ASAAS_API_KEY secret.
//
// STUBBED: this account has no real Asaas account. ASAAS_API_KEY is
// unset, so every call is rejected with asaas_not_configured until an
// operator sets it (Supabase project secrets) to a real Asaas API key.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("ASAAS_API_KEY");
  if (!apiKey) {
    return json({ error: "asaas_not_configured" }, 501);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerAuth?.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerPessoa } = await admin
    .from("pessoas")
    .select("papeis")
    .eq("auth_user_id", callerAuth.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  const papeis: string[] = callerPessoa?.papeis ?? [];
  if (!papeis.includes("admin") && !papeis.includes("secretaria")) {
    return json({ error: "forbidden" }, 403);
  }

  let body: { parcela_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.parcela_id) return json({ error: "missing_field", field: "parcela_id" }, 400);

  // RLS on parcelas already scopes this select to the caller's own escola
  // (parcelas_select_staff), so a cross-tenant parcela_id resolves to no
  // rows rather than another school's data.
  const { data: parcela, error: parcelaError } = await callerClient
    .from("parcelas")
    .select(
      "id, valor_liquido, vencimento, asaas_cobranca_id, contratos(matriculas(alunos(responsaveis_alunos(financeiro, pessoas(nome, cpf)))))",
    )
    .eq("id", body.parcela_id)
    .maybeSingle();

  if (parcelaError || !parcela) return json({ error: "parcela_not_found" }, 404);
  if (parcela.asaas_cobranca_id) {
    return json({ error: "cobranca_already_exists", asaas_cobranca_id: parcela.asaas_cobranca_id }, 409);
  }

  // Real integration TODO (spec §5), against https://api.asaas.com/v3:
  // resolve the financeiro-responsible pessoa from the nested relation
  // above, call POST /customers with their name/cpfCnpj (cache the
  // resulting Asaas customer id), then POST /payments with { customer,
  // billingType: "UNDEFINED", value, dueDate: parcela.vencimento }, using
  // apiKey as the `access_token` header per Asaas's documented auth. Left
  // unimplemented because it cannot be tested against a real Asaas
  // sandbox from this session.
  return json({ error: "asaas_not_configured", detail: "integration stubbed, see README" }, 501);
});
