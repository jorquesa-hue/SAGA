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
  turma_id: string | null;
  enviado_em: string | null;
  created_at: string;
  turmas: { nome: string } | null;
}

interface Turma {
  id: string;
  nome: string;
}

const ALVO_LABEL: Record<string, string> = {
  todos: "Todos",
  responsaveis: "Responsáveis",
  professores: "Professores",
  turma_especifica: "Turma",
};

export default function ComunicadosPage() {
  const supabase = createClient();
  const papeis = useCurrentPapeis();
  const isStaff = papeis.some((p) => STAFF_PAPEIS.includes(p));
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [turmas, setTurmas] = useState<Turma[]>([]);
  // Quantas famílias/professores confirmaram leitura de cada comunicado. A
  // RLS só devolve estas linhas para a secretaria (0030), então para quem
  // não é staff o mapa vem vazio e a coluna nem aparece.
  const [leituras, setLeituras] = useState<Record<string, number>>({});
  const [alvo, setAlvo] = useState("todos");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [{ data }, { data: t }, { data: l }] = await Promise.all([
      supabase
        .from("comunicados")
        .select(
          "id, titulo, corpo, publico_alvo, turma_id, enviado_em, created_at, turmas(nome)",
        )
        .order("created_at", { ascending: false })
        .returns<Comunicado[]>(),
      supabase.from("turmas").select("id, nome").is("deleted_at", null).order("nome"),
      supabase.from("comunicados_leituras").select("comunicado_id"),
    ]);
    setComunicados(data ?? []);
    setTurmas(t ?? []);
    const contagem: Record<string, number> = {};
    for (const row of l ?? []) {
      contagem[row.comunicado_id] = (contagem[row.comunicado_id] ?? 0) + 1;
    }
    setLeituras(contagem);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-mount, not a render loop
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const publico = String(fd.get("publico_alvo"));
    const turmaId = fd.get("turma_id");

    const { error } = await supabase.from("comunicados").insert({
      titulo: fd.get("titulo"),
      corpo: fd.get("corpo"),
      publico_alvo: publico,
      // comunicados_turma_coerente (0030) exige turma exatamente quando o
      // público é a turma, e a recusa nula nos outros casos.
      turma_id: publico === "turma_especifica" ? turmaId : null,
      enviado_em: new Date().toISOString(),
    });
    if (error) {
      setError(
        error.message.includes("comunicados_turma_coerente")
          ? "Escolha a turma destinatária."
          : error.message,
      );
      return;
    }
    form.reset();
    setAlvo("todos");
    load();
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
          <div className="flex flex-wrap gap-3">
            <select
              name="publico_alvo"
              required
              value={alvo}
              onChange={(e) => setAlvo(e.target.value)}
              className="input"
            >
              <option value="todos">Todos</option>
              <option value="responsaveis">Responsáveis</option>
              <option value="professores">Professores</option>
              <option value="turma_especifica">Turma específica</option>
            </select>
            {alvo === "turma_especifica" && (
              <select name="turma_id" required className="input">
                <option value="">Selecione a turma</option>
                {turmas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Quem recebe é decidido pelo banco, não por esta tela: responsáveis não
            enxergam comunicado de professores, e comunicado de turma chega só a quem tem
            aluno matriculado nela.
          </p>
          <div>
            <button className="btn">Publicar</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {comunicados.map((c) => (
          <article key={c.id} className="card p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{c.titulo}</h3>
              <span className="text-xs text-slate-400">
                {new Date(c.created_at).toLocaleDateString("pt-BR")} ·{" "}
                {ALVO_LABEL[c.publico_alvo] ?? c.publico_alvo}
                {c.turmas ? ` ${c.turmas.nome}` : ""}
                {c.enviado_em ? "" : " · rascunho"}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap text-slate-700">{c.corpo}</p>
            {isStaff && (
              <p className="mt-2 text-xs text-slate-400">
                {leituras[c.id]
                  ? `${leituras[c.id]} confirmação(ões) de leitura`
                  : "Nenhuma confirmação de leitura ainda"}
              </p>
            )}
          </article>
        ))}
        {comunicados.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum comunicado publicado ainda.</p>
        )}
      </div>
    </div>
  );
}
