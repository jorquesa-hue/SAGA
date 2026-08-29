import { createClient } from "@/lib/supabase/server";

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

  const [{ data: parcelas }, { data: pagamentos }] = await Promise.all([
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
  ]);

  const brl = (v: string) =>
    Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold text-slate-900">Portal do responsável</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Parcelas</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-2 font-medium text-slate-600">Aluno</th>
                <th className="px-4 py-2 font-medium text-slate-600">Competência</th>
                <th className="px-4 py-2 font-medium text-slate-600">Vencimento</th>
                <th className="px-4 py-2 font-medium text-slate-600">Valor</th>
                <th className="px-4 py-2 font-medium text-slate-600">Status</th>
                <th className="px-4 py-2 font-medium text-slate-600">Pagamento</th>
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
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Comprovantes</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-2 font-medium text-slate-600">Competência</th>
                <th className="px-4 py-2 font-medium text-slate-600">Data</th>
                <th className="px-4 py-2 font-medium text-slate-600">Meio</th>
                <th className="px-4 py-2 font-medium text-slate-600">Valor</th>
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
    </div>
  );
}
