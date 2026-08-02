import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, badgeTone } from "../src/components/Badge.js";

describe("badgeTone", () => {
  it("maps positive, attention, and in-progress states to their tones", () => {
    expect(badgeTone("active")).toBe("pasto");
    expect(badgeTone("resolved")).toBe("pasto");
    expect(badgeTone("deceased")).toBe("hide");
    expect(badgeTone("high")).toBe("hide");
    expect(badgeTone("withdrawal")).toBe("hide");
    expect(badgeTone("open")).toBe("tag");
    expect(badgeTone("pending")).toBe("tag");
  });

  it("falls back to neutral for unknown or empty values", () => {
    expect(badgeTone("sold")).toBe("neutral");
    expect(badgeTone("something_new")).toBe("neutral");
    expect(badgeTone(null)).toBe("neutral");
    expect(badgeTone(undefined)).toBe("neutral");
  });
});

describe("Badge", () => {
  it("renders the tone class and the localized label", () => {
    const { container } = render(<Badge value="active" />);
    const el = container.querySelector(".badge");
    expect(el?.className).toContain("badge--pasto");
    // pt-BR default: "active" → "Ativo" via the enum catalogue.
    expect(screen.getByText("Ativo")).toBeInTheDocument();
  });

  it("honours an explicit tone and label override", () => {
    const { container } = render(<Badge value="x" tone="hide" label="Bloqueado" />);
    expect(container.querySelector(".badge")?.className).toContain("badge--hide");
    expect(screen.getByText("Bloqueado")).toBeInTheDocument();
  });
});
