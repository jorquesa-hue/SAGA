// Emits a nota fiscal (NFS-e) for one pagamento. Staff-only (admin/
// secretaria of the pagamento's own escola) — spec §3.7: privileged
// operations live in Edge Functions, never client-side.
//
// Provider-agnostic by design (the user's own ask: "integration friendly,
// so it could integrate to issue eNF and other 3rd party solutions").
// Any provider that accepts { prestador, tomador, valor, dataEmissao }
// as JSON and returns { referencia, status } can be plugged in via
// NFE_PROVIDER_API_URL/NFE_PROVIDER_API_KEY — no code change needed to
// switch between e.g. PlugNotas, eNotas, NFE.io, or a município's own
// API. The prestador block resolves per-unidade CNPJ (Migration 0014 —
// "separate CNPJ by school"), not a single tenant-wide CNPJ.
//
// When no provider is configured (this account's default state — no
// real eNF account exists), falls back to recording a `pendente`
// bookkeeping row so staff can still track "NF owed but not yet issued"
// without a real integration. This differs from the Asaas functions,
// which hard-stub with 501: there is no equivalent "can't do anything at
// all" case here — manual/bookkeeping NF tracking is a real, useful mode
// on its own.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface PagamentoComContexto {
  id: string;
  valor: string;
  data: string;
  parcelas: {
    contratos: {
      matriculas: {
        alunos: {
          pessoas: { nome: string; cpf: string | null } | null;
          responsaveis_alunos: {
            financeiro: boolean;
            pessoas: { nome: string; cpf: string | null } | null;
          }[];
        } | null;
        turmas: {
          unidades: {
            razao_social: string;
            cnpj: string;
            inscricao_municipal: string | null;
            municipio_ibge: string;
          } | null;
        } | null;
      } | null;
    } | null;
  } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

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

  let body: { pagamento_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.pagamento_id) {
    return json({ error: "missing_field", field: "pagamento_id" }, 400);
  }

  const { data: existente } = await callerClient
    .from("notas_fiscais")
    .select("id, status")
    .eq("pagamento_id", body.pagamento_id)
    .maybeSingle();
  if (existente) {
    return json(
      { error: "nota_fiscal_already_exists", notas_fiscais_id: existente.id },
      409,
    );
  }

  // RLS on pagamentos already scopes this select to the caller's own
  // escola (pagamentos_select_staff), so a cross-tenant pagamento_id
  // resolves to no rows rather than another school's data.
  const { data: pagamento, error: pagamentoError } = await callerClient
    .from("pagamentos")
    .select(
      "id, valor, data, parcelas(contratos(matriculas(alunos(pessoas(nome, cpf), responsaveis_alunos(financeiro, pessoas(nome, cpf))), turmas(unidades(razao_social, cnpj, inscricao_municipal, municipio_ibge)))))",
    )
    .eq("id", body.pagamento_id)
    .maybeSingle<PagamentoComContexto>();

  if (pagamentoError || !pagamento) return json({ error: "pagamento_not_found" }, 404);

  const unidade = pagamento.parcelas?.contratos?.matriculas?.turmas?.unidades;
  const aluno = pagamento.parcelas?.contratos?.matriculas?.alunos;
  const responsavelFinanceiro = aluno?.responsaveis_alunos?.find((r) => r.financeiro);
  const tomador = responsavelFinanceiro?.pessoas ?? aluno?.pessoas;

  if (!unidade) {
    return json({ error: "unidade_sem_dados_fiscais" }, 422);
  }

  const providerUrl = Deno.env.get("NFE_PROVIDER_API_URL");
  const providerKey = Deno.env.get("NFE_PROVIDER_API_KEY");

  if (!providerUrl || !providerKey) {
    const { data: notaFiscal, error: insertError } = await admin
      .from("notas_fiscais")
      .insert({ pagamento_id: pagamento.id, status: "pendente" })
      .select("id, status")
      .single();
    if (insertError) return json({ error: insertError.message }, 400);
    return json(
      { ...notaFiscal, detail: "nfe_provider_not_configured — recorded as pendente" },
      202,
    );
  }

  const payload = {
    prestador: {
      cnpj: unidade.cnpj,
      razaoSocial: unidade.razao_social,
      inscricaoMunicipal: unidade.inscricao_municipal,
      municipioIbge: unidade.municipio_ibge,
    },
    tomador: { nome: tomador?.nome, cpf: tomador?.cpf },
    valor: Number(pagamento.valor),
    dataEmissao: pagamento.data,
    referenciaOrigem: pagamento.id,
  };

  const providerResponse = await fetch(providerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerKey}`,
    },
    body: JSON.stringify(payload),
  }).catch((err: Error) => ({
    ok: false,
    status: 0,
    text: () => Promise.resolve(err.message),
  }));

  if (!providerResponse.ok) {
    const detail = await providerResponse.text();
    const { data: notaFiscal } = await admin
      .from("notas_fiscais")
      .insert({ pagamento_id: pagamento.id, status: "erro", erro_detalhe: detail })
      .select("id, status")
      .single();
    return json({ ...notaFiscal, error: "nfe_provider_error", detail }, 502);
  }

  const providerData: { referencia?: string; status?: string; numero?: string } =
    await providerResponse.json();

  const { data: notaFiscal, error: insertError } = await admin
    .from("notas_fiscais")
    .insert({
      pagamento_id: pagamento.id,
      status: providerData.status === "emitida" ? "emitida" : "pendente",
      numero: providerData.numero ?? null,
      provedor: new URL(providerUrl).hostname,
      referencia_externa: providerData.referencia ?? null,
      emitida_em: providerData.status === "emitida" ? new Date().toISOString() : null,
    })
    .select("id, status, numero")
    .single();

  if (insertError) return json({ error: insertError.message }, 400);
  return json(notaFiscal, 201);
});
