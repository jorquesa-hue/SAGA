"use client";

import { useState } from "react";
import { TurmasTab, UnidadesTab } from "@/features/cadastros";

type Secao = "turmas" | "unidades";

export default function EscolaPage() {
  const [secao, setSecao] = useState<Secao>("turmas");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h-page">Escola</h1>
        <p className="subtle mt-1">
          A estrutura em que o aluno é colocado: as unidades (cada uma com seu CNPJ) e as
          turmas de cada ano letivo.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-ink-200">
        {(
          [
            ["turmas", "Turmas"],
            ["unidades", "Unidades"],
          ] as [Secao, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSecao(key)}
            aria-current={secao === key ? "true" : undefined}
            className={`px-3 py-2 text-sm ${
              secao === key
                ? "border-b-2 border-brand-600 font-medium text-brand-700"
                : "text-ink-500 hover:text-ink-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {secao === "turmas" ? <TurmasTab /> : <UnidadesTab />}
    </div>
  );
}
