import { HttpClient, type ClientConfig, type RequestOptions } from "./http.js";
import type {
  Animal,
  ConnectorRegistration,
  CreateRecommendationRequest,
  CreateWebhookSubscriptionRequest,
  ExportJob,
  Farm,
  Page,
  Recommendation,
  RequestExportRequest,
  SearchResults,
  Tenant,
  WebhookDelivery,
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
} from "./types.js";

/**
 * Typed client for the JK Platform REST API (Volume VI). Groups operations by
 * resource; every mutating call carries an idempotency key and every call
 * propagates a correlation id and the tenant header (see HttpClient).
 */
export class JkPlatformClient {
  private readonly http: HttpClient;

  constructor(config: ClientConfig) {
    this.http = new HttpClient(config);
  }

  private async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return (await this.http.request<T>("GET", path, undefined, options)).data;
  }
  private async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return (await this.http.request<T>("POST", path, body, options)).data;
  }
  private async del(path: string, options?: RequestOptions): Promise<void> {
    await this.http.request<void>("DELETE", path, undefined, options);
  }

  // -- Herd: handling sessions & weighing --
  readonly herd = {
    startSession: (body: { farmId: string; purpose?: string; deviceId?: string; expectedCount?: number }, o?: RequestOptions) =>
      this.post<Record<string, unknown>>("/api/v1/handling-sessions", body, o),
    recordObservation: (sessionId: string, body: Record<string, unknown>, o?: RequestOptions) =>
      this.post<Record<string, unknown>>(`/api/v1/handling-sessions/${sessionId}/observations`, body, o),
    closeSession: (sessionId: string, o?: RequestOptions) =>
      this.post<Record<string, unknown>>(`/api/v1/handling-sessions/${sessionId}/close`, undefined, o),
    exceptions: (sessionId: string, o?: RequestOptions) =>
      this.get<Page<Record<string, unknown>>>(`/api/v1/handling-sessions/${sessionId}/exceptions`, o),
  };

  // -- Health commands --
  readonly healthCommands = {
    recordTreatment: (animalId: string, body: Record<string, unknown>, o?: RequestOptions) =>
      this.post<Record<string, unknown>>(`/api/v1/animals/${animalId}/treatments`, body, o),
  };

  // -- Reproduction commands --
  readonly reproductionCommands = {
    recordService: (body: Record<string, unknown>, o?: RequestOptions) =>
      this.post<Record<string, unknown>>("/api/v1/reproduction/services", body, o),
    recordPregnancyCheck: (body: Record<string, unknown>, o?: RequestOptions) =>
      this.post<Record<string, unknown>>("/api/v1/reproduction/pregnancy-checks", body, o),
    recordCalving: (body: Record<string, unknown>, o?: RequestOptions) =>
      this.post<Record<string, unknown>>("/api/v1/calvings", body, o),
  };

  // -- Lots & movements --
  readonly lots = {
    create: (body: { farmId: string; name: string; purpose?: string; target?: string }, o?: RequestOptions) =>
      this.post<Record<string, unknown>>("/api/v1/lots", body, o),
    addAnimals: (lotId: string, animalIds: string[], o?: RequestOptions) =>
      this.post<Record<string, unknown>>(`/api/v1/lots/${lotId}/animals`, { animalIds }, o),
    move: (body: { lotId: string; paddockId: string; headCount?: number }, o?: RequestOptions) =>
      this.post<Record<string, unknown>>("/api/v1/lot-movements", body, o),
    members: (lotId: string, o?: RequestOptions) => this.get<Page<Record<string, unknown>>>(`/api/v1/lots/${lotId}/members`, o),
    currentPaddock: (lotId: string, o?: RequestOptions) => this.get<Record<string, unknown>>(`/api/v1/lots/${lotId}/current-paddock`, o),
  };

  // -- Finance commands --
  readonly finance = {
    recordExpense: (body: Record<string, unknown>, o?: RequestOptions) =>
      this.post<Record<string, unknown>>("/api/v1/finance/expenses", body, o),
    recordRevenue: (body: Record<string, unknown>, o?: RequestOptions) =>
      this.post<Record<string, unknown>>("/api/v1/finance/revenue", body, o),
    recordSale: (body: Record<string, unknown>, o?: RequestOptions) => this.post<Record<string, unknown>>("/api/v1/sales", body, o),
    lotMargin: (lotId: string, o?: RequestOptions) => this.get<Record<string, unknown>>(`/api/v1/lots/${lotId}/margin`, o),
  };

  // -- Identity & tenancy --
  readonly tenants = {
    register: (body: { name: string }, o?: RequestOptions) => this.post<Tenant>("/api/v1/tenants", body, o),
    current: (o?: RequestOptions) => this.get<Tenant>("/api/v1/tenants/current", o),
  };
  readonly farms = {
    create: (body: { name: string; areaHa?: number }, o?: RequestOptions) => this.post<Farm>("/api/v1/farms", body, o),
  };

  // -- Animals --
  readonly animals = {
    list: (o?: RequestOptions) => this.get<Page<Animal>>("/api/v1/animals", o),
    register: (
      body: { farmId: string; visualId: string; sex: string; breedCode?: string; birthDate?: string; rfid?: string },
      o?: RequestOptions,
    ) => this.post<Animal>("/api/v1/animals", body, o),
    get: (id: string, o?: RequestOptions) => this.get<Animal>(`/api/v1/animals/${id}`, o),
    timeline: (id: string, o?: RequestOptions) =>
      this.get<Page<Record<string, unknown>>>(`/api/v1/animals/${id}/timeline`, o),
    weights: (id: string, o?: RequestOptions) => this.get<Page<Record<string, unknown>>>(`/api/v1/animals/${id}/weights`, o),
    adg: (id: string, o?: RequestOptions) => this.get<Record<string, unknown>>(`/api/v1/animals/${id}/adg`, o),
  };

  // -- Health & laboratory --
  readonly health = {
    treatments: (animalId: string, o?: RequestOptions) =>
      this.get<Page<Record<string, unknown>>>(`/api/v1/animals/${animalId}/treatments`, o),
    restrictions: (animalId: string, o?: RequestOptions) =>
      this.get<Page<Record<string, unknown>>>(`/api/v1/animals/${animalId}/restrictions`, o),
    saleClear: (animalId: string, o?: RequestOptions) =>
      this.get<Record<string, unknown>>(`/api/v1/animals/${animalId}/sale-clear`, o),
  };

  // -- Reproduction --
  readonly reproduction = {
    status: (animalId: string, o?: RequestOptions) =>
      this.get<Record<string, unknown>>(`/api/v1/animals/${animalId}/reproduction-status`, o),
  };

  // -- Governed AI --
  readonly recommendations = {
    create: (body: CreateRecommendationRequest, o?: RequestOptions) =>
      this.post<Recommendation>("/api/v1/recommendations", body, o),
    list: (status?: string, o?: RequestOptions) =>
      this.get<Page<Recommendation>>("/api/v1/recommendations", { ...o, query: { ...o?.query, status } }),
    get: (id: string, o?: RequestOptions) => this.get<Recommendation>(`/api/v1/recommendations/${id}`, o),
    approve: (id: string, o?: RequestOptions) => this.post<void>(`/api/v1/recommendations/${id}/approve`, undefined, o),
    reject: (id: string, reason?: string, o?: RequestOptions) =>
      this.post<void>(`/api/v1/recommendations/${id}/reject`, { reason }, o),
    execute: (id: string, o?: RequestOptions) =>
      this.post<{ executed: boolean }>(`/api/v1/recommendations/${id}/execute`, undefined, o),
  };

  // -- Webhooks & connectors --
  readonly webhooks = {
    subscribe: (body: CreateWebhookSubscriptionRequest, o?: RequestOptions) =>
      this.post<WebhookSubscriptionWithSecret>("/api/v1/webhooks/subscriptions", body, o),
    list: (o?: RequestOptions) => this.get<Page<WebhookSubscription>>("/api/v1/webhooks/subscriptions", o),
    get: (id: string, o?: RequestOptions) => this.get<WebhookSubscription>(`/api/v1/webhooks/subscriptions/${id}`, o),
    rotateSecret: (id: string, o?: RequestOptions) =>
      this.post<WebhookSubscriptionWithSecret>(`/api/v1/webhooks/subscriptions/${id}/rotate-secret`, undefined, o),
    deactivate: (id: string, o?: RequestOptions) => this.del(`/api/v1/webhooks/subscriptions/${id}`, o),
    deliveries: (query?: { status?: string; subscriptionId?: string }, o?: RequestOptions) =>
      this.get<Page<WebhookDelivery>>("/api/v1/webhooks/deliveries", { ...o, query: { ...o?.query, ...query } }),
    replay: (id: string, o?: RequestOptions) => this.post<WebhookDelivery>(`/api/v1/webhooks/deliveries/${id}/replay`, undefined, o),
  };
  readonly connectors = {
    register: (body: { connectorType: string; name: string; config?: Record<string, unknown> }, o?: RequestOptions) =>
      this.post<ConnectorRegistration>("/api/v1/connectors", body, o),
    list: (o?: RequestOptions) => this.get<Page<ConnectorRegistration>>("/api/v1/connectors", o),
    get: (id: string, o?: RequestOptions) => this.get<ConnectorRegistration>(`/api/v1/connectors/${id}`, o),
  };

  // -- Exports --
  readonly exports = {
    request: (body: RequestExportRequest, o?: RequestOptions) => this.post<ExportJob>("/api/v1/exports", body, o),
    list: (status?: string, o?: RequestOptions) =>
      this.get<Page<ExportJob>>("/api/v1/exports", { ...o, query: { ...o?.query, status } }),
    get: (id: string, o?: RequestOptions) => this.get<ExportJob>(`/api/v1/exports/${id}`, o),
    process: (id: string, o?: RequestOptions) => this.post<ExportJob>(`/api/v1/exports/${id}/process`, undefined, o),
    /** Raw artifact download (JSON/CSV text). */
    download: (id: string, o?: RequestOptions) => this.get<unknown>(`/api/v1/exports/${id}/download`, o),
  };

  // -- Analytics & alerts --
  readonly analytics = {
    executiveDashboard: (o?: RequestOptions) => this.get<Record<string, unknown>>("/api/v1/dashboards/executive", o),
    farmIntelligenceIndex: (o?: RequestOptions) => this.get<Record<string, unknown>>("/api/v1/reports/farm-intelligence-index", o),
    monthlyNucleus: (o?: RequestOptions) => this.get<Record<string, unknown>>("/api/v1/reports/monthly-nucleus", o),
  };
  readonly search = {
    query: (q: string, limit?: number, o?: RequestOptions) =>
      this.get<SearchResults>("/api/v1/search", { ...o, query: { ...o?.query, q, limit } }),
  };
  readonly alerts = {
    list: (status?: string, o?: RequestOptions) =>
      this.get<Page<Record<string, unknown>>>("/api/v1/alerts", { ...o, query: { ...o?.query, status } }),
    acknowledge: (id: string, o?: RequestOptions) => this.post<void>(`/api/v1/alerts/${id}/acknowledge`, undefined, o),
    resolve: (id: string, note?: string, o?: RequestOptions) => this.post<void>(`/api/v1/alerts/${id}/resolve`, { note }, o),
  };
}
