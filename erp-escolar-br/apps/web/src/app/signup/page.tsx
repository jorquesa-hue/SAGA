"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LogoMark } from "@/components/brand";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    razao_social: "",
    cnpj: "",
    municipio_ibge: "",
    admin_nome: "",
    admin_email: "",
    admin_password: "",
    admin_data_nascimento: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("signup-escola", {
      body: form,
    });

    if (fnError || data?.error) {
      setError(data?.error ?? fnError?.message ?? "Falha ao cadastrar escola.");
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: form.admin_email,
      password: form.admin_password,
    });

    if (signInError) {
      setError("Escola criada, mas o login automático falhou. Entre manualmente.");
      setLoading(false);
      router.push("/login");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <LogoMark size={40} />
        <h1 className="h-page mt-4 mb-1">Cadastrar escola</h1>
        <p className="subtle mb-6">
          Fase 1 — Cobrança e Retenção. Você será o admin desta escola.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="Razão social"
            value={form.razao_social}
            onChange={update("razao_social")}
          />
          <Field
            label="CNPJ"
            value={form.cnpj}
            onChange={update("cnpj")}
            placeholder="00000000000000"
          />
          <Field
            label="Código IBGE do município"
            value={form.municipio_ibge}
            onChange={update("municipio_ibge")}
            placeholder="7 dígitos"
          />
          <hr className="border-slate-200" />
          <Field
            label="Seu nome (admin)"
            value={form.admin_nome}
            onChange={update("admin_nome")}
          />
          <Field
            label="Seu e-mail"
            type="email"
            value={form.admin_email}
            onChange={update("admin_email")}
          />
          <Field
            label="Senha"
            type="password"
            value={form.admin_password}
            onChange={update("admin_password")}
          />
          <Field
            label="Sua data de nascimento"
            type="date"
            value={form.admin_data_nascimento}
            onChange={update("admin_data_nascimento")}
          />

          {error && (
            <p role="alert" className="alert alert-danger">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn w-full">
            {loading ? "Cadastrando..." : "Cadastrar escola"}
          </button>
        </form>

        <p className="subtle mt-6 text-center">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-brand-700 underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[0.8125rem] font-medium text-ink-700">
        {label}
      </label>
      <input
        type={type}
        required
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="input"
      />
    </div>
  );
}
