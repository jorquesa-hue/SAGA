import { redirect } from "next/navigation";
import { getCurrentPessoa } from "@/lib/pessoa";
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
    { href: "/dashboard", label: isProfessor && !isStaff ? "Minhas turmas" : "Painel" },
    ...(isStaff
      ? [
          { href: "/alunos", label: "Alunos" },
          { href: "/matriculas", label: "Matrículas" },
          { href: "/financeiro", label: "Financeiro" },
        ]
      : []),
    ...(isResponsavel ? [{ href: "/portal", label: "Portal" }] : []),
    { href: "/comunicados", label: "Comunicados" },
    ...(isStaff
      ? [
          { href: "/financeiro/relatorios", label: "Relatórios" },
          { href: "/escola", label: "Escola" },
          { href: "/equipe", label: "Equipe" },
        ]
      : []),
  ];

  const papelLabel =
    pessoa.papeis.map((p) => PAPEL_LABEL[p] ?? p).join(" · ") || "Sem papel";

  return (
    <div className="min-h-screen bg-ink-50">
      <AppNav items={items} nome={pessoa.nome} papelLabel={papelLabel} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
