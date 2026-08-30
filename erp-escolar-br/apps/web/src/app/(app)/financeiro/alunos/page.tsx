"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Situacao {
  aluno_id: string;
  aluno_nome: string;
  matricula_codigo: string;
  aluno_status: string;
  turma_nome: string | null;
  unidade_nome: string | null;
  unidade_cnpj: string | null;
  responsavel_financeiro: string | null;
  parcelas_abertas: number;
  parcelas_atrasadas: number;
  valor_aberto: string;
  valor_atrasado: string;
  competencia_mais_antiga_aberta: string | null;
  proximo_vencimento: string | null;
}

const brl = (v: string | number) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const mesAno = (d: string | null) =>
  d ? d.slice(0, 7).split("-").reverse().join("/") : "—";

const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export default function BuscarAlunosPage() {
  const supabase = createClient();
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Situacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (termo: string) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.rpc("fn_buscar_alunos", {
        p_busca: termo,
      });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      setLinhas((data ?? []) as Situacao[]);
    },
    [supabase],
  );

  // Debounced search-as-you-type; also does the initial load with "".
  useEffect(() => {
    const t = setTimeout(() => load(busca.trim()), busca ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  const totalAberto = linhas.reduce((s, l) => s + Number(l.valor_aberto), 0);
  const comAtraso = linhas.filter((l) => l.parcelas_atrasadas > 0).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h-page">Buscar aluno</h1>
        <p className="subtle mt-1">
          Digite o nome ou o código de matrícula para ver a situação financeira.
        </p>
      </div>

      <label className="field">
        <span className="sr-only">Buscar por nome ou matrícula</span>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Ex.: Lucas, Almeida ou 2026-0001"
          autoComplete="off"
          className="input"
        />
      </label>

      {error && (
        <p role="alert" className="alert alert-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Alunos" value={String(linhas.length)} />
        <Stat
          label="Com atraso"
          value={String(comAtraso)}
          tone={comAtraso ? "danger" : "ok"}
        />
        <Stat label="Em aberto" value={brl(totalAberto)} />
      </div>

      {loading && <p className="subtle">Carregando...</p>}

      {!loading && linhas.length === 0 && (
        <p className="card p-6 text-center text-sm text-ink-500">
          {busca
            ? `Nenhum aluno encontrado para “${busca}”.`
            : "Nenhum aluno cadastrado ainda."}
        </p>
      )}

      <ul className="space-y-3">
        {linhas.map((l) => (
          <li key={l.aluno_id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="h-card truncate">{l.aluno_nome}</p>
                <p className="subtle truncate">
                  {l.matricula_codigo}
                  {l.turma_nome ? ` · ${l.turma_nome}` : " · sem turma"}
                </p>
              </div>
              <SituacaoBadge l={l} />
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <Campo rotulo="Em aberto" valor={brl(l.valor_aberto)} />
              <Campo
                rotulo="Atrasado"
                valor={brl(l.valor_atrasado)}
                destaque={Number(l.valor_atrasado) > 0}
              />
              <Campo
                rotulo="Mais antiga"
                valor={mesAno(l.competencia_mais_antiga_aberta)}
              />
              <Campo rotulo="Próx. vencimento" valor={dataBr(l.proximo_vencimento)} />
            </dl>

            <p className="subtle mt-3 border-t border-ink-100 pt-2">
              {l.unidade_nome ? (
                <>
                  {l.unidade_nome}
                  {l.unidade_cnpj ? ` · CNPJ ${l.unidade_cnpj}` : ""}
                </>
              ) : (
                "Sem unidade"
              )}
              {l.responsavel_financeiro
                ? ` · Responsável financeiro: ${l.responsavel_financeiro}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SituacaoBadge({ l }: { l: Situacao }) {
  if (l.parcelas_atrasadas > 0) {
    return (
      <span className="badge badge-danger">
        {l.parcelas_atrasadas} atrasada{l.parcelas_atrasadas > 1 ? "s" : ""}
      </span>
    );
  }
  if (l.parcelas_abertas > 0) {
    return <span className="badge badge-warn">{l.parcelas_abertas} em aberto</span>;
  }
  return <span className="badge badge-ok">Em dia</span>;
}

function Campo({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div>
      <dt className="text-[0.7rem] tracking-wide text-ink-500 uppercase">{rotulo}</dt>
      <dd className={`font-medium ${destaque ? "text-danger-600" : "text-ink-800"}`}>
        {valor}
      </dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "danger";
}) {
  return (
    <div className="card p-3">
      <p className="text-[0.7rem] tracking-wide text-ink-500 uppercase">{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold ${
          tone === "danger"
            ? "text-danger-600"
            : tone === "ok"
              ? "text-ok-600"
              : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
