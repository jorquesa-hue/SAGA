"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand";
import SignOutButton from "./sign-out-button";

export interface NavItem {
  href: string;
  label: string;
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

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/dashboard" aria-label={`${nome} — início`}>
          <Logo size={30} />
        </Link>

        {/* Desktop navigation */}
        <nav aria-label="Principal" className="hidden md:flex md:items-center md:gap-1">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              aria-current={isActive(it.href) ? "page" : undefined}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
                isActive(it.href)
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
              }`}
            >
              {it.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <span className="text-right leading-tight">
            <span className="block text-sm font-medium text-ink-800">{nome}</span>
            <span className="block text-[0.7rem] text-ink-500">{papelLabel}</span>
          </span>
          <SignOutButton />
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="menu-mobile"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-ink-300 text-ink-700 md:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {open ? (
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M3 6h14M3 10h14M3 14h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile panel */}
      {open && (
        <div id="menu-mobile" className="border-t border-ink-200 bg-white md:hidden">
          <nav aria-label="Principal" className="flex flex-col p-2">
            {items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(it.href) ? "page" : undefined}
                className={`rounded-md px-3 py-2.5 text-sm font-medium ${
                  isActive(it.href)
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-700 hover:bg-ink-100"
                }`}
              >
                {it.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center justify-between border-t border-ink-200 px-4 py-3">
            <span className="leading-tight">
              <span className="block text-sm font-medium text-ink-800">{nome}</span>
              <span className="block text-[0.7rem] text-ink-500">{papelLabel}</span>
            </span>
            <SignOutButton />
          </div>
        </div>
      )}
    </header>
  );
}
