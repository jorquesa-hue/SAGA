"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentPapeis } from "@/lib/use-current-papeis";

// Importação em lote — a migração de uma escola que já opera.
//
// Toda a regra de negócio vive em fn_importar_matriculas (migração 0025),
// não aqui: o app fala direto com o PostgREST (spec §3.7), então qualquer
// validação que só existisse neste arquivo seria contornável por um POST
// direto em /rest/v1/rpc/fn_importar_matriculas. O que esta tela faz é ler
// o CSV, conferir o cabeçalho e apresentar o relatório que o banco devolve.
//
// O fluxo é de três passos por opção, não por limitação: escolher o
// arquivo, simular (dry-run, que não escreve nada) e só então confirmar.
// Uma importação cria centenas de linhas em nove tabelas de uma vez; ver
// antes o que vai acontecer é a diferença entre migrar e ter que desfazer.

interface Coluna {
  chave: string;
  obrigatoria: boolean;
  exemplo: string;
  descricao: string;
}

const COLUNAS: Coluna[] = [
  {
    chave: "matricula_codigo",
    obrigatoria: true,
    exemplo: "2026-0001",
    descricao:
      "Código do aluno na escola. É a chave da importação: reenviar a mesma planilha não duplica o aluno.",
  },
  {
    chave: "aluno_nome",
    obrigatoria: true,
    exemplo: "Ana Beatriz Souza",
    descricao: "Nome completo do aluno.",
  },
  {
    chave: "aluno_data_nascimento",
    obrigatoria: true,
    exemplo: "12/03/2015",
    descricao: "DD/MM/AAAA ou AAAA-MM-DD.",
  },
  {
    chave: "aluno_cpf",
    obrigatoria: false,
    exemplo: "",
    descricao: "Opcional. Se informado, é validado pelo dígito verificador.",
  },
  {
    chave: "turma_nome",
    obrigatoria: true,
    exemplo: "5º Ano A",
    descricao:
      "A turma precisa existir antes (Escola → Turmas). A importação nunca cria turmas.",
  },
  {
    chave: "ano_letivo",
    obrigatoria: false,
    exemplo: "2026",
    descricao: "Só é necessário se houver mais de uma turma com o mesmo nome.",
  },
  {
    chave: "matricula_data",
    obrigatoria: false,
    exemplo: "05/01/2026",
    descricao: "Padrão: a data de assinatura do contrato.",
  },
  {
    chave: "matricula_status",
    obrigatoria: false,
    exemplo: "ativa",
    descricao: "ativa, pre, trancada, transferida ou concluida. Padrão: ativa.",
  },
  {
    chave: "responsavel_nome",
    obrigatoria: true,
    exemplo: "Marina Souza",
    descricao: "Responsável financeiro e pedagógico do aluno.",
  },
  {
    chave: "responsavel_data_nascimento",
    obrigatoria: true,
    exemplo: "22/07/1986",
    descricao: "Obrigatória: o cadastro de pessoas exige data de nascimento.",
  },
  {
    chave: "responsavel_cpf",
    obrigatoria: false,
    exemplo: "",
    descricao:
      "Opcional, mas recomendado: é o que impede duplicar o responsável de dois irmãos.",
  },
  {
    chave: "responsavel_vinculo",
    obrigatoria: true,
    exemplo: "mae",
    descricao: "mae, pai, avô, avó, tutor_legal ou outro.",
  },
  {
    chave: "contrato_valor_anuidade",
    obrigatoria: true,
    exemplo: "12000,00",
    descricao: "Valor total do ano, não da mensalidade.",
  },
  {
    chave: "contrato_num_parcelas",
    obrigatoria: true,
    exemplo: "12",
    descricao: "De 1 a 12.",
  },
  {
    chave: "contrato_vencimento_dia",
    obrigatoria: true,
    exemplo: "10",
    descricao: "De 1 a 28 (dia 29, 30 e 31 não existem em todo mês).",
  },
  {
    chave: "contrato_assinado_em",
    obrigatoria: true,
    exemplo: "05/01/2026",
    descricao: "Define o mês da primeira parcela. As demais seguem mês a mês.",
  },
  {
    chave: "desconto_tipo",
    obrigatoria: false,
    exemplo: "",
    descricao: "bolsa, irmao, pontualidade ou convenio.",
  },
  {
    chave: "desconto_percentual",
    obrigatoria: false,
    exemplo: "",
    descricao: "Percentual sobre a parcela (0 a 100).",
  },
  {
    chave: "desconto_valor",
    obrigatoria: false,
    exemplo: "",
    descricao: "Valor fixo abatido da parcela. Use um ou outro.",
  },
  {
    chave: "parcelas_pagas_ate",
    obrigatoria: false,
    exemplo: "06/2026",
    descricao:
      "Competência até a qual já está tudo quitado. As parcelas até esse mês entram como pagas; as vencidas depois, como atrasadas.",
  },
];

