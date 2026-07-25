import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../session.js";
import { Mark } from "../components/Mark.js";

/**
 * Local dev sign-in: the operator provides the user id and active tenant id
 * that the API's dev auth trusts. This screen is the seam an OIDC redirect
 * replaces in non-local environments.
 */
export function SignIn(): JSX.Element {
  const { signIn } = useSession();
  const { t } = useI18n();
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
      <h1 className="brand-lockup">
        <Mark size={40} title="SAGA" />
        SAGA
      </h1>
      <p className="muted">{t("signin.subtitle")}</p>
      <form onSubmit={submit}>
        <label>
          {t("signin.userId")}
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </label>
        <label>
          {t("signin.tenantId")}
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder={t("signin.tenantPlaceholder")}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={platformAdmin}
            onChange={(e) => setPlatformAdmin(e.target.checked)}
          />
          {t("signin.platformAdmin")}
        </label>
        <button type="submit" disabled={!userId || !tenantId}>
          {t("signin.submit")}
        </button>
      </form>
    </div>
  );
}
