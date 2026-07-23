import { JkPlatformClient, type FetchLike } from "@jk/contracts-rest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Treatments } from "../src/pages/Treatments.js";
import { Finance } from "../src/pages/Finance.js";
import { Weighing } from "../src/pages/Weighing.js";
import { Reproduction } from "../src/pages/Reproduction.js";
import { Lots } from "../src/pages/Lots.js";
import { Imports } from "../src/pages/Imports.js";
import { Animals } from "../src/pages/Animals.js";
import { I18nProvider, type Locale } from "../src/i18n/index.js";
import { SessionProvider, type Session } from "../src/session.js";

const session: Session = { userId: "u1", tenantId: "t-1", platformAdmin: false };

function client(items: unknown[] = []): JkPlatformClient {
  const fetch: FetchLike = async () => ({ status: 200, headers: { get: () => "c" }, text: async () => JSON.stringify({ items }) });
  return new JkPlatformClient({ baseUrl: "http://api.test", tenantId: "t", auth: { mode: "none" }, fetch });
}

function renderPage(node: JSX.Element, locale: Locale, c: JkPlatformClient = client()) {
  return render(
    <MemoryRouter>
      <I18nProvider initialLocale={locale}>
        <SessionProvider initialSession={session} clientFactory={() => c}>
          {node}
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("i18n page bodies", () => {
  it("renders command screens in pt-BR by default", () => {
    renderPage(<Treatments />, "pt-BR");
    expect(screen.getByText("Registrar tratamento")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ex.: Ivermectina")).toBeInTheDocument();
  });

  it("translates the treatments screen into English", () => {
    renderPage(<Treatments />, "en");
    expect(screen.getByText("Record treatment")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Ivermectin")).toBeInTheDocument();
    expect(screen.queryByText("Registrar tratamento")).not.toBeInTheDocument();
  });

  it("translates the finance screen into English", () => {
    renderPage(<Finance />, "en");
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("Record sale")).toBeInTheDocument();
  });

  it("translates the weighing screen into English", () => {
    renderPage(<Weighing />, "en");
    expect(screen.getByRole("heading", { level: 2, name: "Weighing" })).toBeInTheDocument();
    expect(screen.getByText("Start handling session")).toBeInTheDocument();
  });

  it("translates the reproduction screen into English", () => {
    renderPage(<Reproduction />, "en");
    expect(screen.getByText("Reproduction")).toBeInTheDocument();
    expect(screen.getByText("Service / breeding")).toBeInTheDocument();
    expect(screen.getByText("Calving")).toBeInTheDocument();
  });

  it("translates the lots screen into English", () => {
    renderPage(<Lots />, "en");
    expect(screen.getByText("Lots and movements")).toBeInTheDocument();
    expect(screen.getByText("Create lot")).toBeInTheDocument();
  });

  it("translates the import wizard stepper into English", () => {
    renderPage(<Imports />, "en");
    expect(screen.getByText("Import data")).toBeInTheDocument();
    expect(screen.getByText("1. Upload CSV")).toBeInTheDocument();
  });

  it("translates command screens into Spanish", () => {
    renderPage(<Finance />, "es");
    expect(screen.getByText("Finanzas")).toBeInTheDocument();
    expect(screen.getByText("Registrar venta")).toBeInTheDocument();
    renderPage(<Lots />, "es");
    expect(screen.getByText("Lotes y movimientos")).toBeInTheDocument();
  });
});

describe("i18n data values", () => {
  // lifecycleStatus "transferred" is not one of the filter-dropdown options,
  // so the localized value appears only once (the data cell).
  const animal = { id: "a-1", visualId: "BR-9", sex: "female", breedCode: "NELORE", lifecycleStatus: "transferred" };

  it("localizes enum data (sex, lifecycle status) per locale", async () => {
    renderPage(<Animals />, "pt-BR", client([animal]));
    // pt-BR: female → Fêmea, transferred → Transferido
    expect(await screen.findByText("Fêmea")).toBeInTheDocument();
    expect(screen.getByText("Transferido")).toBeInTheDocument();
    // Free-form data (typed breed code) passes through untranslated.
    expect(screen.getByText("NELORE")).toBeInTheDocument();
  });

  it("localizes enum data into English and Spanish", async () => {
    renderPage(<Animals />, "en", client([animal]));
    expect(await screen.findByText("Female")).toBeInTheDocument();
    expect(screen.getByText("Transferred")).toBeInTheDocument();

    renderPage(<Animals />, "es", client([animal]));
    expect(await screen.findByText("Hembra")).toBeInTheDocument();
    expect(screen.getByText("Transferido")).toBeInTheDocument();
  });
});
