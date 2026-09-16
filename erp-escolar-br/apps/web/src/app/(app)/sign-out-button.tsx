"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconLogOut } from "@/components/icons";

export default function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={handleSignOut}
        aria-label="Sair"
        title="Sair"
        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-brand-200 hover:bg-white/10 hover:text-white"
      >
        <IconLogOut className="h-[18px] w-[18px]" />
      </button>
    );
  }

  return (
    <button type="button" onClick={handleSignOut} className="btn btn-secondary">
      <IconLogOut className="h-4 w-4" />
      Sair
    </button>
  );
}
