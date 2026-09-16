"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BRAND, Logo, LogoMark } from "@/components/brand";
import { IconCheckShield, IconClipboardCheck, IconWallet } from "@/components/icons";

const FEATURES = [
  { icon: IconClipboardCheck, text: "Matrículas e turmas em um fluxo só" },
  { icon: IconWallet, text: "Cobrança por unidade e CNPJ, sem planilha" },
  { icon: IconCheckShield, text: "Isolamento entre escolas garantido por LGPD" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : signInError.message,
      );
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel — collapses to a slim header strip on mobile */}
      <aside className="mesh-brand px-6 py-6 lg:flex lg:w-[44%] lg:flex-col lg:justify-between lg:px-14 lg:py-14">
        <Logo size={34} inverted />
        <div className="mt-10 hidden lg:mt-0 lg:block">
          <h2 className="max-w-md text-4xl leading-[1.1] font-bold tracking-tight text-white">
            A secretaria e o financeiro da escola em um só lugar.
          </h2>
          <p className="mt-4 max-w-sm text-sm text-brand-200">
            Matrículas, contratos, cobrança por unidade e CNPJ, comunicação com as
            famílias e portal do responsável.
          </p>
          <ul className="mt-9 flex flex-col gap-3.5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/90">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/10 text-accent-400">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-8 hidden text-xs text-brand-300 lg:block">
          {BRAND.full} · dados protegidos por isolamento entre escolas (LGPD)
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center bg-ink-50 px-4 py-10 sm:px-6">
        <div className="animate-in w-full max-w-sm rounded-2xl border border-ink-200 bg-white p-6 shadow-[var(--shadow-md)] sm:p-8">
          <div className="mb-6 lg:hidden">
            <LogoMark size={40} />
          </div>
          <h1 className="h-page">Entrar</h1>
          <p className="subtle mt-1 mb-6">Acesse com o e-mail cadastrado na escola.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="field" htmlFor="email">
              <span>E-mail</span>
              <input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </label>
            <label className="field" htmlFor="password">
              <span>Senha</span>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
            </label>

            {error && (
              <p role="alert" className="alert alert-danger">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn w-full">
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <p className="subtle mt-6 text-center">
            Sua escola ainda não tem conta?{" "}
            <Link href="/signup" className="font-medium text-brand-700 underline">
              Cadastre sua escola
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
