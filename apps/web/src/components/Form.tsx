import { useState, type ReactNode } from "react";
import { ApiError } from "@jk/contracts-rest";

/** Labeled input row. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

/** Labeled select row. */
export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface CommandState {
  busy: boolean;
  message: string | null;
  ok: boolean;
  run: (fn: () => Promise<unknown>, successText?: string) => Promise<void>;
}

/** Command submit helper: runs an async action, surfaces success/error text. */
export function useCommand(): CommandState {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const run = async (fn: () => Promise<unknown>, successText = "Registrado"): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setOk(true);
      setMessage(successText);
    } catch (e) {
      setOk(false);
      setMessage(e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  };

  return { busy, message, ok, run };
}

export function FormMessage({ state }: { state: CommandState }): ReactNode {
  if (!state.message) return null;
  return <p className={state.ok ? "success" : "error"}>{state.message}</p>;
}
