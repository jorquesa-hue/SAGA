"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

// Chama fn_atualizar_meu_email (0031) em vez de um UPDATE direto em
// pessoas. O motivo está na migração: RLS autoriza linhas, não colunas, e
// `authenticated` tem UPDATE na tabela inteira — uma política de linha
// própria deixaria a mesma requisição reescrever `papeis`.
export default function EmailForm({ emailAtual }: { emailAtual: string | null }) {
  const [email, setEmail] = useState(emailAtual ?? "");
  const [estado, setEstado] = useState<"parado" | "salvando" | "salvo">("parado");
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setEstado("salvando");
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_atualizar_meu_email", { p_email: email });
    if (error) {
      setEstado("parado");
      // pessoas_email_formato (0027) é quem recusa endereço malformado —
      // a checagem mora na tabela para valer também para a secretaria.
      setErro(
        error.message.includes("pessoas_email_formato")
          ? "Esse endereço não parece válido."
          : "Não foi possível salvar.",
      );
      return;
    }
    setEstado("salvo");
  }

  return (
    <form onSubmit={salvar} className="card flex flex-wrap items-end gap-3 p-4">
      <label className="field flex-1">
        <span>E-mail para receber recibos e avisos</span>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setEstado("parado");
          }}
          placeholder="seu@email.com"
          className="input w-full"
        />
      </label>
      <button className="btn" disabled={estado === "salvando"}>
        {estado === "salvando" ? "Salvando..." : "Salvar"}
      </button>
      {erro && <p className="w-full text-sm text-red-600">{erro}</p>}
      {estado === "salvo" && !erro && (
        <p className="w-full text-xs text-green-700">E-mail atualizado.</p>
      )}
    </form>
  );
}
