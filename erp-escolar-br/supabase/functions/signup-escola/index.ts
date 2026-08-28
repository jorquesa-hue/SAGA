// Milestone 2: escola signup. Creates the escola, the admin's auth user,
// and the admin's pessoas row in one server-side call — never done from
// the browser (spec §3.7: "Nenhuma query do frontend usa service_role.
// Operações privilegiadas ficam em Edge Functions.").
//
// No caller identity is required (there is no user yet); anyone with the
// project's public anon key can call this, same as any public signup
// form. escola_id is generated server-side and is never accepted as
// client input for any OTHER endpoint after this one.
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

interface SignupBody {
  razao_social?: string;
  cnpj?: string;
  municipio_ibge?: string;
  inep_codigo?: string;
  admin_nome?: string;
  admin_email?: string;
  admin_password?: string;
  admin_cpf?: string;
  admin_data_nascimento?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: SignupBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const required: (keyof SignupBody)[] = [
    "razao_social",
    "cnpj",
    "municipio_ibge",
    "admin_nome",
    "admin_email",
    "admin_password",
    "admin_data_nascimento",
  ];
  for (const field of required) {
    if (!body[field]) return json({ error: "missing_field", field }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: escola, error: escolaError } = await supabase
    .from("escolas")
    .insert({
      razao_social: body.razao_social,
      cnpj: body.cnpj,
      municipio_ibge: body.municipio_ibge,
      inep_codigo: body.inep_codigo ?? null,
    })
    .select("id")
    .single();

  if (escolaError || !escola) {
    return json({ error: "escola_insert_failed", detail: escolaError?.message }, 400);
  }

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: body.admin_email,
    password: body.admin_password,
    email_confirm: true,
    user_metadata: { nome: body.admin_nome },
  });

  if (authError || !authUser?.user) {
    // Nothing was ever a live domain record here — this is transactional
    // rollback of a failed signup attempt, not a violation of the
    // append-only / no-hard-delete invariant that governs committed
    // domain history.
    await supabase.from("escolas").delete().eq("id", escola.id);
    return json({ error: "auth_user_create_failed", detail: authError?.message }, 400);
  }

  const { error: pessoaError } = await supabase.from("pessoas").insert({
    escola_id: escola.id,
    nome: body.admin_nome,
    cpf: body.admin_cpf ?? null,
    data_nascimento: body.admin_data_nascimento,
    papeis: ["admin"],
    auth_user_id: authUser.user.id,
  });

  if (pessoaError) {
    await supabase.auth.admin.deleteUser(authUser.user.id);
    await supabase.from("escolas").delete().eq("id", escola.id);
    return json({ error: "pessoa_insert_failed", detail: pessoaError.message }, 400);
  }

  return json({ escola_id: escola.id, admin_user_id: authUser.user.id }, 201);
});
