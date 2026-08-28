// Milestone 2: invite a user (secretaria/professor/responsavel/another
// admin) into the caller's own escola. Runs with service_role (bypasses
// RLS), so authorization is enforced explicitly in code here — the
// caller's escola_id and papeis are read from THEIR OWN pessoas row via
// their auth_user_id, never accepted as request input (spec §3.4/§3.7).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface VinculoResponsavel {
  aluno_id: string;
  vinculo: string;
  financeiro?: boolean;
  pedagogico?: boolean;
  retirada?: boolean;
}

interface InviteBody {
  nome?: string;
  email?: string;
  cpf?: string;
  data_nascimento?: string;
  papeis?: string[];
  vinculos_responsavel?: VinculoResponsavel[];
}

const ALLOWED_PAPEIS = ["admin", "secretaria", "professor", "responsavel"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Identifies the caller from their own JWT (never trust a client-sent
  // escola_id/pessoa_id for this).
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerAuth?.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerPessoa, error: callerPessoaError } = await admin
    .from("pessoas")
    .select("id, escola_id, papeis")
    .eq("auth_user_id", callerAuth.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (callerPessoaError || !callerPessoa) return json({ error: "unauthorized" }, 401);

  const callerPapeis: string[] = callerPessoa.papeis ?? [];
  if (!callerPapeis.includes("admin") && !callerPapeis.includes("secretaria")) {
    return json({ error: "forbidden", detail: "apenas admin ou secretaria pode convidar" }, 403);
  }

  let body: InviteBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!body.nome || !body.email || !body.data_nascimento || !body.papeis?.length) {
    return json({ error: "missing_field" }, 400);
  }
  const invalidPapel = body.papeis.find((p) => !ALLOWED_PAPEIS.includes(p));
  if (invalidPapel) return json({ error: "invalid_papel", papel: invalidPapel }, 400);

  const escolaId = callerPessoa.escola_id;

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    body.email,
    { data: { nome: body.nome } },
  );

  if (inviteError || !invited?.user) {
    return json({ error: "invite_failed", detail: inviteError?.message }, 400);
  }

  const { data: pessoa, error: pessoaError } = await admin
    .from("pessoas")
    .insert({
      escola_id: escolaId,
      nome: body.nome,
      cpf: body.cpf ?? null,
      data_nascimento: body.data_nascimento,
      papeis: body.papeis,
      auth_user_id: invited.user.id,
    })
    .select("id")
    .single();

  if (pessoaError || !pessoa) {
    await admin.auth.admin.deleteUser(invited.user.id);
    return json({ error: "pessoa_insert_failed", detail: pessoaError?.message }, 400);
  }

  if (body.papeis.includes("responsavel") && body.vinculos_responsavel?.length) {
    const rows = body.vinculos_responsavel.map((v) => ({
      escola_id: escolaId,
      responsavel_pessoa_id: pessoa.id,
      aluno_id: v.aluno_id,
      vinculo: v.vinculo,
      financeiro: v.financeiro ?? false,
      pedagogico: v.pedagogico ?? false,
      retirada: v.retirada ?? false,
    }));
    const { error: vinculoError } = await admin.from("responsaveis_alunos").insert(rows);
    if (vinculoError) {
      // The pessoa/auth user are still valid (a responsavel invite with a
      // bad vinculo shouldn't undo their account) — report the partial
      // failure so the caller can retry linking, don't compensate.
      return json(
        { pessoa_id: pessoa.id, invited_user_id: invited.user.id, vinculo_error: vinculoError.message },
        207,
      );
    }
  }

  return json({ pessoa_id: pessoa.id, invited_user_id: invited.user.id }, 201);
});
