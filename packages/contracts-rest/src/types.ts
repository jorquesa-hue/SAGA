/**
 * Wire types mirroring the authored OpenAPI contract
 * (`contracts/openapi/jk-platform.yaml`). Kept deliberately narrow to the
 * fields the clients consume; the server contract is the source of truth.
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  correlationId: string;
  errors?: Array<{ field: string; reason: string }>;
}

export type Role =
  | "tenant_owner"
  | "farm_manager"
  | "technician"
  | "veterinarian"
  | "genetics_specialist"
  | "finance_user"
  | "auditor"
  | "integration_service";

export interface Tenant {
  id: string;
  name: string;
  status?: string;
  /** Tenant base locale (BCP-47, e.g. "pt-BR"). Seeds the console language. */
  defaultLocale?: string;
  /** Tenant base currency (ISO 4217, e.g. "BRL"). Drives money formatting. */
  defaultCurrency?: string;
}

export interface Farm {
  id: string;
  name: string;
  areaHa?: number;
}

export interface Animal {
  id: string;
  visualId?: string;
  sex?: "female" | "male" | "unknown";
  breedCode?: string;
  lifecycleStatus?: string;
}

export interface Recommendation {
  id: string;
  agentName?: string;
  /** Rendered fallback for a client that cannot resolve the key. */
  recommendationText?: string;
  /**
   * Message catalogue key and its facts, so the client renders the
   * recommendation in the reader's language (docs/brand §2.4). Absent for
   * recommendations written before migration 0020.
   */
  recommendationKey?: string;
  recommendationParams?: Record<string, string | number>;
  assumptionsKey?: string;
  proposedActionCategory: string;
  confidence: number;
  riskClass?: string;
  status: string;
  prohibited: boolean;
  highImpact?: boolean;
  evidenceEventIds: string[];
}

export interface CreateRecommendationRequest {
  agentName: string;
  modelProvider: string;
  modelVersion: string;
  promptVersion: string;
  /** Rendered fallback for clients that cannot resolve the key. */
  recommendationText: string;
  /**
   * Message catalogue key and its facts. Present from migration 0020 on;
   * absent for older recommendations, where the client renders
   * recommendationText instead (docs/brand §2.4).
   */
  recommendationKey?: string;
  recommendationParams?: Record<string, string | number>;
  assumptionsKey?: string;
  proposedActionCategory: string;
  evidenceEventIds: string[];
  confidence: number;
  riskClass: "low" | "medium" | "high";
  proposedAction?: Record<string, unknown>;
  assumptions?: string;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  eventFamilies: string[];
  description?: string | null;
  active: boolean;
}

export interface WebhookSubscriptionWithSecret extends WebhookSubscription {
  secret: string;
}

export interface CreateWebhookSubscriptionRequest {
  url: string;
  eventFamilies: string[];
  description?: string;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  deliveryId: string;
  eventId: string;
  eventType: string;
  eventFamily: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastStatusCode?: number | null;
  lastError?: string | null;
}

export interface ConnectorRegistration {
  id: string;
  connectorType: string;
  name: string;
  status: string;
}

export type ExportType =
  "animal_traceability_packet" | "animal_inventory" | "herd_weights" | "finance_ledger";
export type ExportFormat = "json" | "csv" | "xlsx" | "pdf" | "geojson" | "zip";

export interface RequestExportRequest {
  exportType: ExportType;
  format?: ExportFormat;
  params?: Record<string, unknown>;
}

export interface ExportJob {
  id: string;
  exportType: string;
  format: string;
  status: string;
  byteSize?: number | null;
  checksum?: string | null;
  expiresAt?: string | null;
  resolvableUrl: string;
}

export interface Page<T> {
  items: T[];
}

export interface ImportJob {
  id: string;
  importType: string;
  status:
    "uploaded" | "parsed" | "mapped" | "validated" | "executed" | "reconciled" | "failed";
  filename?: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  executedRows: number;
  failedRows: number;
}

export interface ImportRowView {
  rowNumber: number;
  raw: Record<string, unknown>;
  mapped: Record<string, unknown> | null;
  validationStatus: "pending" | "valid" | "invalid" | "duplicate";
  errors: Array<{ field: string; reason: string }>;
  executionStatus: "pending" | "created" | "failed" | "skipped";
  serverId: string | null;
  executionError: string | null;
}

export interface ImportPreview {
  job: ImportJob;
  sample: ImportRowView[];
  invalidSample: ImportRowView[];
}

export interface AnimalImportMapping {
  visualId: string;
  sex: string;
  breedCode?: string;
  birthDate?: string;
  rfid?: string;
}

export interface SearchHit {
  type: "animal" | "lot" | "paddock" | "person";
  id: string;
  label: string;
  sublabel?: string;
}

export interface SearchResults {
  query: string;
  animals: SearchHit[];
  lots: SearchHit[];
  paddocks: SearchHit[];
  people: SearchHit[];
}
