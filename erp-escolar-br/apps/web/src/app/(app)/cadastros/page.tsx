import { redirect } from "next/navigation";

// "Cadastros" was one page with six tabs. Those tabs are now the stages of the
// student life cycle (/alunos, /matriculas, /escola, /equipe). Kept as a
// redirect so older links and bookmarks still land somewhere sensible.
export default function CadastrosRedirect() {
  redirect("/alunos");
}
