import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Segunda (e última) rota deste app, pelo mesmo motivo da de consentimento:
// o IP e o user-agent do ato têm de vir da REQUISIÇÃO, e o navegador não
// tem como informá-los honestamente sobre si mesmo.
//
// O que NÃO passa por aqui é o conteúdo assinado. O texto do contrato e o
// seu SHA-256 são produzidos dentro de fn_assinar_contrato (0031), no
// servidor, no instante da gravação. Se viessem daqui — ou pior, do
// navegador — um POST forjado assinaria um contrato com outro valor de
// anuidade, e o dossiê de prova provaria exatamente a coisa errada.
//
// Roda com a sessão de quem chamou, não com service_role: quem autoriza é
// a própria função, conferindo que o chamador é o responsável financeiro
// daquele aluno.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.contrato_id) {
    return NextResponse.json({ error: "missing_field" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Atrás da Vercel o IP do cliente é o PRIMEIRO da lista: a plataforma
  // acrescenta os seus próprios saltos à direita. Sem proxy na frente
  // (dev local) o cabeçalho não existe, e 127.0.0.1 é a verdade.
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "127.0.0.1";

  const { data, error } = await supabase.rpc("fn_assinar_contrato", {
    p_contrato_id: body.contrato_id,
    p_ip: ip,
    p_user_agent: request.headers.get("user-agent"),
  });

  if (error) {
    // As mensagens vêm do banco como códigos estáveis (0031), não como
    // texto para a tela: a tradução para o que a família lê é feita no
    // componente, junto do resto da interface.
    const status = error.message.includes("contrato_ja_assinado")
      ? 409
      : error.message.includes("contrato_nao_encontrado")
        ? 403
        : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true, assinatura_id: data });
}
