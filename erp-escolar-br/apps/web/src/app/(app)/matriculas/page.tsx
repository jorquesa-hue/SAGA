"use client";

import Link from "next/link";
import { MatriculasTab } from "@/features/cadastros";

export default function MatriculasPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h-page">Matrículas</h1>
          <p className="subtle mt-1">
            Vincula um aluno já cadastrado a uma turma do ano letivo. A matrícula é o que
            torna o aluno cobrável: o contrato e as parcelas são gerados a partir dela, em
            Financeiro.
          </p>
        </div>
        <Link href="/matriculas/importar" className="btn btn-secondary whitespace-nowrap">
          Importar planilha
        </Link>
      </div>
      <MatriculasTab />
    </div>
  );
}
