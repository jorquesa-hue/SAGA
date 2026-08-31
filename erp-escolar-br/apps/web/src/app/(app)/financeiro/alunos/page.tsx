import { redirect } from "next/navigation";

// The student search moved to the top of /alunos, where the student register
// lives. Kept as a redirect for links shared before the move.
export default function FinanceiroAlunosRedirect() {
  redirect("/alunos");
}
