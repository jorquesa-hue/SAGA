import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Only route handler in this app (everything else is direct-from-client
// Supabase per the spec's own architecture) because consentimentos_lgpd.ip
// is a required column that a browser cannot supply honestly — it has to
// come from the request itself. Runs as the caller's own session (RLS
// still applies: consentimentos_lgpd_insert requires either staff or
// responsavel_pessoa_id = the caller), not service_role.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.titular_pessoa_id || !body?.finalidade || !body?.versao_termo) {
    return NextResponse.json({ error: "missing_field" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: pessoa } = await supabase
    .from("pessoas")
    .select("id, escola_id")
    .eq("auth_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pessoa) return NextResponse.json({ error: "pessoa_not_found" }, { status: 404 });

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "127.0.0.1";

  const { error } = await supabase.from("consentimentos_lgpd").insert({
    escola_id: pessoa.escola_id,
    titular_pessoa_id: body.titular_pessoa_id,
    responsavel_pessoa_id: pessoa.id,
    finalidade: body.finalidade,
    versao_termo: body.versao_termo,
    ip,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
