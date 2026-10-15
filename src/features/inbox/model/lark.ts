import { invoke } from "@tauri-apps/api/core";
import type { InboxItem } from "./githubTasks";

export type LarkRealm = "lark" | "feishu";
export type LarkSourceKind = "base" | "document";
export type LarkMapping = {
  title: string;
  status: string;
  assignee: string;
  closedValues: string[];
};
export type LarkSource = {
  id: string;
  kind: LarkSourceKind;
  name: string;
  url: string;
  token: string;
  tableId: string;
  viewId: string;
  enabled: boolean;
  mapping: LarkMapping;
};
export type LarkStatus = {
  connected: boolean;
  realm: LarkRealm;
  appId: string;
  sources: LarkSource[];
};
export type LarkField = {
  id: string;
  name: string;
  kind: number;
  primary: boolean;
  options: string[];
  dateFormat?: string;
};
export type LarkPreview = {
  source: LarkSource;
  fields: LarkField[];
  samples: string[];
  warning: string;
};
export type LarkItem = {
  id: string;
  sourceId: string;
  recordId: string;
  sourceName: string;
  kind: LarkSourceKind;
  title: string;
  url: string;
  state: string;
  closed: boolean;
  updatedAt: string;
  assignees: string[];
};
export type LarkRecordField = LarkField & { value: unknown };
export type LarkDetails = {
  body: string;
  truncated: boolean;
  fields?: LarkRecordField[];
};
export const LARK_CHANGE_EVENT = "monocode:lark-change";
let sourceRevision = 0;

export function larkSourceRevision(): number {
  return sourceRevision;
}

export function larkConnected(): Promise<LarkStatus> {
  return invoke("lark_status");
}

export async function connectLark(
  realm: LarkRealm,
  appId: string,
  appSecret: string,
): Promise<LarkStatus> {
  const status = await invoke<LarkStatus>("lark_connect", {
    realm,
    appId: appId.trim(),
    appSecret: appSecret.trim(),
  });
  notifyLarkChange();
  return status;
}

export function checkLarkConnection(): Promise<void> {
  return invoke("lark_check_connection");
}

export async function disconnectLark(): Promise<void> {
  await invoke("lark_disconnect");
  notifyLarkChange();
}

export function previewLarkSource(url: string): Promise<LarkPreview[]> {
  return invoke("lark_preview_source", { url: url.trim() });
}

export async function saveLarkSource(source: LarkSource): Promise<LarkSource> {
  const saved = await invoke<LarkSource>("lark_save_source", { source });
  notifyLarkChange();
  return saved;
}

export async function toggleLarkSource(
  id: string,
  enabled: boolean,
): Promise<void> {
  await invoke("lark_toggle_source", { id, enabled });
  notifyLarkChange();
}

export async function removeLarkSource(id: string): Promise<void> {
  await invoke("lark_remove_source", { id });
  notifyLarkChange();
}

export function notifyLarkChange() {
  sourceRevision += 1;
  window.dispatchEvent(new Event(LARK_CHANGE_EVENT));
}

export function splitLarkLinks(text: string): string[] {
  const links = [...new Set(text.trim().split(/\s+/).filter(Boolean))];
  if (links.length > 20)
    throw new Error("Validate at most 20 links at a time.");
  return links;
}

export function larkItemToInboxItem(item: LarkItem): InboxItem {
  return {
    provider: "lark",
    kind: "lark",
    id: item.id,
    identifier: item.kind === "document" ? "Doc" : item.recordId,
    number: 0,
    title: item.title,
    url: item.url,
    state: item.closed ? "closed" : "open",
    stateType: item.state,
    updatedAt: item.updatedAt,
    labels:
      item.state && item.kind === "base"
        ? [{ name: item.state, color: "" }]
        : [],
    assignees: item.assignees.map((login) => ({ login })),
    draft: false,
    repo: item.sourceName,
    projectPath: "",
    teamId: item.sourceId,
    teamName: item.sourceName,
    larkKind: item.kind,
    larkRecordId: item.recordId,
  };
}

export async function listLarkInbox(): Promise<{
  items: InboxItem[];
  errors: string[];
}> {
  const result = await invoke<{ items: LarkItem[]; errors: string[] }>(
    "lark_inbox",
  );
  return {
    items: result.items.map(larkItemToInboxItem),
    errors: result.errors,
  };
}

export function larkItemDetails(
  item: Pick<InboxItem, "teamId" | "larkRecordId">,
): Promise<LarkDetails> {
  if (!item.teamId) return Promise.reject(new Error("Missing Lark source"));
  return invoke("lark_item_details", {
    sourceId: item.teamId,
    recordId: item.larkRecordId ?? "",
  });
}

export function filterLarkItems(
  items: readonly InboxItem[],
  kind: LarkSourceKind,
  sourceId: string,
): InboxItem[] {
  return items.filter(
    (item) =>
      item.provider === "lark" &&
      item.larkKind === kind &&
      (!sourceId || item.teamId === sourceId),
  );
}
