"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

interface Aluno {
  id: string;
  pessoas: { nome: string } | null;
}

export default function EquipePage() {
  const supabase = createClient();
  const [papel, setPapel] = useState("professor");
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [selectedAlunoId, setSelectedAlunoId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from("alunos")
      .select("id, pessoas(nome)")
      .returns<Aluno[]>()
      .then(({ data }) => setAlunos(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      nome: fd.get("nome"),
      email: fd.get("email"),
      cpf: fd.get("cpf") || undefined,
      data_nascimento: fd.get("data_nascimento"),
      papeis: [papel],
    };

    if (papel === "responsavel" && selectedAlunoId) {
      body.vinculos_responsavel = [
        {
          aluno_id: selectedAlunoId,
          vinculo: fd.get("vinculo"),
          financeiro: fd.get("financeiro") === "on",
          pedagogico: fd.get("pedagogico") === "on",
          retirada: fd.get("retirada") === "on",
        },
      ];
    }

    const { data, error: fnError } = await supabase.functions.invoke("invite-pessoa", { body });
    setLoading(false);

    if (fnError || data?.error) {
      setError(data?.error ?? fnError?.message ?? "Falha ao convidar.");
      return;
    }

    setSuccess(`Convite enviado para ${body.email}.`);
    e.currentTarget.reset();
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Equipe — convidar usuário</h1>
      <p className="text-sm text-slate-500">
        Envia um e-mail de convite (via Supabase Auth) para a pessoa definir a própria senha.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <input name="nome" placeholder="Nome" required className="input" />
          <input name="email" type="email" placeholder="E-mail" required className="input" />
          <input name="cpf" placeholder="CPF (opcional)" className="input" />
          <input name="data_nascimento" type="date" required className="input" />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Papel</label>
          <select
            value={papel}
            onChange={(e) => setPapel(e.target.value)}
            className="input w-full"
          >
            <option value="admin">Admin</option>
            <option value="secretaria">Secretaria</option>
            <option value="professor">Professor</option>
            <option value="responsavel">Responsável</option>
          </select>
        </div>

        {papel === "responsavel" && (
          <div className="space-y-2 rounded-md border border-slate-100 bg-slate-50 p-3">
            <label className="block text-sm font-medium text-slate-700">Vincular a aluno</label>
            <select
              value={selectedAlunoId}
              onChange={(e) => setSelectedAlunoId(e.target.value)}
              className="input w-full"
            >
              <option value="">Selecione um aluno</option>
              {alunos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.pessoas?.nome}
                </option>
              ))}
            </select>
            <select name="vinculo" className="input w-full">
              <option value="mae">Mãe</option>
              <option value="pai">Pai</option>
              <option value="avo">Avô</option>
              <option value="ava">Avó</option>
              <option value="tutor_legal">Tutor legal</option>
              <option value="outro">Outro</option>
            </select>
            <div className="flex gap-4 text-sm text-slate-700">
              <label className="flex items-center gap-1">
                <input type="checkbox" name="financeiro" /> Financeiro
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" name="pedagogico" /> Pedagógico
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" name="retirada" /> Retirada
              </label>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-700">{success}</p>}

        <button type="submit" disabled={loading} className="btn">
          {loading ? "Enviando..." : "Enviar convite"}
        </button>
      </form>
    </div>
  );
}
