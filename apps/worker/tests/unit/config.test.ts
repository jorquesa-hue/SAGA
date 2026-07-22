import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "../../src/config.js";

describe("worker configuration contract (Appendix G)", () => {
  it("applies safe local defaults", () => {
    const config = loadWorkerConfig({});
    expect(config.WORKER_DATABASE_URL).toBe(
      "postgresql://jk_worker:jk_worker_local@localhost:5432/jk_platform",
    );
    expect(config.POLL_INTERVAL_MS).toBe(1000);
    expect(config.OUTBOX_BATCH_SIZE).toBe(50);
    expect(config.PORT).toBe(4100);
    expect(config.APP_ENV).toBe("local");
    expect(config.NATS_URL).toBeUndefined();
  });

  it("coerces numeric environment strings", () => {
    const config = loadWorkerConfig({
      POLL_INTERVAL_MS: "250",
      OUTBOX_BATCH_SIZE: "10",
      PORT: "4199",
    });
    expect(config.POLL_INTERVAL_MS).toBe(250);
    expect(config.OUTBOX_BATCH_SIZE).toBe(10);
    expect(config.PORT).toBe(4199);
  });

  it("fails startup on invalid critical configuration without echoing values", () => {
    expect(() =>
      loadWorkerConfig({ POLL_INTERVAL_MS: "not-a-number", WORKER_DATABASE_URL: "nope" }),
    ).toThrowError(/Invalid configuration:(?=[\s\S]*POLL_INTERVAL_MS)(?=[\s\S]*WORKER_DATABASE_URL)/);
    expect(() => loadWorkerConfig({ WORKER_DATABASE_URL: "s3cret-not-a-url" })).not.toThrow(
      /s3cret/,
    );
  });

  it("accepts an optional NATS_URL", () => {
    const config = loadWorkerConfig({ NATS_URL: "nats://localhost:4222" });
    expect(config.NATS_URL).toBe("nats://localhost:4222");
  });
});
