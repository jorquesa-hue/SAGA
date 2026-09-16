"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ComunicadoPortal {
  id: string;
  titulo: string;
  corpo: string;
  publico_alvo: string;
  enviado_em: string | null;
  turma_nome: string | null;
  lido: boolean;
}

// A confirmação vai direto ao PostgREST (não há route handler aqui) porque
// não existe nada na requisição que precise ser capturado: quem confirma é
// fn_current_pessoa_id(), e de qual comunicado é decidido pela própria RLS
// (0030). Um POST forjado não alcança comunicado que a pessoa não enxerga.
export default function ComunicadosFeed({
  comunicados,
  pessoaId,
  escolaId,
}: {
  comunicados: ComunicadoPortal[];
  pessoaId: string;
  escolaId: string;
}) {
  const [lidos, setLidos] = useState<Set<string>>(
    new Set(comunicados.filter((c) => c.lido).map((c) => c.id)),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  async function confirmar(id: string) {
    setErro(null);
    setEnviando(id);
    const supabase = createClient();
    const { error } = await supabase
      .from("comunicados_leituras")
      .insert({ escola_id: escolaId, comunicado_id: id, pessoa_id: pessoaId });
    setEnviando(null);
    if (error) {
      setErro("Não foi possível confirmar a leitura. Tente de novo.");
      return;
    }
    setLidos((prev) => new Set(prev).add(id));
  }

  if (comunicados.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum comunicado no momento.</p>;
  }

  const naoLidos = comunicados.filter((c) => !lidos.has(c.id)).length;

  return (
    <div className="space-y-3">
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      {naoLidos > 0 && (
        <p className="text-xs text-slate-500">
          {naoLidos === 1
            ? "1 comunicado ainda não confirmado."
            : `${naoLidos} comunicados ainda não confirmados.`}
        </p>
      )}
      {comunicados.map((c) => (
        <article key={c.id} className="card p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{c.titulo}</h3>
            <span className="text-xs text-slate-400">
              {c.enviado_em ? new Date(c.enviado_em).toLocaleDateString("pt-BR") : null}
              {c.turma_nome ? ` · ${c.turma_nome}` : null}
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap text-slate-700">{c.corpo}</p>
          <div className="mt-3">
            {lidos.has(c.id) ? (
              <span className="badge badge-ok">Leitura confirmada</span>
            ) : (
              <button
                type="button"
                onClick={() => confirmar(c.id)}
                disabled={enviando === c.id}
                className="btn-secondary"
              >
                {enviando === c.id ? "Confirmando..." : "Confirmar leitura"}
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
