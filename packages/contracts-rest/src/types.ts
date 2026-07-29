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

// ---------------------------------------------------------------------------
// Reporting (§26 mandatory reports, §47 tenant-scoped reads, §59 dashboards).
// The catalogue is served by the API; the console renders whatever columns and
// parameters a report declares, so new reports appear without a client change.
// ---------------------------------------------------------------------------

export type ReportColumnType =
  "text" | "integer" | "number" | "money" | "percent" | "date" | "datetime" | "enum";

export type ReportParamKind = "farmId" | "lotId" | "dateFrom" | "dateTo";

export interface ReportColumn {
  key: string;
  labelKey: string;
  type: ReportColumnType;
}

export interface ReportParamSpec {
  key: string;
  kind: ReportParamKind;
  labelKey: string;
}

export interface ReportCatalogItem {
  key: string;
  category: string;
  titleKey: string;
  descriptionKey: string;
  params: ReportParamSpec[];
  columns: ReportColumn[];
}

export interface RunReportRequest {
  params?: Record<string, unknown>;
}

export interface ReportRunResult {
  id: string;
  reportKey: string;
  category: string;
  titleKey: string;
  columns: ReportColumn[];
  params: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
  rowCount: number;
  checksum: string;
  generatedAt: string;
}

export interface ReportRunSummary {
  id: string;
  reportKey: string;
  rowCount: number;
  summary: Record<string, unknown>;
  checksum: string;
  generatedAt: string;
}

export interface ReportPreviewResult {
  reportKey: string;
  category: string;
  titleKey: string;
  columns: ReportColumn[];
  params: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
  rowCount: number;
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

// ---------------------------------------------------------------------------
// Collection reads (§47). One shape per list endpoint, each already carrying
// the names the console shows, so no screen has to resolve a UUID itself.
// ---------------------------------------------------------------------------

export interface LotSummaryView {
  id: string;
  farmId: string;
  farmName: string;
  name: string;
  purpose: "genetic_nucleus" | "beef" | "rearing" | "quarantine" | "other";
  target: string | null;
  status: "open" | "closed";
  startedAt: string;
  endedAt: string | null;
  headCount: number;
  currentPaddockId: string | null;
  currentPaddockName: string | null;
  inPaddockSince: string | null;
}

export interface HandlingSessionView {
  id: string;
  farmId: string;
  farmName: string;
  purpose: string;
  status: string;
  deviceId: string | null;
  expectedCount: number | null;
  recordedCount: number;
  unresolvedCount: number;
  startedAt: string;
  closedAt: string | null;
}

export interface WeightView {
  id: string;
  animalId: string;
  visualId: string;
  occurredAt: string;
  weightKg: number;
  eligibleForAnalytics: boolean;
  qualityFlags: string[];
}

export interface TreatmentView {
  id: string;
  animalId: string;
  visualId: string;
  kind: string;
  productName: string;
  medicineBatch: string | null;
  dose: number | null;
  doseUnit: string | null;
  route: string | null;
  administeredAt: string;
  withdrawalUntil: string | null;
  protocolName: string | null;
}

export interface RestrictionView {
  id: string;
  animalId: string;
  visualId: string;
  restrictionType: string;
  reason: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface HealthProtocolView {
  id: string;
  name: string;
  appliesTo: string | null;
  version: number;
  status: string;
  treatmentCount: number;
}

export interface HealthCaseView {
  id: string;
  animalId: string;
  visualId: string;
  symptom: string | null;
  diagnosis: string | null;
  status: string;
  outcome: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface ReproductionEventView {
  id: string;
  kind: "service" | "pregnancy_check" | "calving";
  damId: string;
  damVisualId: string;
  occurredAt: string;
  detail: string | null;
  result: string | null;
  expectedCalvingDate: string | null;
  calfVisualId: string | null;
  birthWeightKg: number | null;
}

export interface EvaluationView {
  animalId: string;
  visualId: string;
  sex: string;
  provider: string;
  evaluationDate: string;
  traits: Array<{
    trait: string;
    value: number;
    percentile: number | null;
    reliability: number | null;
  }>;
}

export interface LedgerEntryView {
  id: string;
  farmId: string | null;
  farmName: string | null;
  entryType: "expense" | "revenue";
  category: string;
  counterparty: string | null;
  amountMinor: number;
  currency: string;
  capexOpex: string | null;
  reversesEntryId: string | null;
  occurredAt: string;
  allocations: Array<{ dimension: string; targetId: string | null; minor: number }>;
}

export interface SaleView {
  id: string;
  animalId: string | null;
  visualId: string | null;
  lotId: string | null;
  lotName: string | null;
  weightKg: number | null;
  priceBasis: string | null;
  grossMinor: number;
  deductionsMinor: number;
  freightMinor: number;
  netReceiptMinor: number;
  currency: string;
  soldAt: string;
}

export interface BudgetLineView {
  periodMonth: string;
  category: string;
  plannedMinor: number;
  actualMinor: number;
  currency: string;
}

export interface PaddockView {
  id: string;
  farmId: string;
  farmName: string;
  name: string;
  areaHa: number | null;
  pastureType: string | null;
  waterAvailable: boolean;
  status: string;
  currentLotId: string | null;
  currentLotName: string | null;
  headCount: number | null;
  occupiedSince: string | null;
  lastAssessedAt: string | null;
  lastCondition: string | null;
  lastAvailabilityKgDmHa: number | null;
}

export interface ItemView {
  id: string;
  name: string;
  category: string;
  unit: string;
  supplier: string | null;
  reorderLevel: number | null;
  balance: number;
  belowReorder: boolean;
  lastMovementAt: string | null;
  expiringBatches: number;
}

export interface AssetView {
  id: string;
  farmId: string | null;
  farmName: string | null;
  name: string;
  assetType: string;
  model: string | null;
  serial: string | null;
  location: string | null;
  status: string;
  calibrationValidUntil: string | null;
  calibrationOverdue: boolean;
  nextMaintenanceDueAt: string | null;
  openWorkOrders: number;
}

export interface WorkOrderView {
  id: string;
  assetId: string;
  assetName: string;
  priority: string;
  description: string;
  status: string;
  laborCost: number | null;
  partsCost: number | null;
  downtimeHours: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface TaskView {
  id: string;
  farmId: string | null;
  animalId: string | null;
  animalVisualId: string | null;
  lotId: string | null;
  lotName: string | null;
  sourceRule: string;
  taskType: string;
  dueAt: string | null;
  status: string;
  detail: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}
