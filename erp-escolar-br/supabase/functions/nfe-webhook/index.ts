// Async status webhook for whatever NFS-e provider is plugged into
// emitir-nota-fiscal (NFE_PROVIDER_API_URL) — most eNF issuance is async
// (a município's system can take minutes/hours to confirm), so the
// provider is expected to call back here rather than emitir-nota-fiscal
// blocking on it. Runs with service_role since the provider is an
// external caller with no Supabase session — authorization here is the
// shared webhook token, not a user JWT (verify_jwt is disabled for this
// function, same pattern as asaas-webhook).
//
// Idempotency (spec CLAUDE.md invariant 5 — "messaging is at-least-once"):
// every write here is keyed on referencia_externa (unique index from
// Migration 0014) and re-checks current status before writing, making
// repeat deliveries of the same event a no-op — same pattern as
// asaas-webhook's asaas_pagamento_id keying.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface NfeWebhookEvent {
  referencia: string;
  status: "emitida" | "cancelada" | "erro" | string;
  numero?: string;
  xml_url?: string;
  erro_detalhe?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expectedToken = Deno.env.get("NFE_WEBHOOK_TOKEN");
  if (!expectedToken) {
    return json({ error: "webhook_not_configured" }, 501);
  }

  const receivedToken = req.headers.get("nfe-access-token");
  if (receivedToken !== expectedToken) {
    return json({ error: "invalid_token" }, 401);
  }

  let event: NfeWebhookEvent;
  try {
    event = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!event.referencia) {
    return json({ error: "missing_field", field: "referencia" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: notaFiscal, error: notaFiscalError } = await admin
    .from("notas_fiscais")
    .select("id, status")
    .eq("referencia_externa", event.referencia)
    .maybeSingle();

  if (notaFiscalError || !notaFiscal) {
    // Not necessarily an error worth alarming on: could be a referência
    // the provider knows about that this system never created. Acknowledge
    // so the provider stops retrying.
    return json({ received: true, matched: false }, 200);
  }

  if (notaFiscal.status === event.status) {
    return json({ received: true, already_processed: true }, 200);
  }

  const update: Record<string, unknown> = { status: event.status };
  if (event.numero) update.numero = event.numero;
  if (event.xml_url) update.xml_url = event.xml_url;
  if (event.erro_detalhe) update.erro_detalhe = event.erro_detalhe;
  if (event.status === "emitida") update.emitida_em = new Date().toISOString();

  await admin.from("notas_fiscais").update(update).eq("id", notaFiscal.id);

  return json({ received: true, matched: true }, 200);
});
