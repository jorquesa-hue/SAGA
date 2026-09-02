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
  valor_em_aberto: string;
  valor_vencido: string;
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
    // Auditoria (01/09/2026, D6): um período invertido (De > Até) não dava
    // erro nenhum — só voltava vazio, como se não houvesse dados no período,
    // e nada na tela dizia que o filtro em si era inválido.
    if (dataInicio > dataFim) {
      setError('O período é inválido: "De" não pode ser depois de "Até".');
      return;
    }
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
      emAberto: acc.emAberto + Number(l.valor_em_aberto),
      vencido: acc.vencido + Number(l.valor_vencido),
      pendentes: acc.pendentes + l.qtd_pendentes,
      atrasadas: acc.atrasadas + l.qtd_atrasadas,
    }),
    {
      bruto: 0,
      desconto: 0,
      liquido: 0,
      recebido: 0,
      emAberto: 0,
      vencido: 0,
      pendentes: 0,
      atrasadas: 0,
    },
  );

  // Auditoria (01/09/2026, D4): o CSV era gerado sem BOM e com ponto decimal.
  // Sem BOM, o Excel (o programa que a secretaria realmente usa) detecta o
  // arquivo como Latin-1 e corrompe todo acento ("São Paulo" vira "SÃ£o
  // Paulo"); e como o Excel em locale pt-BR trata "," como separador decimal,
  // um número como "1234.56" com ponto é lido como texto (ou como "123456"
  // se o separador de coluna também for ","). Corrigido com BOM UTF-8,
  // separador ";" (o padrão do Excel pt-BR) e decimais com vírgula.
  function formatarDecimalBr(v: string) {
    return Number(v).toFixed(2).replace(".", ",");
  }

  function handleExportarCsv() {
    const header = [
      "unidade",
      "cnpj",
      "competencia",
      "valor_bruto",
      "valor_desconto",
      "valor_liquido",
      "valor_recebido",
      "valor_em_aberto",
      "valor_vencido",
      "qtd_parcelas",
      "qtd_pendentes",
      "qtd_atrasadas",
    ];
    const rows = linhas.map((l) => [
      l.unidade_nome,
      l.unidade_cnpj,
      l.competencia,
      formatarDecimalBr(l.valor_bruto),
      formatarDecimalBr(l.valor_desconto),
      formatarDecimalBr(l.valor_liquido),
      formatarDecimalBr(l.valor_recebido),
      formatarDecimalBr(l.valor_em_aberto),
      formatarDecimalBr(l.valor_vencido),
      l.qtd_parcelas,
      l.qtd_pendentes,
      l.qtd_atrasadas,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"),
      )
      .join("\r\n");
    const BOM = "﻿";
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-financeiro-${dataInicio}-a-${dataFim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <h1 className="h-page">Financeiro — Relatórios</h1>
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Receita bruta" value={brl(String(totais.bruto))} />
        <Stat label="Descontos" value={brl(String(totais.desconto))} />
        <Stat label="Receita líquida" value={brl(String(totais.liquido))} />
        <Stat label="Recebido" value={brl(String(totais.recebido))} />
        <Stat label="Em aberto" value={brl(String(totais.emAberto))} />
        <Stat label="Vencido" value={brl(String(totais.vencido))} />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Unidade</th>
              <th>CNPJ</th>
              <th>Competência</th>
              <th>Bruto</th>
              <th>Desconto</th>
              <th>Líquido</th>
              <th>Recebido</th>
              <th>Pendentes</th>
              <th>Atrasadas</th>
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
    <div className="stat-card">
      <p className="subtle">{label}</p>
      <p className="text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
    </div>
  );
}
