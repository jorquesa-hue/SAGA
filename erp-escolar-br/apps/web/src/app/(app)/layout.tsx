import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentPessoa } from "@/lib/pessoa";
import SignOutButton from "./sign-out-button";

const STAFF_PAPEIS = ["admin", "secretaria"];

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-slate-900">ERP Escolar BR</span>
            <nav className="flex gap-4 text-sm text-slate-600">
              <Link href="/dashboard" className="hover:text-slate-900">
                Painel
              </Link>
              <Link href="/comunicados" className="hover:text-slate-900">
                Comunicados
              </Link>
              {isStaff && (
                <>
                  <Link href="/cadastros" className="hover:text-slate-900">
                    Cadastros
                  </Link>
                  <Link href="/financeiro" className="hover:text-slate-900">
                    Financeiro
                  </Link>
                  <Link href="/equipe" className="hover:text-slate-900">
                    Equipe
                  </Link>
                </>
              )}
              {(isProfessor || isStaff) && (
                <Link href="/dashboard" className="hover:text-slate-900">
                  Minhas turmas
                </Link>
              )}
              {isResponsavel && (
                <Link href="/portal" className="hover:text-slate-900">
                  Portal do responsável
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{pessoa.nome}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
