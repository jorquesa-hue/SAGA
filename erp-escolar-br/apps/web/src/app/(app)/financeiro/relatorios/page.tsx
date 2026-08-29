"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

interface LinhaRelatorio {
  unidade_id: string;
  unidade_nome: string;
  unidade_cnpj: string;
  competencia: string;
  valor_bruto: string;
  valor_desconto: string;
  valor_liquido: string;
  valor_recebido: string;
  qtd_parcelas: number;
  qtd_pendentes: number;
  qtd_atrasadas: number;
}

function primeiroDiaDoAno() {
  return `${new Date().getFullYear()}-01-01`;
}
function hoje() {
  return new Date().toISOString().slice(0, 10);
}

export default function RelatoriosPage() {
  const supabase = createClient();
  const [linhas, setLinhas] = useState<LinhaRelatorio[]>([]);
  const [dataInicio, setDataInicio] = useState(primeiroDiaDoAno());
  const [dataFim, setDataFim] = useState(hoje());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(inicio: string, fim: string) {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("fn_relatorio_financeiro", {
      p_data_inicio: inicio,
      p_data_fim: fim,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setLinhas((data ?? []) as LinhaRelatorio[]);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-mount, not a render loop
    load(dataInicio, dataFim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    load(dataInicio, dataFim);
  }

  const brl = (v: string) =>
    Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const totais = linhas.reduce(
    (acc, l) => ({
      bruto: acc.bruto + Number(l.valor_bruto),
      desconto: acc.desconto + Number(l.valor_desconto),
      liquido: acc.liquido + Number(l.valor_liquido),
      recebido: acc.recebido + Number(l.valor_recebido),
      pendentes: acc.pendentes + l.qtd_pendentes,
      atrasadas: acc.atrasadas + l.qtd_atrasadas,
    }),
    { bruto: 0, desconto: 0, liquido: 0, recebido: 0, pendentes: 0, atrasadas: 0 },
  );

  function handleExportarCsv() {
    const header = [
      "unidade",
      "cnpj",
      "competencia",
      "valor_bruto",
      "valor_desconto",
      "valor_liquido",
      "valor_recebido",
      "qtd_parcelas",
      "qtd_pendentes",
      "qtd_atrasadas",
    ];
    const rows = linhas.map((l) => [
      l.unidade_nome,
      l.unidade_cnpj,
      l.competencia,
      l.valor_bruto,
      l.valor_desconto,
      l.valor_liquido,
      l.valor_recebido,
      l.qtd_parcelas,
      l.qtd_pendentes,
      l.qtd_atrasadas,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-financeiro-${dataInicio}-a-${dataFim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Financeiro — Relatórios</h1>
      <p className="text-sm text-slate-500">
        Receita bruta/líquida, descontos, recebido e inadimplência por unidade (CNPJ) e
        competência. Também acessível via RPC{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
          fn_relatorio_financeiro
        </code>{" "}
        pela API REST do Supabase para integração com ferramentas de BI externas.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <form
        onSubmit={handleFilter}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="text-sm text-slate-700">
          De
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="input ml-2"
          />
        </label>
        <label className="text-sm text-slate-700">
          Até
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="input ml-2"
          />
        </label>
        <button type="submit" disabled={loading} className="btn">
          {loading ? "Carregando..." : "Filtrar"}
        </button>
        <button
          type="button"
          onClick={handleExportarCsv}
          disabled={linhas.length === 0}
          className="btn"
        >
          Exportar CSV
        </button>
      </form>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Receita bruta" value={brl(String(totais.bruto))} />
        <Stat label="Descontos" value={brl(String(totais.desconto))} />
        <Stat label="Receita líquida" value={brl(String(totais.liquido))} />
        <Stat label="Recebido" value={brl(String(totais.recebido))} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-4 py-2 font-medium text-slate-600">Unidade</th>
              <th className="px-4 py-2 font-medium text-slate-600">CNPJ</th>
              <th className="px-4 py-2 font-medium text-slate-600">Competência</th>
              <th className="px-4 py-2 font-medium text-slate-600">Bruto</th>
              <th className="px-4 py-2 font-medium text-slate-600">Desconto</th>
              <th className="px-4 py-2 font-medium text-slate-600">Líquido</th>
              <th className="px-4 py-2 font-medium text-slate-600">Recebido</th>
              <th className="px-4 py-2 font-medium text-slate-600">Pendentes</th>
              <th className="px-4 py-2 font-medium text-slate-600">Atrasadas</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr
                key={`${l.unidade_id}-${l.competencia}`}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-4 py-2">{l.unidade_nome}</td>
                <td className="px-4 py-2">{l.unidade_cnpj}</td>
                <td className="px-4 py-2">{l.competencia}</td>
                <td className="px-4 py-2">{brl(l.valor_bruto)}</td>
                <td className="px-4 py-2">{brl(l.valor_desconto)}</td>
                <td className="px-4 py-2">{brl(l.valor_liquido)}</td>
                <td className="px-4 py-2">{brl(l.valor_recebido)}</td>
                <td className="px-4 py-2">{l.qtd_pendentes}</td>
                <td className="px-4 py-2">{l.qtd_atrasadas}</td>
              </tr>
            ))}
            {linhas.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                  Nenhuma parcela no período selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
