"use client";

import { useState } from "react";

// O texto e o hash nunca são calculados aqui. Chegam prontos do servidor
// (fn_contrato_texto) e, na hora de assinar, são gerados de novo lá dentro
// por fn_assinar_contrato. O que este componente faz é mostrar o que será
// assinado e coletar a manifestação de vontade — que é o que a Lei
// 14.063/2020 pede da assinatura eletrônica simples.
export interface ContratoParaAssinar {
  contrato_id: string;
  aluno_nome: string;
  ano: number;
  texto: string;
  // Preenchidos quando já existe assinatura: viram comprovante.
  assinatura?: {
    assinado_em: string;
    documento_hash: string;
    signatario_nome: string;
    ip: string;
  } | null;
}

const ERROS: Record<string, string> = {
  contrato_ja_assinado: "Este contrato já foi assinado.",
  contrato_nao_encontrado:
    "Este contrato não está disponível para você assinar. Fale com a secretaria.",
  unauthorized: "Sua sessão expirou. Entre novamente.",
};

function mensagem(erro: string) {
  const chave = Object.keys(ERROS).find((k) => erro.includes(k));
  return chave ? ERROS[chave] : "Não foi possível registrar a assinatura.";
}

function baixarTexto(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AssinaturaForm({ contrato }: { contrato: ContratoParaAssinar }) {
  const [assinatura, setAssinatura] = useState(contrato.assinatura ?? null);
  const [aceito, setAceito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aberto, setAberto] = useState(false);

  async function assinar() {
    setErro(null);
    setEnviando(true);
    const res = await fetch("/api/assinar-contrato", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contrato_id: contrato.contrato_id }),
    });
    const data = await res.json().catch(() => ({}));
    setEnviando(false);

    if (!res.ok) {
      setErro(mensagem(String(data.error ?? "")));
      return;
    }
    // O comprovante completo (hash, IP) é relido do banco no próximo
    // carregamento da página — aqui basta sair do estado "pendente" sem
    // inventar dados que o servidor é quem conhece.
    setAssinatura({
      assinado_em: new Date().toISOString(),
      documento_hash: "",
      signatario_nome: "",
      ip: "",
    });
  }

  // NFD separa o acento da letra; o filtro alfanumérico logo abaixo come o
  // acento solto junto com o resto. Um segundo replace com a faixa de
  // diacríticos seria redundante — e o Prettier normaliza `\u0300-\u036F`
  // para os caracteres combinantes de verdade, que ficam invisíveis no
  // código.
  const nomeArquivo = `contrato-${contrato.aluno_nome
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()}-${contrato.ano}.txt`;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="h-card">{contrato.aluno_nome}</h3>
          <p className="text-xs text-slate-500">Ano letivo {contrato.ano}</p>
        </div>
        {assinatura ? (
          <span className="badge badge-ok">Assinado</span>
        ) : (
          <span className="badge badge-warn">Aguardando assinatura</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="btn-link mt-3"
      >
        {aberto ? "Ocultar contrato" : "Ler o contrato"}
      </button>

      {aberto && (
        <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-800">
          {contrato.texto}
        </pre>
      )}

      {assinatura ? (
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          <p>
            Assinado em {new Date(assinatura.assinado_em).toLocaleString("pt-BR")}
            {assinatura.signatario_nome ? ` por ${assinatura.signatario_nome}` : ""}
            {assinatura.ip ? ` — IP ${assinatura.ip}` : ""}
          </p>
          {assinatura.documento_hash && (
            // O hash é o que liga esta assinatura a ESTE texto. Fica à
            // vista para que a família possa conferir depois que o
            // documento guardado é o mesmo que ela aceitou.
            <p className="font-mono break-all">SHA-256: {assinatura.documento_hash}</p>
          )}
          <button
            type="button"
            onClick={() => baixarTexto(nomeArquivo, contrato.texto)}
            className="btn-link"
          >
            Baixar uma cópia
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={aceito}
              onChange={(e) => setAceito(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Li o contrato acima e concordo com as condições. Entendo que esta assinatura
              eletrônica registra meu nome, meu CPF, a data, o endereço IP usado e uma
              impressão digital (SHA-256) do texto exato que estou aceitando.
            </span>
          </label>
          <button
            type="button"
            onClick={assinar}
            disabled={!aceito || enviando}
            className="btn"
          >
            {enviando ? "Registrando..." : "Assinar contrato"}
          </button>
        </div>
      )}
    </div>
  );
}
