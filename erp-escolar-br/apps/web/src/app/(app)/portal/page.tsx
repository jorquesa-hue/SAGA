import { createClient } from "@/lib/supabase/server";
import ConsentimentoForm from "./consentimento-form";

interface Parcela {
  id: string;
  competencia: string;
  vencimento: string;
  valor_liquido: string;
  status: string;
  asaas_cobranca_id: string | null;
  contratos: {
    matriculas: { alunos: { pessoas: { nome: string } | null } | null } | null;
  } | null;
}

interface Pagamento {
  id: string;
  valor: string;
  data: string;
  meio: string;
  parcelas: { competencia: string } | null;
}

export default async function PortalPage() {
  const supabase = await createClient();

  const [
    { data: parcelas },
    { data: pagamentos },
    { data: vinculos },
    { data: consentimentos },
  ] = await Promise.all([
    supabase
      .from("parcelas")
      .select(
        "id, competencia, vencimento, valor_liquido, status, asaas_cobranca_id, contratos(matriculas(alunos(pessoas(nome))))",
      )
      .order("vencimento")
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

  const brl = (v: string) =>
    Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-8">
      <h1 className="h-page">Portal do responsável</h1>

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
              {(parcelas ?? []).map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">
                    {p.contratos?.matriculas?.alunos?.pessoas?.nome}
                  </td>
                  <td className="px-4 py-2">{p.competencia}</td>
                  <td className="px-4 py-2">{p.vencimento}</td>
                  <td className="px-4 py-2">{brl(p.valor_liquido)}</td>
                  <td className="px-4 py-2">{p.status}</td>
                  <td className="px-4 py-2 text-xs text-slate-400">
                    {p.asaas_cobranca_id
                      ? "2ª via / PIX disponíveis"
                      : "Aguardando integração Asaas"}
                  </td>
                </tr>
              ))}
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
          Boleto (2ª via) e PIX copia-e-cola são emitidos pelo Asaas (Milestone 5); esta
          conta ainda não está conectada a um Asaas real — ver erp-escolar-br/README.md.
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
                  <td className="px-4 py-2">{p.data}</td>
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
