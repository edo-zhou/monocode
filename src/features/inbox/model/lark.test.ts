// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { inboxAskKey } from "./inboxAsk";
import { inboxListCacheKey } from "./githubTasks";
import { notifyLarkChange } from "./lark";
import { inboxTrackerDescription } from "./inboxContext";
import {
  clearInboxCache,
  dedupeInboxItems,
  inboxStartDraft,
  listInboxItems,
} from "./githubTasks";
import {
  filterLarkItems,
  larkItemToInboxItem,
  listLarkInbox,
  splitLarkLinks,
  type LarkItem,
} from "./lark";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const row: LarkItem = {
  id: "larksuite.com:base:BaseA:TableA:recA",
  sourceId: "larksuite.com:base:BaseA:TableA",
  recordId: "recA",
  sourceName: "Frontend bugs",
  kind: "base",
  title: "Fix checkout",
  url: "https://team.larksuite.com/base/BaseA?table=TableA&record=recA",
  state: "In progress",
  closed: false,
  updatedAt: "2026-10-15T08:00:00Z",
  assignees: ["Kai"],
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  localStorage.clear();
  clearInboxCache();
});

it("deduplicates pasted links and bounds each verification batch", () => {
  expect(
    splitLarkLinks(
      " https://example.com/a\nhttps://example.com/a  https://example.com/b ",
    ),
  ).toEqual(["https://example.com/a", "https://example.com/b"]);
  expect(() =>
    splitLarkLinks(
      Array.from(
        { length: 21 },
        (_, index) => `https://example.com/${index}`,
      ).join("\n"),
    ),
  ).toThrow("20");
});

it("changes the polling scope after source settings change", () => {
  const query = { assignedToMe: false, state: "open" as const, search: "" };
  const before = inboxListCacheKey([], query);
  notifyLarkChange();
  expect(inboxListCacheKey([], query)).not.toBe(before);
});

it("keeps table and record identities case-sensitive and separate", () => {
  const first = larkItemToInboxItem(row);
  const second = larkItemToInboxItem({
    ...row,
    id: `${row.sourceId}:reca`,
    recordId: "reca",
  });
  const otherTable = larkItemToInboxItem({
    ...row,
    id: "larksuite.com:base:BaseA:TableB:recA",
    sourceId: "larksuite.com:base:BaseA:TableB",
  });
  expect(dedupeInboxItems([first, first, second, otherTable])).toHaveLength(3);
  expect(inboxAskKey(first)).not.toBe(inboxAskKey(second));
  expect(first.identifier).toBe("recA");
});

it("separates documents from table records and filters each source", () => {
  const record = larkItemToInboxItem(row);
  const document = larkItemToInboxItem({
    ...row,
    id: "docA",
    sourceId: "docA",
    kind: "document",
    recordId: "",
  });
  expect(filterLarkItems([record, document], "base", "")).toEqual([record]);
  expect(filterLarkItems([record, document], "document", "docA")).toEqual([
    document,
  ]);
  expect(filterLarkItems([record, document], "base", "missing")).toEqual([]);
  expect(inboxStartDraft(document, "Reference text")).toContain(
    "document as reference context",
  );
  expect(inboxStartDraft(document, "Reference text")).not.toContain("GitHub");
});

it("loads source context for Ask and preserves an already loaded body", async () => {
  vi.mocked(invoke).mockResolvedValue({
    body: "Reproduction steps",
    truncated: false,
  });
  const item = larkItemToInboxItem(row);
  expect(await inboxTrackerDescription(item)).toBe("Reproduction steps");
  expect(invoke).toHaveBeenCalledWith("lark_item_details", {
    sourceId: row.sourceId,
    recordId: "recA",
  });
  expect(await inboxTrackerDescription(item, "Already loaded")).toBe(
    "Already loaded",
  );
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("keeps successful sources visible when another source fails", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "lark_status") return { connected: true };
    if (command.endsWith("_status")) return { connected: false };
    if (command === "lark_inbox")
      return { items: [row], errors: ["Private table: access denied"] };
    throw new Error(`Unexpected command: ${command}`);
  });
  const result = await listInboxItems([], {
    assignedToMe: true,
    state: "open",
    search: "",
  });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].title).toBe("Fix checkout");
  expect(result.errors.lark).toContain("Private table");
});

it("propagates connection errors instead of reporting an empty successful inbox", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("Credentials unavailable"));
  await expect(listLarkInbox()).rejects.toThrow("Credentials unavailable");
});
