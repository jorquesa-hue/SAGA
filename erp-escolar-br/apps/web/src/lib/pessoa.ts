import { createClient } from "@/lib/supabase/server";

export interface CurrentPessoa {
  id: string;
  escola_id: string;
  nome: string;
  papeis: string[];
}

// Looks up the caller's own pessoas row by auth_user_id. Works regardless
// of whether the Custom Access Token Hook is enabled yet (RLS's
// pessoas_select_self policy grants self-visibility unconditionally — see
// erp-escolar-br/README.md), unlike most other reads in this app which do
// depend on the escola_role JWT claim the hook stamps.
export async function getCurrentPessoa(): Promise<CurrentPessoa | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("pessoas")
    .select("id, escola_id, nome, papeis")
    .eq("auth_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  return data as CurrentPessoa | null;
}
