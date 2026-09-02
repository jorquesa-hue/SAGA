"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentPapeis } from "@/lib/use-current-papeis";

const STAFF_PAPEIS = ["admin", "secretaria"];

interface Comunicado {
  id: string;
  titulo: string;
  corpo: string;
  publico_alvo: string;
  enviado_em: string | null;
  created_at: string;
}

export default function ComunicadosPage() {
  const supabase = createClient();
  const papeis = useCurrentPapeis();
  const isStaff = papeis.some((p) => STAFF_PAPEIS.includes(p));
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("comunicados")
      .select("id, titulo, corpo, publico_alvo, enviado_em, created_at")
      .order("created_at", { ascending: false });
    setComunicados(data ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-mount, not a render loop
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from("comunicados").insert({
      titulo: fd.get("titulo"),
      corpo: fd.get("corpo"),
      publico_alvo: fd.get("publico_alvo"),
      enviado_em: new Date().toISOString(),
    });
    if (error) setError(error.message);
    else {
      e.currentTarget.reset();
      load();
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="h-page">Comunicados</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {isStaff && (
        <form onSubmit={handleCreate} className="card space-y-3 p-4">
          <h3 className="h-card">Novo comunicado</h3>
          <input name="titulo" placeholder="Título" required className="input w-full" />
          <textarea
            name="corpo"
            placeholder="Mensagem"
            required
            rows={4}
            className="input w-full"
          />
          <select name="publico_alvo" required className="input">
            <option value="todos">Todos</option>
            <option value="responsaveis">Responsáveis</option>
            <option value="professores">Professores</option>
            <option value="turma_especifica">Turma específica</option>
          </select>
          <div>
            <button className="btn">Publicar</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {comunicados.map((c) => (
          <article key={c.id} className="card p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{c.titulo}</h3>
              <span className="text-xs text-slate-400">
                {new Date(c.created_at).toLocaleDateString("pt-BR")} · {c.publico_alvo}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap text-slate-700">{c.corpo}</p>
          </article>
        ))}
        {comunicados.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum comunicado publicado ainda.</p>
        )}
      </div>
    </div>
  );
}
