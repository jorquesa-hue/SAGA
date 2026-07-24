import { z } from "zod";

/** Supported import types (extensible). */
export const IMPORT_TYPES = ["animals"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

/** Column mapping: target field → source CSV header. */
export const animalMappingSchema = z
  .object({
    visualId: z.string().min(1),
    sex: z.string().min(1),
    breedCode: z.string().min(1).optional(),
    birthDate: z.string().min(1).optional(),
    rfid: z.string().min(1).optional(),
  })
  .strict();
export type AnimalMapping = z.input<typeof animalMappingSchema>;

/** Validated target shape for one mapped animal row. */
export const animalRowSchema = z
  .object({
    visualId: z.string().trim().min(1, "visualId is required").max(80),
    sex: z.enum(["female", "male", "unknown"]),
    breedCode: z.string().trim().min(1).max(60).default("BRANGUS"),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "birthDate must be YYYY-MM-DD")
      .optional(),
    rfid: z.string().trim().max(128).optional(),
  })
  .strict();
export type AnimalRow = z.infer<typeof animalRowSchema>;

export interface RowError {
  field: string;
  reason: string;
}

export interface ImportJobSummary {
  id: string;
  importType: string;
  status: string;
  filename: string | null;
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
  validationStatus: string;
  errors: RowError[];
  executionStatus: string;
  serverId: string | null;
  executionError: string | null;
}

export interface ImportPreview {
  job: ImportJobSummary;
  sample: ImportRowView[];
  invalidSample: ImportRowView[];
}

/** Outcome the injected executor returns for one valid row (execute stage). */
export interface RowExecutionResult {
  status: "created" | "failed" | "skipped";
  serverId?: string;
  error?: string;
}

/** Delegate that performs the actual domain write for one validated row. The
 *  import module never writes another module's tables directly — the API
 *  composition root supplies an executor backed by the owning service. */
export type RowExecutor = (
  row: AnimalRow,
  context: { farmId: string | null },
) => Promise<RowExecutionResult>;
