import { createClient } from "@/lib/supabase/server";
import { getCurrentPessoa } from "@/lib/pessoa";
import AssinaturaForm, { type ContratoParaAssinar } from "./assinatura-form";
import ComunicadosFeed, { type ComunicadoPortal } from "./comunicados-feed";
import ConsentimentoForm from "./consentimento-form";
import EmailForm from "./email-form";

// Tudo o que esta página lê vem filtrado pela RLS, não por cláusula escrita
// aqui: comunicados pelo público-alvo (0030), contratos e parcelas pelo
// vínculo de responsável financeiro, assinaturas por ser o signatário.
// Filtro em componente é conveniência de leitura; a autorização é do banco
// (spec §3.7).

interface Parcela {
  id: string;
  competencia: string;
  vencimento: string;
  valor_liquido: string;
  status: string;
  asaas_cobranca_id: string | null;
  contratos: {
    matriculas: {
      aluno_id: string;
      alunos: { pessoas: { nome: string } | null } | null;
    } | null;
  } | null;
}

interface Pagamento {
  id: string;
  valor: string;
  data: string;
  meio: string;
  parcelas: { competencia: string } | null;
}

interface Contrato {
  id: string;
  matriculas: {
    alunos: { pessoas: { nome: string } | null } | null;
    anos_letivos: { ano: number } | null;
  } | null;
}

interface Assinatura {
  contrato_id: string;
  assinado_em: string;
  documento_hash: string;
  signatario_nome: string;
  ip: string;
}

const brl = (v: string | number) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataBR = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR");

