import { ApiError } from "./errors.js";
import type { ProblemDetails } from "./types.js";

/** Minimal fetch signature so the client works in browser, Node, and tests. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** Authentication strategy, matching the API's two modes (apps/api/src/auth.ts). */
export type AuthConfig =
  | { mode: "bearer"; getToken: () => string | Promise<string> }
  | { mode: "dev"; devUserId: string; platformAdmin?: boolean; displayName?: string }
  | { mode: "none" };

export interface ClientConfig {
  baseUrl: string;
  auth?: AuthConfig;
  /** Default tenant id sent as x-tenant-id; can be overridden per call. */
  tenantId?: string;
  fetch?: FetchLike;
  /** Generates idempotency keys / correlation ids; defaults to crypto UUID. */
  newId?: () => string;
}

const CORRELATION_HEADER = "x-correlation-id";
const TENANT_HEADER = "x-tenant-id";
const IDEMPOTENCY_HEADER = "idempotency-key";

function defaultNewId(): string {
  // Present in modern browsers and Node ≥ 16.7 as globalThis.crypto.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Deterministic-length fallback (non-crypto) — only hit in exotic runtimes.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.floor((performance.now?.() ?? 0) * 1000) + Math.floor(Date.now() / 7)) % 16;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface RequestOptions {
  /** Per-call tenant override. */
  tenantId?: string;
  /** Explicit idempotency key (else one is generated for mutating verbs). */
  idempotencyKey?: string;
  /** Correlation id to propagate (else generated). */
  correlationId?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface Response<T> {
  data: T;
  status: number;
  correlationId: string;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class HttpClient {
  private readonly baseUrl: string;
  private readonly auth: AuthConfig;
  private readonly tenantId: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly newId: () => string;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.auth = config.auth ?? { mode: "none" };
    this.tenantId = config.tenantId;
    const nativeFetch = (globalThis as { fetch?: FetchLike }).fetch;
    // Native fetch must be called with `this === globalThis`, so bind it;
    // otherwise the browser throws "Illegal invocation". An injected fetch
    // (tests) is used as-is.
    const f = config.fetch ?? (nativeFetch ? nativeFetch.bind(globalThis) : undefined);
    if (!f) throw new Error("No fetch implementation available; pass config.fetch");
    this.fetchImpl = f;
    this.newId = config.newId ?? defaultNewId;
  }

  async request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<Response<T>> {
    const correlationId = options.correlationId ?? this.newId();
    const headers: Record<string, string> = {
      accept: "application/json",
      [CORRELATION_HEADER]: correlationId,
    };

    await this.applyAuth(headers);

    const tenant = options.tenantId ?? this.tenantId;
    if (tenant) headers[TENANT_HEADER] = tenant;

    if (MUTATING.has(method.toUpperCase())) {
      headers[IDEMPOTENCY_HEADER] = options.idempotencyKey ?? this.newId();
    }

    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const url = this.baseUrl + path + buildQuery(options.query);
    const response = await this.fetchImpl(url, { method, headers, body: payload });
    const responseCorrelation = response.headers.get(CORRELATION_HEADER) ?? correlationId;
    const text = await response.text();

    if (response.status >= 200 && response.status < 300) {
      return {
        data: (text ? safeJson(text) : undefined) as T,
        status: response.status,
        correlationId: responseCorrelation,
      };
    }

    throw new ApiError(toProblem(text, response.status, responseCorrelation));
  }

  private async applyAuth(headers: Record<string, string>): Promise<void> {
    if (this.auth.mode === "bearer") {
      headers.authorization = `Bearer ${await this.auth.getToken()}`;
    } else if (this.auth.mode === "dev") {
      headers["x-dev-user-id"] = this.auth.devUserId;
      if (this.auth.platformAdmin) headers["x-dev-platform-admin"] = "true";
      if (this.auth.displayName) headers["x-dev-display-name"] = this.auth.displayName;
    }
  }
}

function buildQuery(query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toProblem(text: string, status: number, correlationId: string): ProblemDetails {
  const parsed = safeJson(text);
  if (parsed && typeof parsed === "object" && "code" in parsed && "status" in parsed) {
    return parsed as ProblemDetails;
  }
  return {
    type: "about:blank",
    title: `HTTP ${status}`,
    status,
    detail: typeof parsed === "string" ? parsed : `Request failed with status ${status}`,
    code: "JK-HTTP-ERROR",
    correlationId,
  };
}
