"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
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
  matriculas: {
    alunos: { pessoas: { nome: string } | null } | null;
    turmas: { unidades: { nome: string; cnpj: string } | null } | null;
  } | null;
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

const ABERTA = ["pendente", "atrasado"];

const brl = (v: string | number) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mesAno = (d: string) => d.slice(0, 7).split("-").reverse().join("/");
const dataBr = (d: string) => d.split("-").reverse().join("/");

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
  const [editingPagamentoId, setEditingPagamentoId] = useState<string | null>(null);

  async function loadContratos() {
    const { data } = await supabase
      .from("contratos")
      .select(
        "id, valor_anuidade, num_parcelas, vencimento_dia, assinado_em, matriculas(alunos(pessoas(nome)), turmas(unidades(nome, cnpj)))",
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

  // Only the oldest open parcela may be settled — mirrors the database
  // trigger (0019). Showing the whole list and letting the server reject
  // the choice would be a worse experience than not offering it.
  const abertas = parcelas
    .filter((p) => ABERTA.includes(p.status))
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
  const proximaPagavel = abertas[0] ?? null;
  const bloqueadas = abertas.slice(1);

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
    if (!selectedContrato || !proximaPagavel) return;
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;

    const { error: pagamentoError } = await supabase.from("pagamentos").insert({
      parcela_id: proximaPagavel.id,
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
      .eq("id", proximaPagavel.id);
    if (parcelaError) setError(parcelaError.message);
    else {
      form.reset();
      setInfo(
        `Pagamento da competência ${mesAno(proximaPagavel.competencia)} registrado.`,
      );
      loadParcelas(selectedContrato);
    }
  }

  async function handleEmitirNota(pagamentoId: string) {
    if (!selectedContrato) return;
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke(
      "emitir-nota-fiscal",
      { body: { pagamento_id: pagamentoId } },
    );
    if (fnError || data?.error)
      setError(data?.error ?? fnError?.message ?? "Falha ao emitir NF.");
    else loadParcelas(selectedContrato);
  }

  // Corrects a mistaken entry (valor/data/meio digitado errado) after the
  // fact. Never exposed once a nota fiscal already references the payment,
  // and there is no delete action to go with it — both match the RLS grant
  // on pagamentos, which allows staff update but not delete.
  async function handleUpdatePagamento(
    e: FormEvent<HTMLFormElement>,
    pagamentoId: string,
  ) {
    e.preventDefault();
    if (!selectedContrato) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase
      .from("pagamentos")
      .update({
        valor: Number(fd.get("valor")),
        data: fd.get("data"),
        meio: fd.get("meio"),
      })
      .eq("id", pagamentoId);
    if (error) setError(error.message);
    else {
      setEditingPagamentoId(null);
      loadParcelas(selectedContrato);
    }
  }

  async function handleCreateContrato(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    const { error } = await supabase.from("contratos").insert({
      matricula_id: fd.get("matricula_id"),
      valor_anuidade: Number(fd.get("valor_anuidade")),
      num_parcelas: Number(fd.get("num_parcelas")),
      vencimento_dia: Number(fd.get("vencimento_dia")),
    });
    if (error) setError(error.message);
    else {
      form.reset();
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

  // Auditoria (01/09/2026, C1): 'cancelado' e 'isento' existem no enum
  // parcela_status desde o schema inicial, mas nada na interface os
  // escrevia — não havia como registrar uma parcela perdoada ou anulada,
  // então ela ficava "em aberto" (pendente/atrasado) para sempre, inflando
  // o total vencido do painel e a inadimplência do relatório indefinidamente.
  async function handleUpdateParcelaStatus(parcelaId: string, status: string) {
    if (!selectedContrato) return;
    setError(null);
    const { error } = await supabase
      .from("parcelas")
      .update({ status })
      .eq("id", parcelaId);
    if (error) setError(error.message);
    else loadParcelas(selectedContrato);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h-page">Financeiro</h1>
          <p className="subtle mt-1">Contratos, parcelas, descontos e pagamentos.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/alunos" className="btn btn-secondary">
            Buscar aluno
          </Link>
          <Link href="/financeiro/relatorios" className="btn btn-secondary">
            Relatórios
          </Link>
        </div>
      </div>

      {error && (
        <p role="alert" className="alert alert-danger">
          {error}
        </p>
      )}
      {info && <p className="alert alert-ok">{info}</p>}

      <section className="card p-4">
        <h2 className="h-section mb-3">Novo contrato</h2>
        <form onSubmit={handleCreateContrato} className="grid gap-3 sm:grid-cols-2">
          <label className="field sm:col-span-2">
            <span>Matrícula (aluno)</span>
            <select name="matricula_id" required className="input">
              <option value="">Selecione</option>
              {matriculas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.alunos?.pessoas?.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Valor da anuidade</span>
            <input
              name="valor_anuidade"
              type="number"
              step="0.01"
              inputMode="decimal"
              required
              className="input"
            />
          </label>
          <label className="field">
            <span>Nº de parcelas</span>
            <input
              name="num_parcelas"
              type="number"
              min={1}
              max={12}
              inputMode="numeric"
              required
              className="input"
            />
          </label>
          <label className="field">
            <span>Dia de vencimento</span>
            <input
              name="vencimento_dia"
              type="number"
              min={1}
              max={28}
              inputMode="numeric"
              required
              className="input"
            />
          </label>
          <div className="flex items-end">
            <button className="btn w-full sm:w-auto">Criar contrato</button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="h-section mb-2">Contratos</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Aluno</th>
                <th>Unidade (CNPJ)</th>
                <th>Anuidade</th>
                <th>Parcelas</th>
                <th>Assinado</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {contratos.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.matriculas?.alunos?.pessoas?.nome}</td>
                  <td className="text-xs text-ink-500">
                    {c.matriculas?.turmas?.unidades?.nome}
                    {c.matriculas?.turmas?.unidades?.cnpj
                      ? ` (${c.matriculas.turmas.unidades.cnpj})`
                      : ""}
                  </td>
                  <td>{brl(c.valor_anuidade)}</td>
                  <td>{c.num_parcelas}x</td>
                  <td>
                    {c.assinado_em ? (
                      new Date(c.assinado_em).toLocaleDateString("pt-BR")
                    ) : (
                      <span className="badge badge-neutral">Não assinado</span>
                    )}
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-2">
                      {!c.assinado_em && (
                        <button onClick={() => handleAssinar(c.id)} className="btn-link">
                          Assinar
                        </button>
                      )}
                      {c.assinado_em && (
                        <button
                          onClick={() => handleGerarParcelas(c.id)}
                          className="btn-link"
                        >
                          Gerar parcelas
                        </button>
                      )}
                      <button onClick={() => loadParcelas(c.id)} className="btn-link">
                        Ver parcelas
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {contratos.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-500">
                    Nenhum contrato cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedContrato && (
        <>
          <section>
            <h2 className="h-section mb-2">Parcelas</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Competência</th>
                    <th>Vencimento</th>
                    <th>Bruto</th>
                    <th>Desconto</th>
                    <th>Líquido</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelas.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{mesAno(p.competencia)}</td>
                      <td>{dataBr(p.vencimento)}</td>
                      <td>{brl(p.valor_bruto)}</td>
                      <td>{brl(p.valor_desconto)}</td>
                      <td>{brl(p.valor_liquido)}</td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="flex flex-wrap gap-2">
                        {ABERTA.includes(p.status) && (
                          <>
                            <button
                              onClick={() => handleUpdateParcelaStatus(p.id, "isento")}
                              className="btn-link"
                            >
                              Isentar
                            </button>
                            <button
                              onClick={() => handleUpdateParcelaStatus(p.id, "cancelado")}
                              className="btn-link"
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {parcelas.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-ink-500">
                        Nenhuma parcela gerada ainda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-4">
            <h2 className="h-section mb-3">Descontos</h2>
            <form onSubmit={handleCreateDesconto} className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                <span>Tipo</span>
                <select name="tipo" required className="input">
                  <option value="bolsa">Bolsa</option>
                  <option value="irmao">Irmão</option>
                  <option value="pontualidade">Pontualidade</option>
                  <option value="convenio">Convênio</option>
                </select>
              </label>
              <label className="field">
                <span>Percentual (%)</span>
                <input
                  name="percentual"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  inputMode="decimal"
                  className="input"
                />
              </label>
              <label className="field">
                <span>Ou valor fixo (R$)</span>
                <input
                  name="valor"
                  type="number"
                  step="0.01"
                  min={0}
                  inputMode="decimal"
                  className="input"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="field">
                  <span>Vigência de</span>
                  <input name="vigencia_inicio" type="date" required className="input" />
                </label>
                <label className="field">
                  <span>até</span>
                  <input name="vigencia_fim" type="date" required className="input" />
                </label>
              </div>
              <div className="sm:col-span-2">
                <button className="btn w-full sm:w-auto">Adicionar desconto</button>
              </div>
            </form>

            <div className="table-wrap mt-4">
              <table>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Percentual</th>
                    <th>Valor fixo</th>
                    <th>Vigência</th>
                  </tr>
                </thead>
                <tbody>
                  {descontos.map((d) => (
                    <tr key={d.id}>
                      <td className="capitalize">{d.tipo}</td>
                      <td>{d.percentual ? `${d.percentual}%` : "—"}</td>
                      <td>{d.valor ? brl(d.valor) : "—"}</td>
                      <td className="text-xs">{d.vigencia}</td>
                    </tr>
                  ))}
                  {descontos.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-ink-500">
                        Nenhum desconto cadastrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="subtle mt-2">
              &quot;Gerar parcelas&quot; aplica os descontos vigentes na data de
              assinatura — cadastre o desconto antes de gerar.
            </p>
          </section>

          <section className="card p-4">
            <h2 className="h-section mb-1">Pagamentos e notas fiscais</h2>
            <p className="subtle mb-3">
              As parcelas são quitadas da mais antiga para a mais recente.
            </p>

            {proximaPagavel ? (
              <form
                onSubmit={handleRegistrarPagamento}
                className="grid gap-3 rounded-lg bg-ink-50 p-3 sm:grid-cols-2"
              >
                <p className="text-sm sm:col-span-2">
                  Próxima parcela a quitar:{" "}
                  <strong>{mesAno(proximaPagavel.competencia)}</strong> · vence{" "}
                  {dataBr(proximaPagavel.vencimento)} ·{" "}
                  <strong>{brl(proximaPagavel.valor_liquido)}</strong>
                </p>
                <label className="field">
                  <span>Valor pago</span>
                  <input
                    name="valor"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    defaultValue={proximaPagavel.valor_liquido}
                    required
                    className="input"
                  />
                </label>
                <label className="field">
                  <span>Data do pagamento</span>
                  <input name="data" type="date" required className="input" />
                </label>
                <label className="field">
                  <span>Meio</span>
                  <select name="meio" required className="input">
                    <option value="boleto">Boleto</option>
                    <option value="pix">Pix</option>
                    <option value="cartao">Cartão</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="transferencia">Transferência</option>
                  </select>
                </label>
                <div className="flex items-end">
                  <button className="btn w-full sm:w-auto">Registrar pagamento</button>
                </div>
                {bloqueadas.length > 0 && (
                  <p className="alert alert-warn sm:col-span-2">
                    {bloqueadas.length} parcela{bloqueadas.length > 1 ? "s" : ""} mais
                    recente{bloqueadas.length > 1 ? "s" : ""} (
                    {bloqueadas.map((p) => mesAno(p.competencia)).join(", ")}) só poderá
                    {bloqueadas.length > 1 ? "ão" : ""} ser quitada
                    {bloqueadas.length > 1 ? "s" : ""} depois desta.
                  </p>
                )}
              </form>
            ) : (
              <p className="alert alert-ok">Não há parcelas em aberto neste contrato.</p>
            )}

            <div className="table-wrap mt-4">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Meio</th>
                    <th>Valor</th>
                    <th>Nota fiscal</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagamentos.map((pg) =>
                    editingPagamentoId === pg.id ? (
                      <tr key={pg.id} className="bg-ink-50">
                        <td colSpan={5} className="py-3">
                          <form
                            onSubmit={(e) => handleUpdatePagamento(e, pg.id)}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input
                              name="data"
                              type="date"
                              defaultValue={pg.data}
                              required
                              className="input w-40"
                            />
                            <select
                              name="meio"
                              defaultValue={pg.meio}
                              required
                              className="input"
                            >
                              <option value="boleto">Boleto</option>
                              <option value="pix">Pix</option>
                              <option value="cartao">Cartão</option>
                              <option value="dinheiro">Dinheiro</option>
                              <option value="transferencia">Transferência</option>
                            </select>
                            <input
                              name="valor"
                              type="number"
                              step="0.01"
                              inputMode="decimal"
                              defaultValue={pg.valor}
                              required
                              className="input w-32"
                            />
                            <button type="submit" className="btn">
                              Salvar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingPagamentoId(null)}
                              className="btn btn-secondary"
                            >
                              Cancelar
                            </button>
                          </form>
                        </td>
                      </tr>
                    ) : (
                      <tr key={pg.id}>
                        <td>{dataBr(pg.data)}</td>
                        <td className="capitalize">{pg.meio}</td>
                        <td>{brl(pg.valor)}</td>
                        <td>
                          {pg.notas_fiscais[0] ? (
                            <span className="badge badge-ok">
                              {pg.notas_fiscais[0].status}
                              {pg.notas_fiscais[0].numero
                                ? ` nº ${pg.notas_fiscais[0].numero}`
                                : ""}
                            </span>
                          ) : (
                            <span className="badge badge-neutral">sem NF</span>
                          )}
                        </td>
                        <td className="flex flex-wrap gap-2">
                          {!pg.notas_fiscais[0] && (
                            <>
                              <button
                                onClick={() => setEditingPagamentoId(pg.id)}
                                className="btn-link"
                              >
                                Corrigir
                              </button>
                              <button
                                onClick={() => handleEmitirNota(pg.id)}
                                className="btn-link"
                              >
                                Emitir NF
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                  {pagamentos.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-ink-500">
                        Nenhum pagamento registrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="subtle mt-2">
              Sem provedor de eNF configurado, &quot;Emitir NF&quot; registra a nota como
              pendente — ver erp-escolar-br/README.md.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "pago"
      ? "badge-ok"
      : status === "atrasado"
        ? "badge-danger"
        : status === "pendente"
          ? "badge-warn"
          : "badge-neutral";
  return <span className={`badge ${cls} capitalize`}>{status}</span>;
}
