// Consome a outbox emails_transacionais (Migração 0028) e envia via Resend.
//
// É a metade "worker" do padrão outbox: o banco enfileira dentro da mesma
// transação que emite a nota fiscal, e o envio — que depende de rede e de
// terceiro — acontece aqui, separado, podendo falhar e ser retentado sem
// nunca colocar em risco o documento fiscal.
//
// Batch de plataforma, não requisição de usuário: roda para todas as
// escolas, então usa service_role e é autorizada por token compartilhado,
// igual às réguas de cobrança. A intenção é ser chamada por um agendador
// (o mesmo cenário do Make que já dispara as réguas) a cada poucos
// minutos.
//
// STUB consciente: sem RESEND_API_KEY definida, devolve 501
// email_not_configured e NÃO marca nada como enviado. Esse é o estado
// atual desta conta. O padrão deste repositório é falhar alto em vez de
// fingir sucesso — um recibo que a família não recebeu, mas que o sistema
// diz ter enviado, é pior que um erro visível.
//
// Vale repetir o que a 0028 documenta: hoje a fila fica vazia de qualquer
// forma, porque sem provedor de NFS-e a nota nunca chega em 'emitida'.
// Configurar só o Resend não faz recibo nenhum sair.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Teto por chamada: mantém a execução dentro do tempo da Edge Function e
// evita esvaziar uma fila enorme de uma vez se algo represou.
const LOTE = 50;

// Depois disso a linha para de ser tentada. Sem isto, um endereço que não
// existe seria retentado para sempre, a cada execução do agendador.
const MAX_TENTATIVAS = 5;

interface EmailPendente {
  id: string;
  escola_id: string;
  destinatario_email: string;
  assunto: string;
  corpo: string;
  tentativas: number;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expectedToken = Deno.env.get("REGUAS_API_TOKEN");
  if (!expectedToken) return json({ error: "reguas_not_configured" }, 501);
  if (req.headers.get("Authorization") !== `Bearer ${expectedToken}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const remetente = Deno.env.get("EMAIL_REMETENTE");
  if (!resendKey || !remetente) {
    return json(
      {
        error: "email_not_configured",
        detail:
          "Defina RESEND_API_KEY e EMAIL_REMETENTE nos secrets do projeto. " +
          "EMAIL_REMETENTE precisa usar um domínio verificado no Resend.",
      },
      501,
    );
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pendentes, error: selectError } = await admin
    .from("emails_transacionais")
    .select("id, escola_id, destinatario_email, assunto, corpo, tentativas")
    .eq("status", "pendente")
    .not("destinatario_email", "is", null)
    .lt("tentativas", MAX_TENTATIVAS)
    .order("created_at", { ascending: true })
    .limit(LOTE)
    .returns<EmailPendente[]>();

  if (selectError) return json({ error: selectError.message }, 500);
  if (!pendentes || pendentes.length === 0) {
    return json({ enviados: 0, erros: 0, detail: "fila vazia" });
  }

  let enviados = 0;
  let erros = 0;

  for (const email of pendentes) {
    // A tentativa é contada ANTES da chamada. Se a função morrer no meio
    // (timeout, deploy), a linha não fica presa sendo retentada sem fim —
    // o contador já subiu e MAX_TENTATIVAS acaba encerrando.
    await admin
      .from("emails_transacionais")
      .update({ tentativas: email.tentativas + 1 })
      .eq("id", email.id);

    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: remetente,
        to: [email.destinatario_email],
        subject: email.assunto,
        text: email.corpo,
      }),
    }).catch((err: Error) => ({
      ok: false,
      status: 0,
      text: () => Promise.resolve(err.message),
      json: () => Promise.resolve({}),
    }));

    if (!resposta.ok) {
      const detalhe = await resposta.text();
      erros += 1;
      // Só vira 'erro' terminal quando as tentativas acabaram; antes disso
      // continua 'pendente' para a próxima rodada do agendador.
      const esgotou = email.tentativas + 1 >= MAX_TENTATIVAS;
      await admin
        .from("emails_transacionais")
        .update({
          status: esgotou ? "erro" : "pendente",
          erro_detalhe: detalhe.slice(0, 2000),
          provedor: "resend",
        })
        .eq("id", email.id);
      continue;
    }

    const dados: { id?: string } = await resposta.json().catch(() => ({}));
    enviados += 1;
    await admin
      .from("emails_transacionais")
      .update({
        status: "enviado",
        enviado_em: new Date().toISOString(),
        provedor: "resend",
        referencia_externa: dados.id ?? null,
        erro_detalhe: null,
      })
      .eq("id", email.id);
  }

  return json({ enviados, erros, processados: pendentes.length });
});
