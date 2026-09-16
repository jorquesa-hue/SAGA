"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Client-side counterpart to getCurrentPessoa (pessoa.ts) for client
// components that only need the caller's papeis (e.g. to show/hide a
// staff-only form) — avoids a server round-trip for that one field.
export function useCurrentPapeis(): string[] {
  const [papeis, setPapeis] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("pessoas")
        .select("papeis")
        .eq("auth_user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (data) setPapeis(data.papeis);
    });
  }, []);

  return papeis;
}
