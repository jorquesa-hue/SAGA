"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

interface Matricula {
  id: string;
  alunos: { pessoas: { nome: string } | null } | null;
}
interface Contrato {
  id: string;
  valor_anuidade: string;
  num_parcelas: number;
  vencimento_dia: number;
  assinado_em: string | null;
  matriculas: { alunos: { pessoas: { nome: string } | null } | null } | null;
}
interface Parcela {
  id: string;
  competencia: string;
  vencimento: string;
  valor_bruto: string;
  valor_desconto: string;
  valor_liquido: string;
  status: string;
}

export default function FinanceiroPage() {
  const supabase = createClient();
  const [matriculas, setMatriculas] = useState<Matricula[]>([]);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [selectedContrato, setSelectedContrato] = useState<string | null>(null);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function loadContratos() {
    const { data } = await supabase
      .from("contratos")
      .select(
        "id, valor_anuidade, num_parcelas, vencimento_dia, assinado_em, matriculas(alunos(pessoas(nome)))",
      )
      .returns<Contrato[]>();
    setContratos(data ?? []);
  }

  async function loadMatriculas() {
    const { data } = await supabase
      .from("matriculas")
      .select("id, alunos(pessoas(nome))")
      .eq("status", "ativa")
      .returns<Matricula[]>();
    setMatriculas(data ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-mount, not a render loop
    loadContratos();
    loadMatriculas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadParcelas(contratoId: string) {
    setSelectedContrato(contratoId);
    const { data } = await supabase
      .from("parcelas")
      .select(
        "id, competencia, vencimento, valor_bruto, valor_desconto, valor_liquido, status",
      )
      .eq("contrato_id", contratoId)
      .order("competencia")
      .returns<Parcela[]>();
    setParcelas(data ?? []);
  }

  async function handleCreateContrato(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from("contratos").insert({
      matricula_id: fd.get("matricula_id"),
      valor_anuidade: Number(fd.get("valor_anuidade")),
      num_parcelas: Number(fd.get("num_parcelas")),
      vencimento_dia: Number(fd.get("vencimento_dia")),
    });
    if (error) setError(error.message);
    else {
      e.currentTarget.reset();
      loadContratos();
    }
  }

  async function handleAssinar(contratoId: string) {
    setError(null);
    const { error } = await supabase
      .from("contratos")
      .update({ assinado_em: new Date().toISOString() })
      .eq("id", contratoId);
    if (error) setError(error.message);
    else loadContratos();
  }

  async function handleGerarParcelas(contratoId: string) {
    setError(null);
    setInfo(null);
    const { error } = await supabase.rpc("fn_gerar_parcelas", {
      p_contrato_id: contratoId,
    });
    if (error) setError(error.message);
    else {
      setInfo("Parcelas geradas.");
      loadParcelas(contratoId);
    }
  }

  const brl = (v: string) =>
    Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">
        Financeiro — Contratos e parcelas
      </h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {info && <p className="text-sm text-green-700">{info}</p>}

      <form
        onSubmit={handleCreateContrato}
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <h3 className="mb-2 text-sm font-medium text-slate-900">Novo contrato</h3>
        <div className="flex flex-wrap gap-2">
          <select name="matricula_id" required className="input">
            <option value="">Matrícula (aluno)</option>
            {matriculas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.alunos?.pessoas?.nome}
              </option>
            ))}
          </select>
          <input
            name="valor_anuidade"
            type="number"
            step="0.01"
            placeholder="Valor anuidade"
            required
            className="input w-36"
          />
          <input
            name="num_parcelas"
            type="number"
            min={1}
            max={12}
            placeholder="Nº parcelas"
            required
            className="input w-28"
          />
          <input
            name="vencimento_dia"
            type="number"
            min={1}
            max={28}
            placeholder="Dia vencimento"
            required
            className="input w-32"
          />
          <button className="btn">Criar</button>
        </div>
      </form>

      <table className="w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="px-4 py-2 font-medium text-slate-600">Aluno</th>
            <th className="px-4 py-2 font-medium text-slate-600">Anuidade</th>
            <th className="px-4 py-2 font-medium text-slate-600">Parcelas</th>
            <th className="px-4 py-2 font-medium text-slate-600">Assinado</th>
            <th className="px-4 py-2 font-medium text-slate-600">Ações</th>
          </tr>
        </thead>
        <tbody>
          {contratos.map((c) => (
            <tr key={c.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2">{c.matriculas?.alunos?.pessoas?.nome}</td>
              <td className="px-4 py-2">{brl(c.valor_anuidade)}</td>
              <td className="px-4 py-2">{c.num_parcelas}x</td>
              <td className="px-4 py-2">
                {c.assinado_em
                  ? new Date(c.assinado_em).toLocaleDateString("pt-BR")
                  : "—"}
              </td>
              <td className="flex gap-2 px-4 py-2">
                {!c.assinado_em && (
                  <button
                    onClick={() => handleAssinar(c.id)}
                    className="text-xs underline"
                  >
                    Assinar
                  </button>
                )}
                {c.assinado_em && (
                  <button
                    onClick={() => handleGerarParcelas(c.id)}
                    className="text-xs underline"
                  >
                    Gerar parcelas
                  </button>
                )}
                <button onClick={() => loadParcelas(c.id)} className="text-xs underline">
                  Ver parcelas
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedContrato && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Parcelas</h2>
          <table className="w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-2 font-medium text-slate-600">Competência</th>
                <th className="px-4 py-2 font-medium text-slate-600">Vencimento</th>
                <th className="px-4 py-2 font-medium text-slate-600">Bruto</th>
                <th className="px-4 py-2 font-medium text-slate-600">Desconto</th>
                <th className="px-4 py-2 font-medium text-slate-600">Líquido</th>
                <th className="px-4 py-2 font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {parcelas.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">{p.competencia}</td>
                  <td className="px-4 py-2">{p.vencimento}</td>
                  <td className="px-4 py-2">{brl(p.valor_bruto)}</td>
                  <td className="px-4 py-2">{brl(p.valor_desconto)}</td>
                  <td className="px-4 py-2">{brl(p.valor_liquido)}</td>
                  <td className="px-4 py-2">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
