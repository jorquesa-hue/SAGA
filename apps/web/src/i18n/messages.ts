/**
 * Message catalog for the console. Keys are stable ids; pt-BR is the default
 * locale (the reference operation is Brazilian). English is provided for the
 * shell and primary flow; remaining page bodies adopt the same `t(key)` pattern
 * against this catalog.
 */
export type Locale = "pt-BR" | "en";

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "pt-BR", label: "PT" },
  { value: "en", label: "EN" },
];

export const messages: Record<Locale, Record<string, string>> = {
  "pt-BR": {
    // nav
    "nav.dashboard": "Painel",
    "nav.animals": "Animais",
    "nav.weighing": "Pesagem",
    "nav.health": "Sanidade",
    "nav.reproduction": "Reprodução",
    "nav.lots": "Lotes",
    "nav.finance": "Financeiro",
    "nav.alerts": "Alertas",
    "nav.ai": "IA",
    "nav.integrations": "Integrações",
    "nav.exports": "Exportações",
    "nav.imports": "Importar",
    "chrome.signOut": "Sair",
    "chrome.tenant": "tenant",
    "chrome.searchPlaceholder": "Buscar…",
    // sign-in
    "signin.subtitle": "Console de gestão — sessão de desenvolvimento",
    "signin.userId": "User ID (UUID)",
    "signin.tenantId": "Tenant ID (UUID)",
    "signin.platformAdmin": "Administrador de plataforma",
    "signin.submit": "Entrar",
    // dashboard
    "dashboard.title": "Painel executivo",
    "dashboard.refresh": "Atualizar",
    "dashboard.loading": "Carregando…",
    "dashboard.error": "Não foi possível carregar o painel — {error}",
    // animals
    "animals.title": "Animais",
    "animals.register": "Registrar animal",
    "animals.close": "Fechar",
    "animals.searchPlaceholder": "Buscar por ID visual…",
    "animals.allStatus": "Todos os status",
    "animals.count": "{shown} de {total}",
    "animals.empty": "Nenhum animal encontrado.",
    "animals.colVisual": "ID visual",
    "animals.colSex": "Sexo",
    "animals.colBreed": "Raça",
    "animals.colStatus": "Status",
    "animals.colTrace": "Rastreabilidade",
    "animals.export": "Exportar",
    // pagination
    "pager.prev": "‹ Anterior",
    "pager.next": "Próxima ›",
    "pager.status": "Página {page} de {pages} · {total} itens",
  },
  en: {
    "nav.dashboard": "Dashboard",
    "nav.animals": "Animals",
    "nav.weighing": "Weighing",
    "nav.health": "Health",
    "nav.reproduction": "Reproduction",
    "nav.lots": "Lots",
    "nav.finance": "Finance",
    "nav.alerts": "Alerts",
    "nav.ai": "AI",
    "nav.integrations": "Integrations",
    "nav.exports": "Exports",
    "nav.imports": "Import",
    "chrome.signOut": "Sign out",
    "chrome.tenant": "tenant",
    "chrome.searchPlaceholder": "Search…",
    "signin.subtitle": "Management console — development session",
    "signin.userId": "User ID (UUID)",
    "signin.tenantId": "Tenant ID (UUID)",
    "signin.platformAdmin": "Platform administrator",
    "signin.submit": "Sign in",
    "dashboard.title": "Executive dashboard",
    "dashboard.refresh": "Refresh",
    "dashboard.loading": "Loading…",
    "dashboard.error": "Could not load the dashboard — {error}",
    "animals.title": "Animals",
    "animals.register": "Register animal",
    "animals.close": "Close",
    "animals.searchPlaceholder": "Search by visual ID…",
    "animals.allStatus": "All statuses",
    "animals.count": "{shown} of {total}",
    "animals.empty": "No animals found.",
    "animals.colVisual": "Visual ID",
    "animals.colSex": "Sex",
    "animals.colBreed": "Breed",
    "animals.colStatus": "Status",
    "animals.colTrace": "Traceability",
    "animals.export": "Export",
    "pager.prev": "‹ Previous",
    "pager.next": "Next ›",
    "pager.status": "Page {page} of {pages} · {total} items",
  },
};
