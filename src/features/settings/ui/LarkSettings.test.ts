// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { LarkSettings } from "./LarkSettings";
import type {
  LarkPreview,
  LarkSource,
  LarkStatus,
} from "../../inbox/model/lark";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
let status: LarkStatus;
const base: LarkSource = {
  id: "baseA",
  kind: "base",
  name: "Bugs",
  url: "https://team.larksuite.com/base/BaseA?table=TableA",
  token: "BaseA",
  tableId: "TableA",
  viewId: "",
  enabled: true,
  mapping: {
    title: "title",
    status: "status",
    assignee: "",
    closedValues: ["Done"],
  },
};
const documentSource: LarkSource = {
  ...base,
  id: "docA",
  kind: "document",
  name: "PRD",
  url: "https://team.larksuite.com/docx/DocA",
  tableId: "",
};

function preview(source: LarkSource): LarkPreview {
  return {
    source: structuredClone(source),
    fields: [
      { id: "title", name: "Title", kind: 1, primary: true, options: [] },
      {
        id: "status",
        name: "Status",
        kind: 3,
        primary: false,
        options: ["Done", "Closed"],
      },
    ],
    samples: ["Sample context"],
    warning: "",
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  status = { connected: true, realm: "lark", appId: "cli_demo", sources: [] };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "lark_status") return structuredClone(status);
    if (command === "lark_connect") {
      status.connected = true;
      return structuredClone(status);
    }
    if (command === "lark_disconnect") {
      status.connected = false;
      status.sources = [];
      return;
    }
    if (command === "lark_check_connection") return;
    if (command === "lark_preview_source") {
      const url = (args as { url: string }).url;
      if (url.includes("private"))
        throw new Error("Access denied: share with the app");
      return [preview(url.includes("docx") ? documentSource : base)];
    }
    if (command === "lark_save_source") {
      const source = (args as { source: LarkSource }).source;
      status.sources = [
        ...status.sources.filter((entry) => entry.id !== source.id),
        source,
      ];
      return source;
    }
    if (command === "lark_toggle_source") {
      const { id, enabled } = args as { id: string; enabled: boolean };
      status.sources = status.sources.map((source) =>
        source.id === id ? { ...source, enabled } : source,
      );
      return;
    }
    if (command === "lark_remove_source") {
      status.sources = status.sources.filter(
        (source) => source.id !== (args as { id: string }).id,
      );
      return;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(LarkSettings)));
}
async function input(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  await act(async () => {
    const prototype =
      field.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  )!;
  expect(button, text).toBeTruthy();
  await act(async () => button.click());
}

it("verifies app credentials without requiring a CLI or persisting secrets in browser storage", async () => {
  status.connected = false;
  await render();
  await input("Lark App ID", " cli_demo ");
  await input("Lark App Secret", " private-secret ");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(invoke).toHaveBeenCalledWith("lark_connect", {
    realm: "lark",
    appId: "cli_demo",
    appSecret: "private-secret",
  });
  expect(container.textContent).toContain("No Lark CLI required");
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(JSON.stringify(localStorage)).not.toContain("private-secret");
  expect(container.textContent).toContain("App credentials verified");
});

it("requires explicit confirmation and keeps valid links when another link fails", async () => {
  await render();
  await input(
    "Lark source links",
    `${base.url}\nhttps://team.larksuite.com/base/private\n${documentSource.url}`,
  );
  await click("Validate links");
  expect(container.textContent).toContain("share with the app");
  expect(container.textContent).toContain("Base table · Bugs");
  expect(container.textContent).toContain("Document · PRD");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command === "lark_save_source"),
  ).toBe(false);
  await click("Confirm 2 sources");
  expect(status.sources).toHaveLength(2);
  expect(container.textContent).toContain("2 sources saved");
  expect(container.querySelector('[aria-label="Enable Bugs"]')).toBeTruthy();
  expect(container.querySelector('[aria-label="Enable PRD"]')).toBeTruthy();
});

it("deduplicates links and accepts multiple closed status values", async () => {
  await render();
  await input("Lark source links", `${base.url}\n${base.url}`);
  await click("Validate links");
  await input("Closed values for baseA", "Done, ");
  await input("Closed values for baseA", "Done, Closed");
  await click("Confirm 1 source");
  expect(status.sources[0].mapping.closedValues).toEqual(["Done", "Closed"]);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "lark_preview_source"),
  ).toHaveLength(1);
});

it("does not silently overwrite an already added table", async () => {
  status.sources = [base];
  await render();
  await input("Lark source links", base.url);
  await click("Validate links");
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Select Bugs"]')!
      .checked,
  ).toBe(false);
  expect(container.textContent).toContain("Already added");
});

it("disables sources and confirms removal without disconnecting other sources", async () => {
  status.sources = [structuredClone(base), structuredClone(documentSource)];
  await render();
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('[aria-label="Enable Bugs"]')!
      .click(),
  );
  expect(status.sources[0].enabled).toBe(false);
  expect(status.sources[1].enabled).toBe(true);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Remove Bugs"]')!
      .click(),
  );
  expect(container.querySelector('[aria-label="Enable Bugs"]')).toBeTruthy();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("will not be deleted");
  const confirm = [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent === "Remove source",
  )!;
  await act(async () => confirm.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('[aria-label="Enable Bugs"]')).toBeNull();
  expect(container.querySelector('[aria-label="Enable PRD"]')).toBeTruthy();
  expect(container.textContent).toContain("Removed “Bugs” from MonoCode");
});

it("does not claim verification succeeded when authentication fails", async () => {
  status.connected = false;
  await render();
  await input("Lark App ID", "cli_demo");
  await input("Lark App Secret", "invalid");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Invalid credentials"));
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Invalid credentials",
  );
  expect(container.textContent).not.toContain("App credentials verified");
});

it("requires deliberate selection for an empty Base preview", async () => {
  await render();
  await input("Lark source links", base.url);
  vi.mocked(invoke).mockResolvedValueOnce([
    { ...preview(base), samples: [], warning: "Check advanced permissions" },
  ]);
  await click("Validate links");
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Select Bugs"]')!
      .checked,
  ).toBe(false);
  expect(container.textContent).toContain("Check advanced permissions");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command === "lark_save_source"),
  ).toBe(false);
});
