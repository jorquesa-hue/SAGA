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
interface Desconto {
  id: string;
  tipo: string;
  percentual: string | null;
  valor: string | null;
  vigencia: string;
}
interface Pagamento {
  id: string;
  valor: string;
  data: string;
  meio: string;
  parcela_id: string;
  parcelas: { contrato_id: string } | null;
  notas_fiscais: { id: string; status: string; numero: string | null }[];
}

export default function FinanceiroPage() {
  const supabase = createClient();
  const [matriculas, setMatriculas] = useState<Matricula[]>([]);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [selectedContrato, setSelectedContrato] = useState<string | null>(null);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [descontos, setDescontos] = useState<Desconto[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
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
    const [p, d, pg] = await Promise.all([
      supabase
        .from("parcelas")
        .select(
          "id, competencia, vencimento, valor_bruto, valor_desconto, valor_liquido, status",
        )
        .eq("contrato_id", contratoId)
        .order("competencia")
        .returns<Parcela[]>(),
      supabase
        .from("descontos")
        .select("id, tipo, percentual, valor, vigencia")
        .eq("contrato_id", contratoId)
        .returns<Desconto[]>(),
      supabase
        .from("pagamentos")
        .select(
          "id, valor, data, meio, parcela_id, parcelas!inner(contrato_id), notas_fiscais(id, status, numero)",
        )
        .eq("parcelas.contrato_id", contratoId)
        .returns<Pagamento[]>(),
    ]);
    setParcelas(p.data ?? []);
    setDescontos(d.data ?? []);
    setPagamentos(pg.data ?? []);
  }

  async function handleCreateDesconto(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedContrato) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const percentual = fd.get("percentual");
    const valor = fd.get("valor");
    const { error } = await supabase.from("descontos").insert({
      contrato_id: selectedContrato,
      tipo: fd.get("tipo"),
      percentual: percentual ? Number(percentual) : null,
      valor: valor ? Number(valor) : null,
      vigencia: `[${fd.get("vigencia_inicio")},${fd.get("vigencia_fim")})`,
    });
    if (error) setError(error.message);
    else {
      e.currentTarget.reset();
      loadParcelas(selectedContrato);
    }
  }

  async function handleRegistrarPagamento(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedContrato) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const parcelaId = fd.get("parcela_id") as string;

    const { error: pagamentoError } = await supabase.from("pagamentos").insert({
      parcela_id: parcelaId,
      valor: Number(fd.get("valor")),
      data: fd.get("data"),
      meio: fd.get("meio"),
    });
    if (pagamentoError) {
      setError(pagamentoError.message);
      return;
    }

    const { error: parcelaError } = await supabase
      .from("parcelas")
      .update({ status: "pago" })
      .eq("id", parcelaId);
    if (parcelaError) setError(parcelaError.message);
    else {
      e.currentTarget.reset();
      loadParcelas(selectedContrato);
    }
  }

  async function handleEmitirNota(pagamentoId: string) {
    if (!selectedContrato) return;
    setError(null);
    const { error } = await supabase
      .from("notas_fiscais")
      .insert({ pagamento_id: pagamentoId, status: "pendente" });
    if (error) setError(error.message);
    else loadParcelas(selectedContrato);
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
              {parcelas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    Nenhuma parcela gerada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {selectedContrato && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Descontos</h2>
          <form
            onSubmit={handleCreateDesconto}
            className="mb-3 rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <select name="tipo" required className="input">
                <option value="bolsa">Bolsa</option>
                <option value="irmao">Irmão</option>
                <option value="pontualidade">Pontualidade</option>
                <option value="convenio">Convênio</option>
              </select>
              <input
                name="percentual"
                type="number"
                step="0.01"
                min={0}
                max={100}
                placeholder="% (ou preencha valor)"
                className="input w-44"
              />
              <input
                name="valor"
                type="number"
                step="0.01"
                min={0}
                placeholder="Valor fixo (ou preencha %)"
                className="input w-44"
              />
              <label className="text-xs text-slate-500">
                Vigência
                <input
                  name="vigencia_inicio"
                  type="date"
                  required
                  className="input ml-1"
                />
              </label>
              <span className="text-xs text-slate-400">até</span>
              <input name="vigencia_fim" type="date" required className="input" />
              <button className="btn">Adicionar</button>
            </div>
          </form>
          <table className="w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-2 font-medium text-slate-600">Tipo</th>
                <th className="px-4 py-2 font-medium text-slate-600">Percentual</th>
                <th className="px-4 py-2 font-medium text-slate-600">Valor fixo</th>
                <th className="px-4 py-2 font-medium text-slate-600">Vigência</th>
              </tr>
            </thead>
            <tbody>
              {descontos.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">{d.tipo}</td>
                  <td className="px-4 py-2">{d.percentual ? `${d.percentual}%` : "—"}</td>
                  <td className="px-4 py-2">{d.valor ? brl(d.valor) : "—"}</td>
                  <td className="px-4 py-2">{d.vigencia}</td>
                </tr>
              ))}
              {descontos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    Nenhum desconto cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">
            &quot;Gerar parcelas&quot; aplica os descontos vigentes na data de cada
            parcela — cadastre o desconto antes de gerar, ou regenere as parcelas depois
            (fn_gerar_parcelas é reexecutável).
          </p>
        </section>
      )}

      {selectedContrato && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Pagamentos e notas fiscais
          </h2>
          <form
            onSubmit={handleRegistrarPagamento}
            className="mb-3 rounded-lg border border-slate-200 bg-white p-4"
          >
            <h3 className="mb-2 text-sm font-medium text-slate-900">
              Registrar pagamento (baixa manual)
            </h3>
            <div className="flex flex-wrap gap-2">
              <select name="parcela_id" required className="input">
                <option value="">Parcela</option>
                {parcelas
                  .filter((p) => p.status !== "pago" && p.status !== "cancelado")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.competencia} — {brl(p.valor_liquido)}
                    </option>
                  ))}
              </select>
              <input
                name="valor"
                type="number"
                step="0.01"
                placeholder="Valor pago"
                required
                className="input w-36"
              />
              <input name="data" type="date" required className="input" />
              <select name="meio" required className="input">
                <option value="boleto">Boleto</option>
                <option value="pix">Pix</option>
                <option value="cartao">Cartão</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="transferencia">Transferência</option>
              </select>
              <button className="btn">Registrar</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Para pagamentos via Asaas (boleto/Pix online), o webhook registra isso
              automaticamente — use este formulário só para pagamentos recebidos fora do
              Asaas (dinheiro, transferência, etc).
            </p>
          </form>

          <table className="w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-2 font-medium text-slate-600">Data</th>
                <th className="px-4 py-2 font-medium text-slate-600">Meio</th>
                <th className="px-4 py-2 font-medium text-slate-600">Valor</th>
                <th className="px-4 py-2 font-medium text-slate-600">Nota fiscal</th>
                <th className="px-4 py-2 font-medium text-slate-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pagamentos.map((pg) => (
                <tr key={pg.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">{pg.data}</td>
                  <td className="px-4 py-2">{pg.meio}</td>
                  <td className="px-4 py-2">{brl(pg.valor)}</td>
                  <td className="px-4 py-2">
                    {pg.notas_fiscais[0]
                      ? `${pg.notas_fiscais[0].status}${pg.notas_fiscais[0].numero ? ` (${pg.notas_fiscais[0].numero})` : ""}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {!pg.notas_fiscais[0] && (
                      <button
                        onClick={() => handleEmitirNota(pg.id)}
                        className="text-xs underline"
                      >
                        Emitir NF
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {pagamentos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    Nenhum pagamento registrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">
            &quot;Emitir NF&quot; apenas registra a nota como pendente — não há integração
            real com uma prefeitura/emissor de NFS-e nesta sessão (ver
            erp-escolar-br/README.md).
          </p>
        </section>
      )}
    </div>
  );
}
