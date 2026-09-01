import { createClient } from "@/lib/supabase/server";
import { getCurrentPessoa } from "@/lib/pessoa";
import type { ComponentType } from "react";
import {
  IconBarChart,
  IconClipboardCheck,
  IconWallet,
  type IconProps,
} from "@/components/icons";

const STAFF_PAPEIS = ["admin", "secretaria"];

interface ParcelaRow {
  id: string;
  vencimento: string;
  valor_liquido: string;
  status: string;
  competencia: string;
  contratos: {
    matriculas: {
      turmas: { id: string; nome: string } | null;
    } | null;
  } | null;
}

export default async function DashboardPage() {
  const pessoa = await getCurrentPessoa();
  if (!pessoa) return null;

  if (pessoa.papeis.some((p) => STAFF_PAPEIS.includes(p))) {
    return <PainelDaDirecao />;
  }
  if (pessoa.papeis.includes("professor")) {
    return <MinhasTurmas />;
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <p className="text-sm text-slate-600">
        Acesse o Portal do responsável no menu acima para ver as parcelas e comunicados
        dos seus dependentes.
      </p>
    </div>
  );
}

// Milestone 7: Painel da direção — inadimplência por turma, aging,
// previsão de recebíveis.
async function PainelDaDirecao() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("parcelas")
    .select(
      "id, vencimento, valor_liquido, status, competencia, contratos(matriculas(turmas(id, nome)))",
    )
    .is("deleted_at", null)
    .returns<ParcelaRow[]>();

  if (error) {
    return (
      <p className="text-sm text-red-600">Erro ao carregar painel: {error.message}</p>
    );
  }

  const parcelas = data ?? [];
  const hoje = new Date().toISOString().slice(0, 10);

  const emAberto = parcelas.filter(
    (p) => p.status === "pendente" || p.status === "atrasado",
  );
  const vencidas = emAberto.filter((p) => p.vencimento < hoje);

  const porTurma = new Map<string, { nome: string; total: number; count: number }>();
  for (const p of vencidas) {
    const turma = p.contratos?.matriculas?.turmas;
    const key = turma?.id ?? "sem_turma";
    const nome = turma?.nome ?? "Sem turma";
    const entry = porTurma.get(key) ?? { nome, total: 0, count: 0 };
    entry.total += Number(p.valor_liquido);
    entry.count += 1;
    porTurma.set(key, entry);
  }

  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const p of vencidas) {
    const dias = Math.floor(
      (new Date(hoje).getTime() - new Date(p.vencimento).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    const valor = Number(p.valor_liquido);
    if (dias <= 30) buckets["0-30"] += valor;
    else if (dias <= 60) buckets["31-60"] += valor;
    else if (dias <= 90) buckets["61-90"] += valor;
    else buckets["90+"] += valor;
  }

  const previsaoPorCompetencia = new Map<string, number>();
  for (const p of emAberto.filter((p) => p.vencimento >= hoje)) {
    previsaoPorCompetencia.set(
      p.competencia,
      (previsaoPorCompetencia.get(p.competencia) ?? 0) + Number(p.valor_liquido),
    );
  }

  const brl = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="h-page mb-1">Painel da direção</h1>
        <p className="subtle mb-4">Visão consolidada de cobrança em tempo real.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label="Parcelas em aberto"
            value={String(emAberto.length)}
            icon={IconClipboardCheck}
            tone="brand"
          />
          <Stat
            label="Parcelas vencidas"
            value={String(vencidas.length)}
            icon={IconBarChart}
            tone="warn"
          />
          <Stat
            label="Total vencido"
            value={brl(vencidas.reduce((s, p) => s + Number(p.valor_liquido), 0))}
            icon={IconWallet}
            tone="danger"
          />
        </div>
      </div>

      <section>
        <h2 className="h-section mb-2">Inadimplência por turma</h2>
        <Table
          head={["Turma", "Parcelas vencidas", "Total"]}
          rows={[...porTurma.values()]
            .sort((a, b) => b.total - a.total)
            .map((t) => [t.nome, String(t.count), brl(t.total)])}
          empty="Nenhuma parcela vencida."
        />
      </section>

      <section>
        <h2 className="h-section mb-2">Aging</h2>
        <Table
          head={["0-30 dias", "31-60 dias", "61-90 dias", "90+ dias"]}
          rows={[Object.values(buckets).map((v) => brl(v))]}
        />
      </section>

      <section>
        <h2 className="h-section mb-2">Previsão de recebíveis</h2>
        <Table
          head={["Competência", "Valor previsto"]}
          rows={[...previsaoPorCompetencia.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([competencia, valor]) => [competencia, brl(valor)])}
          empty="Nenhuma parcela futura em aberto."
        />
      </section>
    </div>
  );
}

interface TurmaRow {
  id: string;
  nome: string;
}

async function MinhasTurmas() {
  const supabase = await createClient();
  const { data } = await supabase.from("turmas").select("id, nome").returns<TurmaRow[]>();

  return (
    <div>
      <h1 className="h-page mb-4">Minhas turmas</h1>
      <Table
        head={["Turma"]}
        rows={(data ?? []).map((t) => [t.nome])}
        empty="Nenhuma turma atribuída."
      />
    </div>
  );
}

const TONE_CLASSES: Record<string, string> = {
  brand: "bg-brand-50 text-brand-700",
  warn: "bg-warn-50 text-warn-700",
  danger: "bg-danger-50 text-danger-700",
};

function Stat({
  label,
  value,
  icon: Icon,
  tone = "brand",
}: {
  label: string;
  value: string;
  icon: ComponentType<IconProps>;
  tone?: "brand" | "warn" | "danger";
}) {
  return (
    <div className="stat-card">
      <span className={`stat-card__icon ${TONE_CLASSES[tone]}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div>
        <p className="subtle">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
      </div>
    </div>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: string[][];
  empty?: string;
}) {
  if (rows.length === 0) {
    return <p className="subtle">{empty ?? "Nenhum registro."}</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
