"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, LogoMark } from "@/components/brand";
import {
  IconBarChart,
  IconBuilding,
  IconClipboardCheck,
  IconGraduationCap,
  IconGrid,
  IconHome,
  IconMegaphone,
  IconMenu,
  IconUsers,
  IconWallet,
  IconX,
  type IconProps,
} from "@/components/icons";
import SignOutButton from "./sign-out-button";

// AppLayout ((app)/layout.tsx) is a Server Component; a React component
// reference is a function and can't cross the server->client boundary as a
// prop (Next.js rejects it at request time — "Functions cannot be passed
// directly to Client Components"). NavItem carries a string key instead,
// resolved to a component here, inside the client boundary.
const ICONS: Record<string, React.ComponentType<IconProps>> = {
  grid: IconGrid,
  graduationCap: IconGraduationCap,
  clipboardCheck: IconClipboardCheck,
  wallet: IconWallet,
  home: IconHome,
  megaphone: IconMegaphone,
  barChart: IconBarChart,
  building: IconBuilding,
  users: IconUsers,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

function initials(nome: string) {
  const parts = nome.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (first + last).toUpperCase();
}

export default function AppNav({
  items,
  nome,
  papelLabel,
}: {
  items: NavItem[];
  nome: string;
  papelLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Both /financeiro and /financeiro/relatorios are menu entries, so a plain
  // startsWith would light up two items at once on the nested route. Only the
  // longest matching entry wins.
  const matches = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const activeHref = items
    .map((it) => it.href)
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;
  const activeLabel = items.find((it) => it.href === activeHref)?.label ?? "";

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const navLinks = (onNavigate?: () => void) => (
    <nav aria-label="Principal" className="flex flex-col gap-0.5 px-3">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={onNavigate}
            aria-current={isActive(it.href) ? "page" : undefined}
            className="sidebar-link"
          >
            <Icon className="h-[18px] w-[18px]" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-900 lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Link href="/dashboard" aria-label={`${nome} — início`}>
            <Logo size={30} inverted />
          </Link>
        </div>
        <div className="mt-2 flex-1 overflow-y-auto pb-4">{navLinks()}</div>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white">
              {initials(nome)}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-white">{nome}</span>
              <span className="block truncate text-[0.7rem] text-brand-200">
                {papelLabel}
              </span>
            </span>
            <SignOutButton iconOnly />
          </div>
        </div>
      </aside>

      {/* Mobile topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="menu-mobile"
          aria-label="Abrir menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-700 hover:bg-ink-100"
        >
          <IconMenu className="h-5 w-5" />
        </button>
        <span className="truncate text-sm font-semibold text-ink-800">{activeLabel}</span>
        <Link href="/dashboard" aria-label="Início">
          <LogoMark size={26} />
        </Link>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-900/50"
          />
          <div
            id="menu-mobile"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-900 shadow-lg"
          >
            <div className="flex items-center justify-between px-5 py-5">
              <Logo size={28} inverted />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-2 flex-1 overflow-y-auto pb-4">
              {navLinks(() => setOpen(false))}
            </div>
            <div className="border-t border-white/10 p-3">
              <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white">
                  {initials(nome)}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-medium text-white">
                    {nome}
                  </span>
                  <span className="block truncate text-[0.7rem] text-brand-200">
                    {papelLabel}
                  </span>
                </span>
                <SignOutButton iconOnly />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
