"use client";

import { useState, type FormEvent } from "react";

const VERSAO_TERMO_ATUAL = "2026-08-v1";

interface Aluno {
  aluno_id: string;
  pessoa_id: string;
  nome: string;
  jaConsentiu: boolean;
}

export default function ConsentimentoForm({ alunos }: { alunos: Aluno[] }) {
  const [done, setDone] = useState<Set<string>>(
    new Set(alunos.filter((a) => a.jaConsentiu).map((a) => a.pessoa_id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>, pessoaId: string) {
    e.preventDefault();
    setError(null);
    setLoading(pessoaId);
    const fd = new FormData(e.currentTarget);

    const res = await fetch("/api/consentimento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titular_pessoa_id: pessoaId,
        finalidade: fd.get("finalidade"),
        versao_termo: VERSAO_TERMO_ATUAL,
      }),
    });
    const data = await res.json();
    setLoading(null);

    if (!res.ok) {
      setError(data.error ?? "Falha ao registrar consentimento.");
      return;
    }
    setDone((prev) => new Set(prev).add(pessoaId));
  }

  if (alunos.length === 0) {
    return (
      <p className="text-sm text-slate-500">Nenhum aluno vinculado à sua conta ainda.</p>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {alunos.map((a) => (
        <div
          key={a.aluno_id}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
        >
          <span className="text-sm text-slate-900">{a.nome}</span>
          {done.has(a.pessoa_id) ? (
            <span className="text-xs text-green-700">
              Consentimento registrado ({VERSAO_TERMO_ATUAL})
            </span>
          ) : (
            <form
              onSubmit={(e) => handleSubmit(e, a.pessoa_id)}
              className="flex items-center gap-2"
            >
              <input
                type="hidden"
                name="finalidade"
                value="Tratamento de dados pessoais do aluno para fins pedagógicos, financeiros e de comunicação da escola (LGPD, base legal: melhor interesse da criança)."
              />
              <button type="submit" disabled={loading === a.pessoa_id} className="btn">
                {loading === a.pessoa_id ? "Registrando..." : "Registrar consentimento"}
              </button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
