import { NavLink, Outlet } from "react-router-dom";
import { useSession } from "../session.js";

const NAV = [
  { to: "/", label: "Painel", end: true },
  { to: "/animals", label: "Animais" },
  { to: "/recommendations", label: "IA (recomendações)" },
];

export function Layout(): JSX.Element {
  const { session, signOut } = useSession();
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