const LIMITE_LINHAS = 2000;

interface LinhaRelatorio {
  linha: number;
  acao: string;
  aluno: string | null;
  matricula_codigo: string | null;
  turma: string | null;
  erros: string[];
  avisos: string[];
}

interface Relatorio {
  ok: boolean;
  dry_run: boolean;
  total_linhas: number;
  linhas_a_criar: number;
  linhas_ja_importadas: number;
  linhas_com_erro: number;
  linhas_importadas: number;
  linhas: LinhaRelatorio[];
  importacao_id?: string;
}

interface ImportacaoAnterior {
  id: string;
  arquivo_nome: string | null;
  status: string;
  total_linhas: number;
  linhas_importadas: number;
  created_at: string;
}

// ── CSV ────────────────────────────────────────────────────────────────────

// Parser próprio em vez de uma dependência: o formato que interessa é o que
// o Excel em pt-BR exporta (separador ";", aspas duplas escapadas por
// duplicação, CRLF, BOM), e isso cabe numa máquina de estados de 30 linhas.
function parseCsv(texto: string, delim: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let entreAspas = false;
  let i = 0;

  while (i < texto.length) {
    const ch = texto[i];
    if (entreAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        entreAspas = false;
        i += 1;
        continue;
      }
      campo += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      entreAspas = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      linha.push(campo);
      campo = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
      i += 1;
      continue;
    }
    campo += ch;
    i += 1;
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

function detectarDelimitador(primeiraLinha: string) {
  const pontoEVirgula = (primeiraLinha.match(/;/g) ?? []).length;
  const virgula = (primeiraLinha.match(/,/g) ?? []).length;
  return pontoEVirgula >= virgula ? ";" : ",";
}

// "Aluno Nome", "ALUNO_NOME" e "aluno nome" são o mesmo cabeçalho: quem
// preenche a planilha não deveria precisar acertar maiúscula nem acento.
function normalizarCabecalho(s: string) {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function csvTemplate() {
  const header = COLUNAS.map((c) => c.chave);
  const exemplo = COLUNAS.map((c) => c.exemplo);
  const escapar = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const csv = [header, exemplo].map((l) => l.map(escapar).join(";")).join("\r\n");
  // BOM: sem ele o Excel lê o arquivo como Latin-1 e quebra todo acento.
  return "\uFEFF" + csv + "\r\n";
}

// ── Componente ─────────────────────────────────────────────────────────────

const STAFF_PAPEIS = ["admin", "secretaria"];

export default function ImportarMatriculas() {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const papeis = useCurrentPapeis();

  const [arquivoNome, setArquivoNome] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<Record<string, string>[]>([]);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [colunasIgnoradas, setColunasIgnoradas] = useState<string[]>([]);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [anteriores, setAnteriores] = useState<ImportacaoAnterior[]>([]);

  async function carregarAnteriores() {
    const { data } = await supabase
      .from("importacoes")
      .select("id, arquivo_nome, status, total_linhas, linhas_importadas, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    setAnteriores((data ?? []) as ImportacaoAnterior[]);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial, não é laço de render
    carregarAnteriores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function baixarTemplate() {
    const blob = new Blob([csvTemplate()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-importacao-matriculas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function limpar() {
    setArquivoNome(null);
    setLinhas([]);
    setErroArquivo(null);
    setColunasIgnoradas([]);
    setErroServidor(null);
    setRelatorio(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleArquivo(file: File) {
    setErroArquivo(null);
    setColunasIgnoradas([]);
    setErroServidor(null);
    setRelatorio(null);
    setLinhas([]);
    setArquivoNome(file.name);

    const texto = (await file.text()).replace(/^\uFEFF/, "");
    const primeiraQuebra = texto.indexOf("\n");
    const cabecalhoBruto = primeiraQuebra === -1 ? texto : texto.slice(0, primeiraQuebra);
    const delim = detectarDelimitador(cabecalhoBruto);
    const matriz = parseCsv(texto, delim).filter((l) => l.some((c) => c.trim() !== ""));

    if (matriz.length === 0) {
      setErroArquivo("O arquivo está vazio.");
      return;
    }
    const cabecalho = matriz[0].map(normalizarCabecalho);
    const conhecidas = new Set(COLUNAS.map((c) => c.chave));
    const faltando = COLUNAS.filter(
      (c) => c.obrigatoria && !cabecalho.includes(c.chave),
    ).map((c) => c.chave);

    if (faltando.length > 0) {
      setErroArquivo(
        `Faltam colunas obrigatórias no cabeçalho: ${faltando.join(", ")}. ` +
          "Baixe o modelo e use os mesmos nomes de coluna.",
      );
      return;
    }

    const corpo = matriz.slice(1);
    if (corpo.length === 0) {
      setErroArquivo("O arquivo só tem o cabeçalho, sem nenhuma linha de dados.");
      return;
    }
    if (corpo.length > LIMITE_LINHAS) {
      setErroArquivo(
        `O arquivo tem ${corpo.length} linhas; o limite por importação é ${LIMITE_LINHAS}. Divida em arquivos menores.`,
      );
      return;
    }

    const registros = corpo.map((l) => {
      const obj: Record<string, string> = {};
      cabecalho.forEach((chave, idx) => {
        if (conhecidas.has(chave)) obj[chave] = (l[idx] ?? "").trim();
      });
      return obj;
    });

    setLinhas(registros);
    // Não é erro: a planilha da escola costuma trazer colunas extras
    // (telefone, observações) que o sistema ainda não modela.
    setColunasIgnoradas(cabecalho.filter((c) => c !== "" && !conhecidas.has(c)));
  }

  async function executar(dryRun: boolean) {
    setOcupado(true);
    setErroServidor(null);
    const { data, error } = await supabase.rpc("fn_importar_matriculas", {
      p_linhas: linhas,
      p_dry_run: dryRun,
      p_arquivo_nome: arquivoNome,
    });
    setOcupado(false);
    if (error) {
      setErroServidor(error.message);
      return;
    }
    setRelatorio(data as Relatorio);
    if (!dryRun) carregarAnteriores();
  }

  const podeImportar =
    relatorio !== null &&
    relatorio.dry_run &&
    relatorio.ok &&
    relatorio.linhas_a_criar > 0;
  const concluida = relatorio !== null && !relatorio.dry_run && relatorio.ok;

  const comProblema = relatorio
    ? relatorio.linhas.filter((l) => l.erros.length > 0 || l.avisos.length > 0)
    : [];

  // O link no menu só aparece para staff, mas a rota continua alcançável
  // pela URL. Sem isto, um responsável baixaria o modelo, preencheria a
  // planilha inteira e só descobriria que não pode importar ao clicar em
  // "Simular", na forma de um erro cru vindo do Postgres. A RLS já barra a
  // escrita; o que falta aqui é dizer isso antes do trabalho, não depois.
  // papeis vazio é o estado de carregamento, não "sem papel nenhum" — daí
  // o length > 0, que evita piscar o aviso para quem tem permissão.
  if (papeis.length > 0 && !papeis.some((p) => STAFF_PAPEIS.includes(p))) {
    return (
      <p className="alert alert-warn">
        A importação de matrículas é restrita a admin e secretaria.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1 — modelo */}
      <section className="card space-y-3">
        <h2 className="h-section">1. Baixe o modelo</h2>
        <p className="subtle">
          Uma linha por matrícula: aluno, responsável, turma, contrato e até onde as
          mensalidades já estão quitadas. Cadastre antes as turmas do ano letivo — a
          importação não cria turmas, para não inventar etapa, turno e capacidade.
        </p>
        <button type="button" onClick={baixarTemplate} className="btn btn-secondary">
          Baixar modelo CSV
        </button>
        <details className="pt-1">
          <summary className="btn-link cursor-pointer text-sm">
            Ver as {COLUNAS.length} colunas
          </summary>
          <div className="table-wrap mt-3">
            <table>
              <thead>
                <tr>
                  <th>Coluna</th>
                  <th>Obrigatória</th>
                  <th>Exemplo</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {COLUNAS.map((c) => (
                  <tr key={c.chave}>
                    <td className="whitespace-nowrap font-mono text-xs">{c.chave}</td>
                    <td>{c.obrigatoria ? "Sim" : "Não"}</td>
                    <td className="whitespace-nowrap text-xs">{c.exemplo || "—"}</td>
                    <td className="text-xs">{c.descricao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* 2 — arquivo */}
      <section className="card space-y-3">
        <h2 className="h-section">2. Escolha o arquivo preenchido</h2>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleArquivo(f);
          }}
          className="input"
        />
        {erroArquivo && <p className="alert alert-danger">{erroArquivo}</p>}
        {colunasIgnoradas.length > 0 && (
          <p className="alert alert-warn">
            Colunas não reconhecidas serão ignoradas: {colunasIgnoradas.join(", ")}.
          </p>
        )}
        {linhas.length > 0 && !erroArquivo && (
          <p className="text-sm text-ink-700">
            <strong>{linhas.length}</strong>{" "}
            {linhas.length === 1 ? "linha lida" : "linhas lidas"} de{" "}
            <span className="font-mono text-xs">{arquivoNome}</span>.
          </p>
        )}
      </section>

      {/* 3 — simulação */}
      <section className="card space-y-3">
        <h2 className="h-section">3. Simule antes de importar</h2>
        <p className="subtle">
          A simulação confere linha por linha e não grava nada. Se qualquer linha tiver
          erro, nada é importado — corrija a planilha e simule de novo.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => executar(true)}
            disabled={ocupado || linhas.length === 0 || !!erroArquivo}
            className="btn"
          >
            {ocupado ? "Processando..." : "Simular importação"}
          </button>
          {(relatorio || arquivoNome) && (
            <button type="button" onClick={limpar} className="btn btn-secondary">
              Recomeçar
            </button>
          )}
        </div>
        {erroServidor && <p className="alert alert-danger">{erroServidor}</p>}
      </section>

      {/* Relatório */}
      {relatorio && (
        <section className="card space-y-4">
          <h2 className="h-section">
            {relatorio.dry_run ? "Resultado da simulação" : "Resultado da importação"}
          </h2>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Linhas no arquivo" value={String(relatorio.total_linhas)} />
            <Stat
              label={relatorio.dry_run ? "Serão criadas" : "Importadas"}
              value={String(
                relatorio.dry_run
                  ? relatorio.linhas_a_criar
                  : relatorio.linhas_importadas,
              )}
            />
            <Stat label="Já existiam" value={String(relatorio.linhas_ja_importadas)} />
            <Stat label="Com erro" value={String(relatorio.linhas_com_erro)} />
          </div>

          {!relatorio.ok && (
            <p className="alert alert-danger">
              {relatorio.linhas_com_erro}{" "}
              {relatorio.linhas_com_erro === 1 ? "linha precisa" : "linhas precisam"} de
              correção. Nada foi gravado.
            </p>
          )}
          {concluida && (
            <p className="alert alert-ok">
              Importação concluída: {relatorio.linhas_importadas}{" "}
              {relatorio.linhas_importadas === 1
                ? "matrícula criada"
                : "matrículas criadas"}
              , com contrato, parcelas e pagamentos já quitados.
            </p>
          )}

          {comProblema.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Aluno</th>
                    <th>O que precisa de atenção</th>
                  </tr>
                </thead>
                <tbody>
                  {comProblema.map((l) => (
                    <tr key={l.linha}>
                      <td className="whitespace-nowrap">{l.linha}</td>
                      <td>{l.aluno ?? "—"}</td>
                      <td>
                        <ul className="space-y-1">
                          {l.erros.map((e, i) => (
                            <li key={`e${i}`} className="text-sm text-red-700">
                              {e}
                            </li>
                          ))}
                          {l.avisos.map((a, i) => (
                            <li key={`a${i}`} className="text-sm text-amber-700">
                              {a}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {relatorio.ok && relatorio.dry_run && relatorio.linhas_a_criar === 0 && (
            <p className="alert alert-warn">
              Todas as linhas do arquivo já estão no sistema. Nada a importar.
            </p>
          )}

          {podeImportar && (
            <div className="space-y-2 border-t border-ink-200 pt-4">
              <p className="text-sm text-ink-700">
                Confirmar cria <strong>{relatorio.linhas_a_criar}</strong>{" "}
                {relatorio.linhas_a_criar === 1 ? "matrícula" : "matrículas"} com seus
                contratos, parcelas e pagamentos. Não há desfazer automático.
              </p>
              <button
                type="button"
                onClick={() => executar(false)}
                disabled={ocupado}
                className="btn"
              >
                {ocupado
                  ? "Importando..."
                  : `Confirmar importação de ${relatorio.linhas_a_criar} ${
                      relatorio.linhas_a_criar === 1 ? "matrícula" : "matrículas"
                    }`}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Histórico */}
      {anteriores.length > 0 && (
        <section className="card space-y-3">
          <h2 className="h-section">Importações anteriores</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Arquivo</th>
                  <th>Situação</th>
                  <th>Importadas</th>
                </tr>
              </thead>
              <tbody>
                {anteriores.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">
                      {new Date(a.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="text-xs">{a.arquivo_nome ?? "—"}</td>
                    <td>
                      <span
                        className={
                          a.status === "concluida"
                            ? "badge badge-ok"
                            : "badge badge-danger"
                        }
                      >
                        {a.status === "concluida" ? "Concluída" : "Reprovada"}
                      </span>
                    </td>
                    <td>
                      {a.linhas_importadas} de {a.total_linhas}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <p className="subtle">{label}</p>
      <p className="text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
    </div>
  );
}
