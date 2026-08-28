// Milestone 5: Asaas webhook receiver (spec §5 — PAYMENT_RECEIVED,
// PAYMENT_OVERDUE, PAYMENT_REFUNDED). Runs with service_role since Asaas
// is an external caller with no Supabase session — authorization here is
// the shared webhook token, not a user JWT (verify_jwt is disabled for
// this function; see deployment notes in erp-escolar-br/README.md).
//
// STUBBED: this account has no real Asaas integration configured yet.
// ASAAS_WEBHOOK_TOKEN is unset, so every call is rejected with
// webhook_not_configured until an operator sets it (Supabase project
// secrets) to match the token configured in the Asaas dashboard.
//
// Idempotency (spec CLAUDE.md invariant 5 — "messaging is at-least-once"):
// Asaas retries deliveries, so every write here is keyed on
// asaas_pagamento_id / asaas_cobranca_id and re-checks current state
// before writing, making repeat deliveries of the same event a no-op.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface AsaasPayment {
  id: string;
  value: number;
  paymentDate?: string;
  billingType?: string;
}

interface AsaasWebhookEvent {
  event: "PAYMENT_RECEIVED" | "PAYMENT_OVERDUE" | "PAYMENT_REFUNDED" | string;
  payment: AsaasPayment;
}

const MEIO_BY_BILLING_TYPE: Record<string, string> = {
  BOLETO: "boleto",
  PIX: "pix",
  CREDIT_CARD: "cartao",
  UNDEFINED: "transferencia",
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  if (!expectedToken) {
    return json({ error: "webhook_not_configured" }, 501);
  }

  const receivedToken = req.headers.get("asaas-access-token");
  if (receivedToken !== expectedToken) {
    return json({ error: "invalid_token" }, 401);
  }

  let event: AsaasWebhookEvent;
  try {
    event = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: parcela, error: parcelaError } = await admin
    .from("parcelas")
    .select("id, status")
    .eq("asaas_cobranca_id", event.payment.id)
    .maybeSingle();

  if (parcelaError || !parcela) {
    // Not necessarily an error worth alarming on: could be a cobranca
    // Asaas knows about that this system never created (e.g. manual
    // dashboard action). Acknowledge so Asaas stops retrying.
    return json({ received: true, matched: false }, 200);
  }

  if (event.event === "PAYMENT_RECEIVED") {
    if (parcela.status === "pago") {
      return json({ received: true, already_processed: true }, 200);
    }

    const { data: existingPagamento } = await admin
      .from("pagamentos")
      .select("id")
      .eq("asaas_pagamento_id", event.payment.id)
      .maybeSingle();

    if (!existingPagamento) {
      const meio = MEIO_BY_BILLING_TYPE[event.payment.billingType ?? ""] ?? "transferencia";
      await admin.from("pagamentos").insert({
        parcela_id: parcela.id,
        valor: event.payment.value,
        data: event.payment.paymentDate ?? new Date().toISOString().slice(0, 10),
        meio,
        asaas_pagamento_id: event.payment.id,
      });
    }

    await admin.from("parcelas").update({ status: "pago" }).eq("id", parcela.id);
  } else if (event.event === "PAYMENT_OVERDUE") {
    if (parcela.status === "pendente") {
      await admin.from("parcelas").update({ status: "atrasado" }).eq("id", parcela.id);
    }
  } else if (event.event === "PAYMENT_REFUNDED") {
    await admin.from("parcelas").update({ status: "cancelado" }).eq("id", parcela.id);
  }

  return json({ received: true, matched: true }, 200);
});
