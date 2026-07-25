import { useState, type FormEvent } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LOCALES, useI18n } from "../i18n/index.js";
import { useSession } from "../session.js";
import { TenantSettingsLoader } from "./TenantSettingsLoader.js";

const NAV = [
  { to: "/", key: "nav.dashboard", end: true },
  { to: "/animals", key: "nav.animals" },
  { to: "/weighing", key: "nav.weighing" },
  { to: "/treatments", key: "nav.health" },
  { to: "/reproduction", key: "nav.reproduction" },
  { to: "/lots", key: "nav.lots" },
  { to: "/finance", key: "nav.finance" },
  { to: "/budgets", key: "nav.budgets" },
  { to: "/alerts", key: "nav.alerts" },
  { to: "/recommendations", key: "nav.ai" },
  { to: "/integrations", key: "nav.integrations" },
  { to: "/exports", key: "nav.exports" },
  { to: "/imports", key: "nav.imports" },
  { to: "/settings", key: "nav.settings" },
];

export function Layout(): JSX.Element {
  const { session, signOut } = useSession();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const submitSearch = (e: FormEvent): void => {
    e.preventDefault();
    const term = q.trim();
    if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <div className="app">
      <TenantSettingsLoader />
      <header className="topbar">
        <span className="brand">SAGA</span>
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
        <form className="topsearch" onSubmit={submitSearch}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("chrome.searchPlaceholder")}
            aria-label="Search"
          />
        </form>
        <div className="locale">
          {LOCALES.map((l) => (
            <button
              key={l.value}
              type="button"
              className={l.value === locale ? "on" : ""}
              onClick={() => setLocale(l.value)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="session">
          {session && (
            <>
              <span className="tenant" title="tenant">
                {t("chrome.tenant")}: {session.tenantId.slice(0, 8)}…
              </span>
              <button type="button" onClick={signOut}>
                {t("chrome.signOut")}
              </button>
            </>
          )}
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
