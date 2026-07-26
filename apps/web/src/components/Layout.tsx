import { useState, type FormEvent } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LOCALES, useI18n } from "../i18n/index.js";
import { useSession } from "../session.js";
import { TenantSettingsLoader } from "./TenantSettingsLoader.js";
import { Mark } from "./Mark.js";

const NAV = [
  { to: "/", key: "nav.dashboard", end: true },
  { to: "/animals", key: "nav.animals" },
  { to: "/weighing", key: "nav.weighing" },
  { to: "/treatments", key: "nav.health" },
  { to: "/reproduction", key: "nav.reproduction" },
  { to: "/lots", key: "nav.lots" },
  { to: "/pasture", key: "nav.pasture" },
  { to: "/inventory", key: "nav.inventory" },
  { to: "/assets", key: "nav.assets" },
  { to: "/genetics", key: "nav.genetics" },
  { to: "/finance", key: "nav.finance" },
  { to: "/budgets", key: "nav.budgets" },
  { to: "/tasks", key: "nav.tasks" },
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
  // Nineteen destinations wrap into a full-screen wall on a phone, so on narrow
  // viewports the menu collapses behind a toggle. On desktop the wrapper is
  // display:contents and this flag does nothing — the bar looks exactly as before.
  const [menuOpen, setMenuOpen] = useState(false);

  const submitSearch = (e: FormEvent): void => {
    e.preventDefault();
    const term = q.trim();
    if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
    setMenuOpen(false);
  };

  return (
    <div className="app">
      <TenantSettingsLoader />
      <header className="topbar">
        <div className="topbar-bar">
          <span className="brand">
            <Mark size={22} title="SAGA" />
            SAGA
          </span>
          <button
            type="button"
            className="menu-toggle"
            aria-label={t(menuOpen ? "chrome.menuClose" : "chrome.menuOpen")}
            aria-expanded={menuOpen}
            aria-controls="topbar-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              {menuOpen ? (
                <path
                  d="M5 5l12 12M17 5L5 17"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M3 6h16M3 11h16M3 16h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
        <div id="topbar-menu" className={`topbar-menu${menuOpen ? " open" : ""}`}>
          <nav className="nav">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={() => setMenuOpen(false)}
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
              aria-label={t("chrome.searchLabel")}
            />
          </form>
          <div className="locale">
            {LOCALES.map((l) => (
              <button
                key={l.value}
                type="button"
                className={l.value === locale ? "on" : ""}
                onClick={() => {
                  setLocale(l.value);
                  // Close the mobile menu so the choice is visible immediately —
                  // otherwise the open menu covers the page and the switch looks
                  // like it did nothing (it did: the whole console re-renders).
                  setMenuOpen(false);
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="session">
            {session && (
              <>
                <span className="tenant" title={t("chrome.tenantTitle")}>
                  {t("chrome.tenant")}: {session.tenantId.slice(0, 8)}…
                </span>
                <button type="button" onClick={signOut}>
                  {t("chrome.signOut")}
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
