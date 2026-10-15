import type { LarkRecordField } from "./lark";

export function larkObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function larkFieldValue(field: LarkRecordField) {
  let { kind, value } = field;
  for (let depth = 0; depth < 8 && (kind === 19 || kind === 20); depth++) {
    const result = larkObject(value);
    if (typeof result.type !== "number" || !("value" in result)) break;
    kind = result.type;
    value = result.value;
  }
  return { kind, value };
}

export function larkText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value))
    return value.map(larkText).filter(Boolean).join(", ");
  if (typeof value !== "object") return String(value);
  const object = larkObject(value);
  for (const key of ["text", "name", "en_name", "full_address", "link", "id"])
    if (typeof object[key] === "string") return object[key];
  if (Array.isArray(object.link_record_ids))
    return larkText(object.link_record_ids);
  return JSON.stringify(value, null, 2);
}

export function larkDate(
  value: unknown,
  includeTime: boolean,
): { text: string; iso?: string } {
  const millis =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : NaN;
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) return { text: larkText(value) || "—" };
  return {
    text: new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(includeTime
        ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
        : {}),
    }).format(date),
    iso: date.toISOString(),
  };
}

export function safeLarkLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
