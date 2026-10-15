import { INBOX_SOURCE_LABELS, type InboxSource } from "./inboxFilters";

const STORAGE_KEY = "monocode.inboxSourceOrder";
const DEFAULT_ORDER = Object.keys(INBOX_SOURCE_LABELS) as InboxSource[];
const KNOWN_SOURCES = new Set<string>(DEFAULT_ORDER);

export function loadInboxSourceOrder(): InboxSource[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    const sources = Array.isArray(stored)
      ? stored.filter(
          (source): source is InboxSource =>
            typeof source === "string" && KNOWN_SOURCES.has(source),
        )
      : [];
    return [...new Set([...sources, ...DEFAULT_ORDER])];
  } catch {
    return [...DEFAULT_ORDER];
  }
}

export function saveInboxSourceOrder(sources: InboxSource[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
  } catch {}
}
