import { useState, type FormEvent } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSession } from "../session.js";

const NAV = [
  { to: "/", label: "Painel", end: true },
  { to: "/animals", label: "Animais" },
  { to: "/weighing", label: "Pesagem" },
  { to: "/treatments", label: "Sanidade" },
  { to: "/reproduction", label: "Reprodução" },
  { to: "/lots", label: "Lotes" },
  { to: "/finance", label: "Financeiro" },
  { to: "/alerts", label: "Alertas" },
  { to: "/recommendations", label: "IA" },
  { to: "/integrations", label: "Integrações" },
  { to: "/exports", label: "Exportações" },
];

export function Layout(): JSX.Element {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const submitSearch = (e: FormEvent): void => {
    e.preventDefault();
    const term = q.trim();
    if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">JK Platform</span>
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <form className="topsearch" onSubmit={submitSearch}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" aria-label="Busca global" />
        </form>
        <div className="session">
          {session && (
            <>
              <span className="tenant" title="Tenant ativo">
                tenant: {session.tenantId.slice(0, 8)}…
              </span>
              <button type="button" onClick={signOut}>
                Sair
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
