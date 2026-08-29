"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Tab = "turmas" | "pessoas" | "alunos" | "matriculas";

export default function CadastrosPage() {
  const [tab, setTab] = useState<Tab>("turmas");

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Cadastros</h1>
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {(
          [
            ["turmas", "Turmas"],
            ["pessoas", "Pessoas"],
            ["alunos", "Alunos"],
            ["matriculas", "Matrículas"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm ${
              tab === key
                ? "border-b-2 border-slate-900 font-medium text-slate-900"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "turmas" && <TurmasTab />}
      {tab === "pessoas" && <PessoasTab />}
      {tab === "alunos" && <AlunosTab />}
      {tab === "matriculas" && <MatriculasTab />}
    </div>
  );
}

// ── Turmas (requires an ano_letivo and curso to exist first — created
// inline here too, since the spec's core schema has no separate screen
// for them in Milestone 3).
function TurmasTab() {
  const supabase = createClient();
  const [turmas, setTurmas] = useState<
    { id: string; nome: string; turno: string; capacidade: number }[]
  >([]);
  const [anosLetivos, setAnosLetivos] = useState<{ id: string; ano: number }[]>([]);
  const [cursos, setCursos] = useState<{ id: string; nome: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [t, a, c] = await Promise.all([
      supabase.from("turmas").select("id, nome, turno, capacidade").order("nome"),
      supabase.from("anos_letivos").select("id, ano").order("ano", { ascending: false }),
      supabase.from("cursos").select("id, nome").order("nome"),
    ]);
    setTurmas(t.data ?? []);
    setAnosLetivos(a.data ?? []);
    setCursos(c.data ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-mount, not a render loop
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateAnoLetivo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from("anos_letivos").insert({
      ano: Number(fd.get("ano")),
      data_inicio: fd.get("data_inicio"),
      data_fim: fd.get("data_fim"),
    });
    if (error) setError(error.message);
    else {
      e.currentTarget.reset();
      load();
    }
  }

  async function handleCreateCurso(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from("cursos").insert({
      nome: fd.get("nome"),
      etapa_ensino: fd.get("etapa_ensino"),
    });
    if (error) setError(error.message);
    else {
      e.currentTarget.reset();
      load();
    }
  }

  async function handleCreateTurma(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from("turmas").insert({
      nome: fd.get("nome"),
      turno: fd.get("turno"),
      capacidade: Number(fd.get("capacidade")),
      ano_letivo_id: fd.get("ano_letivo_id"),
      curso_id: fd.get("curso_id"),
    });
    if (error) setError(error.message);
    else {
      e.currentTarget.reset();
      load();
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form
          onSubmit={handleCreateAnoLetivo}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <h3 className="mb-2 text-sm font-medium text-slate-900">Novo ano letivo</h3>
          <div className="flex flex-wrap gap-2">
            <input
              name="ano"
              type="number"
              placeholder="Ano"
              required
              className="input w-24"
            />
            <input name="data_inicio" type="date" required className="input" />
            <input name="data_fim" type="date" required className="input" />
            <button className="btn">Criar</button>
          </div>
        </form>

        <form
          onSubmit={handleCreateCurso}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <h3 className="mb-2 text-sm font-medium text-slate-900">Novo curso</h3>
          <div className="flex flex-wrap gap-2">
            <input name="nome" placeholder="Nome" required className="input" />
            <select name="etapa_ensino" required className="input">
              <option value="infantil">Infantil</option>
              <option value="fundamental_i">Fundamental I</option>
              <option value="fundamental_ii">Fundamental II</option>
              <option value="medio">Médio</option>
            </select>
            <button className="btn">Criar</button>
          </div>
        </form>
      </div>

      <form
        onSubmit={handleCreateTurma}
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <h3 className="mb-2 text-sm font-medium text-slate-900">Nova turma</h3>
        <div className="flex flex-wrap gap-2">
          <input name="nome" placeholder="Nome" required className="input" />
          <select name="turno" required className="input">
            <option value="manha">Manhã</option>
            <option value="tarde">Tarde</option>
            <option value="integral">Integral</option>
            <option value="noite">Noite</option>
          </select>
          <input
            name="capacidade"
            type="number"
            placeholder="Capacidade"
            required
            className="input w-28"
          />
          <select name="ano_letivo_id" required className="input">
            <option value="">Ano letivo</option>
            {anosLetivos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ano}
              </option>
            ))}
          </select>
          <select name="curso_id" required className="input">
            <option value="">Curso</option>
            {cursos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <button className="btn">Criar</button>
        </div>
      </form>

      <table className="w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="px-4 py-2 font-medium text-slate-600">Turma</th>
            <th className="px-4 py-2 font-medium text-slate-600">Turno</th>
            <th className="px-4 py-2 font-medium text-slate-600">Capacidade</th>
          </tr>
        </thead>
        <tbody>
          {turmas.map((t) => (
            <tr key={t.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2">{t.nome}</td>
              <td className="px-4 py-2">{t.turno}</td>
              <td className="px-4 py-2">{t.capacidade}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Pessoas (staff/professor cadastro; alunos are created via AlunosTab)
function PessoasTab() {
  const supabase = createClient();
  const [pessoas, setPessoas] = useState<
    { id: string; nome: string; cpf: string | null; papeis: string[] }[]
  >([]);

  async function load() {
    const { data } = await supabase
      .from("pessoas")
      .select("id, nome, cpf, papeis")
      .order("nome");
    setPessoas(data ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-mount, not a render loop
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Novos usuários com acesso ao sistema (professor, secretaria, responsável) são
        criados na aba{" "}
        <a href="/equipe" className="underline">
          Equipe
        </a>
        , que envia um convite por e-mail. Esta lista mostra todas as pessoas já
        cadastradas na escola.
      </p>
      <table className="w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="px-4 py-2 font-medium text-slate-600">Nome</th>
            <th className="px-4 py-2 font-medium text-slate-600">CPF</th>
            <th className="px-4 py-2 font-medium text-slate-600">Papéis</th>
          </tr>
        </thead>
        <tbody>
          {pessoas.map((p) => (
            <tr key={p.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2">{p.nome}</td>
              <td className="px-4 py-2">{p.cpf ?? "—"}</td>
              <td className="px-4 py-2">{p.papeis.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Alunos
function AlunosTab() {
  const supabase = createClient();
  const [alunos, setAlunos] = useState<
    {
      id: string;
      matricula_codigo: string;
      status: string;
      pessoas: { nome: string } | null;
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("alunos")
      .select("id, matricula_codigo, status, pessoas(nome)")
      .order("matricula_codigo")
      .returns<
        {
          id: string;
          matricula_codigo: string;
          status: string;
          pessoas: { nome: string } | null;
        }[]
      >();
    setAlunos(data ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-mount, not a render loop
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const { data: pessoa, error: pessoaError } = await supabase
      .from("pessoas")
      .insert({
        nome: fd.get("nome"),
        data_nascimento: fd.get("data_nascimento"),
        cpf: fd.get("cpf") || null,
        papeis: ["aluno"],
      })
      .select("id")
      .single();

    if (pessoaError || !pessoa) {
      setError(pessoaError?.message ?? "Falha ao criar pessoa.");
      return;
    }

    const { error: alunoError } = await supabase.from("alunos").insert({
      pessoa_id: pessoa.id,
      matricula_codigo: fd.get("matricula_codigo"),
    });

    if (alunoError) setError(alunoError.message);
    else {
      e.currentTarget.reset();
      load();
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <form
        onSubmit={handleCreate}
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <h3 className="mb-2 text-sm font-medium text-slate-900">Novo aluno</h3>
        <div className="flex flex-wrap gap-2">
          <input name="nome" placeholder="Nome" required className="input" />
          <input name="data_nascimento" type="date" required className="input" />
          <input name="cpf" placeholder="CPF (opcional)" className="input" />
          <input
            name="matricula_codigo"
            placeholder="Código de matrícula"
            required
            className="input"
          />
          <button className="btn">Criar</button>
        </div>
      </form>

      <table className="w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="px-4 py-2 font-medium text-slate-600">Nome</th>
            <th className="px-4 py-2 font-medium text-slate-600">Matrícula</th>
            <th className="px-4 py-2 font-medium text-slate-600">Status</th>
          </tr>
        </thead>
        <tbody>
          {alunos.map((a) => (
            <tr key={a.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2">{a.pessoas?.nome}</td>
              <td className="px-4 py-2">{a.matricula_codigo}</td>
              <td className="px-4 py-2">{a.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Matrículas
function MatriculasTab() {
  const supabase = createClient();
  const [matriculas, setMatriculas] = useState<
    {
      id: string;
      status: string;
      alunos: { pessoas: { nome: string } | null } | null;
      turmas: { nome: string } | null;
    }[]
  >([]);
  const [alunos, setAlunos] = useState<
    { id: string; pessoas: { nome: string } | null }[]
  >([]);
  const [turmas, setTurmas] = useState<
    { id: string; nome: string; ano_letivo_id: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [m, a, t] = await Promise.all([
      supabase
        .from("matriculas")
        .select("id, status, alunos(pessoas(nome)), turmas(nome)")
        .returns<
          {
            id: string;
            status: string;
            alunos: { pessoas: { nome: string } | null } | null;
            turmas: { nome: string } | null;
          }[]
        >(),
      supabase
        .from("alunos")
        .select("id, pessoas(nome)")
        .returns<{ id: string; pessoas: { nome: string } | null }[]>(),
      supabase.from("turmas").select("id, nome, ano_letivo_id"),
    ]);
    setMatriculas(m.data ?? []);
    setAlunos(a.data ?? []);
    setTurmas(t.data ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-mount, not a render loop
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const turmaId = fd.get("turma_id") as string;
    const turma = turmas.find((t) => t.id === turmaId);
    if (!turma) return;

    const { error } = await supabase.from("matriculas").insert({
      aluno_id: fd.get("aluno_id"),
      turma_id: turmaId,
      ano_letivo_id: turma.ano_letivo_id,
      data: fd.get("data"),
      status: "ativa",
    });

    if (error) setError(error.message);
    else {
      e.currentTarget.reset();
      load();
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <form
        onSubmit={handleCreate}
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <h3 className="mb-2 text-sm font-medium text-slate-900">Nova matrícula</h3>
        <div className="flex flex-wrap gap-2">
          <select name="aluno_id" required className="input">
            <option value="">Aluno</option>
            {alunos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.pessoas?.nome}
              </option>
            ))}
          </select>
          <select name="turma_id" required className="input">
            <option value="">Turma</option>
            {turmas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
          <input name="data" type="date" required className="input" />
          <button className="btn">Matricular</button>
        </div>
      </form>

      <table className="w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="px-4 py-2 font-medium text-slate-600">Aluno</th>
            <th className="px-4 py-2 font-medium text-slate-600">Turma</th>
            <th className="px-4 py-2 font-medium text-slate-600">Status</th>
          </tr>
        </thead>
        <tbody>
          {matriculas.map((m) => (
            <tr key={m.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2">{m.alunos?.pessoas?.nome}</td>
              <td className="px-4 py-2">{m.turmas?.nome}</td>
              <td className="px-4 py-2">{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
