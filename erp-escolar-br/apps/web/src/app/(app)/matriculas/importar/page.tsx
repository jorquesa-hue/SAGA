"use client";

import Link from "next/link";
import ImportarMatriculas from "@/features/importar-matriculas";

export default function ImportarMatriculasPage() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/matriculas" className="btn-link text-sm">
          ← Voltar para Matrículas
        </Link>
        <h1 className="h-page mt-2">Importar matrículas</h1>
        <p className="subtle mt-1">
          Para escolas que já estão operando: sobe de uma vez alunos, responsáveis,
          matrículas, contratos, parcelas e as mensalidades já quitadas. Tudo é conferido
          antes — se uma linha tiver erro, nenhuma é gravada.
        </p>
      </div>
      <ImportarMatriculas />
    </div>
  );
}