export default async function PortalPage() {
  const supabase = await createClient();
  const pessoa = await getCurrentPessoa();

  const [
    { data: parcelas },
    { data: pagamentos },
    { data: vinculos },
    { data: consentimentos },
    { data: comunicados },
    { data: leituras },
    { data: contratos },
    { data: assinaturas },
  ] = await Promise.all([
    supabase
      .from("parcelas")
      .select(
        "id, competencia, vencimento, valor_liquido, status, asaas_cobranca_id, contratos(matriculas(aluno_id, alunos(pessoas(nome))))",
      )
      .is("deleted_at", null)
      .order("competencia")
      .returns<Parcela[]>(),
    supabase
      .from("pagamentos")
      .select("id, valor, data, meio, parcelas(competencia)")
      .order("data", { ascending: false })
      .returns<Pagamento[]>(),
    supabase
      .from("responsaveis_alunos")
      .select("aluno_id, alunos(pessoa_id, pessoas(nome))")
      .is("deleted_at", null)
      .returns<
        {
          aluno_id: string;
          alunos: { pessoa_id: string; pessoas: { nome: string } | null } | null;
        }[]
      >(),
    supabase.from("consentimentos_lgpd").select("titular_pessoa_id"),
    supabase
      .from("comunicados")
      .select("id, titulo, corpo, publico_alvo, enviado_em, turmas(nome)")
      .is("deleted_at", null)
      .order("enviado_em", { ascending: false })
      .returns<
        (Omit<ComunicadoPortal, "lido" | "turma_nome"> & {
          turmas: { nome: string } | null;
        })[]
      >(),
    supabase.from("comunicados_leituras").select("comunicado_id"),
    supabase
      .from("contratos")
      .select("id, matriculas(alunos(pessoas(nome)), anos_letivos(ano))")
      .is("deleted_at", null)
      .returns<Contrato[]>(),
    supabase
      .from("contratos_assinaturas")
      .select("contrato_id, assinado_em, documento_hash, signatario_nome, ip")
      .returns<Assinatura[]>(),
  ]);

  const consentidoIds = new Set((consentimentos ?? []).map((c) => c.titular_pessoa_id));
  const alunosVinculados = (vinculos ?? [])
    .filter((v) => v.alunos)
    .map((v) => ({
      aluno_id: v.aluno_id,
      pessoa_id: v.alunos!.pessoa_id,
      nome: v.alunos!.pessoas?.nome ?? "—",
      jaConsentiu: consentidoIds.has(v.alunos!.pessoa_id),
    }));

  const lidos = new Set((leituras ?? []).map((l) => l.comunicado_id));
  const feed: ComunicadoPortal[] = (comunicados ?? []).map((c) => ({
    id: c.id,
    titulo: c.titulo,
    corpo: c.corpo,
    publico_alvo: c.publico_alvo,
    enviado_em: c.enviado_em,
    turma_nome: c.turmas?.nome ?? null,
    lido: lidos.has(c.id),
  }));

  // O texto vem de fn_contrato_texto, renderizado no servidor: é o mesmo
  // que fn_assinar_contrato vai gerar e dar hash na hora de assinar. Se a
  // tela montasse o texto por conta própria, a família leria uma coisa e
  // assinaria outra.
  const assinaturaPorContrato = new Map(
    (assinaturas ?? []).map((a) => [a.contrato_id, a]),
  );
  const contratosParaAssinar: ContratoParaAssinar[] = await Promise.all(
    (contratos ?? []).map(async (c) => {
      const { data: texto } = await supabase.rpc("fn_contrato_texto", {
        p_contrato_id: c.id,
      });
      const a = assinaturaPorContrato.get(c.id);
      return {
        contrato_id: c.id,
        aluno_nome: c.matriculas?.alunos?.pessoas?.nome ?? "—",
        ano: c.matriculas?.anos_letivos?.ano ?? 0,
        texto: (texto as string) ?? "",
        assinatura: a
          ? {
              assinado_em: a.assinado_em,
              documento_hash: a.documento_hash,
              signatario_nome: a.signatario_nome,
              ip: a.ip,
            }
          : null,
      };
    }),
  );

  // Qual parcela pagar primeiro. Não é enfeite de tela: desde a 0026 o
  // banco RECUSA o pagamento de uma parcela enquanto existir outra em
  // atraso do mesmo aluno. Sem isto a família tentaria pagar a do mês e
  // levaria um erro sem entender por quê.
  const abertas = (parcelas ?? []).filter((p) => p.status !== "pago");
  const proximaPorAluno = new Map<string, string>();
  for (const p of abertas) {
    const alunoId = p.contratos?.matriculas?.aluno_id;
    if (alunoId && !proximaPorAluno.has(alunoId)) proximaPorAluno.set(alunoId, p.id);
  }
  const hoje = new Date().toISOString().slice(0, 10);

  const pendentesAssinatura = contratosParaAssinar.filter((c) => !c.assinatura).length;

  return (
    <div className="space-y-8">
      <h1 className="h-page">Portal do responsável</h1>

      {pendentesAssinatura > 0 && (
        <p className="alert alert-warn">
          {pendentesAssinatura === 1
            ? "Há 1 contrato aguardando sua assinatura."
            : `Há ${pendentesAssinatura} contratos aguardando sua assinatura.`}
        </p>
      )}

      <section>
        <h2 className="h-section mb-2">Comunicados</h2>
        {pessoa ? (
          <ComunicadosFeed
            comunicados={feed}
            pessoaId={pessoa.id}
            escolaId={pessoa.escola_id}
          />
        ) : (
          <p className="text-sm text-slate-500">Nenhum comunicado no momento.</p>
        )}
      </section>

      <section>
        <h2 className="h-section mb-2">Contrato de matrícula</h2>
        <p className="mb-3 text-xs text-slate-400">
          Assinatura eletrônica simples (Lei 14.063/2020). O que fica registrado é seu
          nome, seu CPF, a data, o IP usado e o SHA-256 do texto exato aceito — não é
          certificado ICP-Brasil.
        </p>
        <div className="space-y-3">
          {contratosParaAssinar.map((c) => (
            <AssinaturaForm key={c.contrato_id} contrato={c} />
          ))}
          {contratosParaAssinar.length === 0 && (
            <p className="text-sm text-slate-500">Nenhum contrato disponível.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="h-section mb-2">Parcelas</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Aluno</th>
                <th>Competência</th>
                <th>Vencimento</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {(parcelas ?? []).map((p) => {
                const alunoId = p.contratos?.matriculas?.aluno_id;
                const eProxima = alunoId ? proximaPorAluno.get(alunoId) === p.id : false;
                const emAtraso = p.status !== "pago" && p.vencimento < hoje;
                return (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      {p.contratos?.matriculas?.alunos?.pessoas?.nome}
                    </td>
                    <td className="px-4 py-2">{p.competencia}</td>
                    <td className="px-4 py-2">{dataBR(p.vencimento)}</td>
                    <td className="px-4 py-2">{brl(p.valor_liquido)}</td>
                    <td className="px-4 py-2">
                      {p.status === "pago" ? (
                        <span className="badge badge-ok">pago</span>
                      ) : emAtraso ? (
                        <span className="badge badge-danger">em atraso</span>
                      ) : (
                        <span className="badge badge-neutral">{p.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {p.status === "pago" ? (
                        <span className="text-slate-400">—</span>
                      ) : eProxima ? (
                        p.asaas_cobranca_id ? (
                          <span className="text-slate-700">2ª via / PIX disponíveis</span>
                        ) : (
                          <span className="text-slate-400">
                            Boleto ainda não emitido — fale com a secretaria
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">
                          Libera após a parcela anterior
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(parcelas ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    Nenhuma parcela encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          As parcelas são quitadas da mais antiga para a mais recente, por aluno — é regra
          do sistema, não da tela. Boleto (2ª via) e PIX copia-e-cola são emitidos pelo
          Asaas; esta conta ainda não está conectada a um Asaas real (ver
          erp-escolar-br/README.md).
        </p>
      </section>

      <section>
        <h2 className="h-section mb-2">Comprovantes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Competência</th>
                <th>Data</th>
                <th>Meio</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {(pagamentos ?? []).map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">{p.parcelas?.competencia}</td>
                  <td className="px-4 py-2">{dataBR(p.data)}</td>
                  <td className="px-4 py-2">{p.meio}</td>
                  <td className="px-4 py-2">{brl(p.valor)}</td>
                </tr>
              ))}
              {(pagamentos ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    Nenhum pagamento registrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="h-section mb-2">Seus dados</h2>
        <EmailForm emailAtual={pessoa?.email ?? null} />
      </section>

      <section>
        <h2 className="h-section mb-2">Consentimento LGPD</h2>
        <p className="mb-3 text-xs text-slate-400">
          Registro do consentimento para tratamento de dados pessoais do(s) seu(s)
          dependente(s), conforme a Lei Geral de Proteção de Dados.
        </p>
        <ConsentimentoForm alunos={alunosVinculados} />
      </section>
    </div>
  );
}
