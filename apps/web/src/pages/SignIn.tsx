import { useState, type FormEvent } from "react";
import { useSession } from "../session.js";

/**
 * Local dev sign-in: the operator provides the user id and active tenant id
 * that the API's dev auth trusts. This screen is the seam an OIDC redirect
 * replaces in non-local environments.
 */
export function SignIn(): JSX.Element {
  const { signIn } = useSession();
  const [userId, setUserId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [platformAdmin, setPlatformAdmin] = useState(false);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!userId || !tenantId) return;
    signIn({ userId: userId.trim(), tenantId: tenantId.trim(), platformAdmin });
  };

  return (
    <div className="signin">
      <h1>JK Platform</h1>
      <p className="muted">Console de gestão — sessão de desenvolvimento</p>
      <form onSubmit={submit}>
        <label>
          User ID (UUID)
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
        </label>
        <label>
          Tenant ID (UUID)
          <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="tenant uuid" />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={platformAdmin} onChange={(e) => setPlatformAdmin(e.target.checked)} />
          Administrador de plataforma
        </label>
        <button type="submit" disabled={!userId || !tenantId}>
          Entrar
        </button>
      </form>
    </div>
  );
}
