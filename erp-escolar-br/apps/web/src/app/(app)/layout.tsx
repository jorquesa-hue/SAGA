import { redirect } from "next/navigation";
import { getCurrentPessoa } from "@/lib/pessoa";
import {
  IconBarChart,
  IconBuilding,
  IconClipboardCheck,
  IconGraduationCap,
  IconGrid,
  IconHome,
  IconMegaphone,
  IconUsers,
  IconWallet,
} from "@/components/icons";
import AppNav, { type NavItem } from "./app-nav";

const STAFF_PAPEIS = ["admin", "secretaria"];

const PAPEL_LABEL: Record<string, string> = {
  admin: "Administração",
  secretaria: "Secretaria",
  professor: "Professor(a)",
  responsavel: "Responsável",
  aluno: "Aluno(a)",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const pessoa = await getCurrentPessoa();

  if (!pessoa) {
    // Logged in via Supabase Auth but with no linked pessoas row (should
    // not happen through signup-escola/invite-pessoa, but fail safe
    // rather than render a broken shell).
    redirect("/login");
  }

  const isStaff = pessoa.papeis.some((p) => STAFF_PAPEIS.includes(p));
  const isProfessor = pessoa.papeis.includes("professor");
  const isResponsavel = pessoa.papeis.includes("responsavel");

  // Ordered as the student life cycle, not as a list of system modules: the
  // student exists (Alunos), enters a turma (Matrículas), generates charges
  // (Financeiro), is talked to (Comunicados) and is measured (Relatórios).
  // The structural and administrative screens the school configures once
  // (Escola, Equipe) come last, after the stages that happen every day.
  const items: NavItem[] = [
    {
      href: "/dashboard",
      label: isProfessor && !isStaff ? "Minhas turmas" : "Painel",
      icon: IconGrid,
    },
    ...(isStaff
      ? [
          { href: "/alunos", label: "Alunos", icon: IconGraduationCap },
          { href: "/matriculas", label: "Matrículas", icon: IconClipboardCheck },
          { href: "/financeiro", label: "Financeiro", icon: IconWallet },
        ]
      : []),
    ...(isResponsavel ? [{ href: "/portal", label: "Portal", icon: IconHome }] : []),
    { href: "/comunicados", label: "Comunicados", icon: IconMegaphone },
    ...(isStaff
      ? [
          { href: "/financeiro/relatorios", label: "Relatórios", icon: IconBarChart },
          { href: "/escola", label: "Escola", icon: IconBuilding },
          { href: "/equipe", label: "Equipe", icon: IconUsers },
        ]
      : []),
  ];

  const papelLabel =
    pessoa.papeis.map((p) => PAPEL_LABEL[p] ?? p).join(" · ") || "Sem papel";

  return (
    <div className="min-h-screen bg-ink-50 lg:pl-64">
      <AppNav items={items} nome={pessoa.nome} papelLabel={papelLabel} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
        <div className="animate-in">{children}</div>
      </main>
    </div>
  );
}
