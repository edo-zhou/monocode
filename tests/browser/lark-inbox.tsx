import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LarkSettings } from "../../src/features/settings/ui/LarkSettings";
import { InboxView } from "../../src/features/inbox/ui/InboxView";
import type { LarkSource } from "../../src/features/inbox/model/lark";
import "../../src/styles/index.css";

const status = {
  connected: true,
  realm: "lark",
  appId: "cli_fixture",
  sources: [] as LarkSource[],
};
const mapping = {
  title: "title",
  status: "status",
  assignee: "",
  closedValues: ["Done"],
};
let backendAccessRevoked = false;
let previewAttempts = 0;
let removeAttempts = 0;
const recordsFixture = new URLSearchParams(location.search).has("records");
function recordFields(sourceId: unknown) {
  return [
    {
      id: "attachments",
      name: "Screenshots",
      kind: 17,
      value: [
        {
          file_token: "imageA",
          name: "checkout.png",
          type: "image/png",
          size: 1024,
        },
        {
          file_token: "fileA",
          name: "debug.log",
          type: "text/plain",
          size: 2048,
        },
      ],
    },
    {
      id: "description",
      name: "Description",
      kind: 1,
      value: [{ text: `Reproduction steps for ${sourceId}` }],
    },
    {
      id: "due",
      name: "Due date",
      kind: 5,
      dateFormat: "yyyy/MM/dd",
      value: 1792051200000,
    },
    { id: "created", name: "Created", kind: 1001, value: 1792051200000 },
    {
      id: "owner",
      name: "Owner",
      kind: 11,
      value: [
        { name: "Kai", id: "ou_one" },
        { name: "Alex", id: "ou_two" },
      ],
    },
    { id: "labels", name: "Labels", kind: 4, value: ["Regression", "UI"] },
    { id: "verified", name: "Verified", kind: 7, value: false },
    { id: "count", name: "Count", kind: 2, value: 0 },
    { id: "empty", name: "Empty field", kind: 1, value: null },
    {
      id: "formula",
      name: "Calculated date",
      kind: 20,
      value: { type: 5, value: [1792051200000] },
    },
    {
      id: "link",
      name: "Reference",
      kind: 15,
      value: { text: "Specification", link: "https://example.com/spec" },
    },
    {
      id: "unsafe",
      name: "Unsafe link",
      kind: 15,
      value: { text: "Untrusted reference", link: "javascript:alert(1)" },
    },
    { id: "invalid", name: "Invalid date", kind: 5, value: "not-a-date" },
    {
      id: "exact",
      name: "Exact number",
      kind: 2,
      value: "9007199254740993123",
    },
    {
      id: "otherfiles",
      name: "Other files",
      kind: 17,
      value: [
        {
          file_token: "big",
          name: "large.png",
          type: "image/png",
          size: 9 * 1024 * 1024,
        },
        {
          file_token: "svg",
          name: "diagram.svg",
          type: "image/svg+xml",
          size: 256,
        },
      ],
    },
  ].map((field) => ({ primary: false, options: [], ...field }));
}
function source(url: string): LarkSource {
  const document = url.includes("docx");
  const second = url.includes("BaseB");
  const token = document ? "DocA" : second ? "BaseB" : "BaseA";
  return {
    id: token,
    name: document ? "Checkout PRD" : second ? "Backend bugs" : "Frontend bugs",
    kind: document ? "document" : "base",
    url,
    token,
    tableId: document ? "" : "TableA",
    viewId: "",
    enabled: true,
    mapping,
  };
}

if (recordsFixture)
  status.sources = [
    source("https://team.larksuite.com/base/BaseA?table=TableA"),
    ...(new URLSearchParams(location.search).has("all-sources")
      ? [
          source("https://team.larksuite.com/base/BaseB?table=TableA"),
          source("https://team.larksuite.com/docx/DocA"),
        ]
      : []),
  ];

Object.assign(window, {
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "lark_attachment_preview") {
        if (
          !["BaseA", "BaseB"].includes(String(args.sourceId)) ||
          args.recordId !== "recA" ||
          args.fieldId !== "attachments" ||
          args.fileToken !== "imageA"
        )
          throw new Error("Attachment is not part of this record");
        if (
          new URLSearchParams(location.search).has("image-error") &&
          previewAttempts++ === 0
        )
          throw new Error("Attachment access denied. Open the source in Lark.");
        return "/monocode.png";
      }
      if (command === "set_trackpad_zoom_enabled") return;
      if (command === "lark_status") return structuredClone(status);
      if (command.endsWith("_status"))
        return { connected: false, installed: false, authenticated: false };
      if (command === "lark_preview_source") {
        if (String(args.url).includes("Private"))
          throw new Error("Access denied: share this source with the app");
        return [
          {
            source: source(String(args.url)),
            fields: [
              {
                id: "title",
                name: "Title",
                kind: 1,
                primary: true,
                options: [],
              },
              {
                id: "status",
                name: "Status",
                kind: 3,
                primary: false,
                options: ["Done"],
              },
            ],
            samples: ["Verified sample content"],
            warning: "",
          },
        ];
      }
      if (command === "lark_save_source") {
        const saved = args.source as LarkSource;
        status.sources = [
          ...status.sources.filter((entry) => entry.id !== saved.id),
          saved,
        ];
        return saved;
      }
      if (command === "lark_toggle_source") {
        status.sources = status.sources.map((entry) =>
          entry.id === args.id
            ? { ...entry, enabled: Boolean(args.enabled) }
            : entry,
        );
        return;
      }
      if (command === "lark_remove_source") {
        if (
          new URLSearchParams(location.search).has("remove-error") &&
          removeAttempts++ === 0
        ) {
          await new Promise<void>((resolve) =>
            window.addEventListener("fixture:fail-removal", () => resolve(), {
              once: true,
            }),
          );
          throw new Error("Could not save Lark settings");
        }
        status.sources = status.sources.filter((entry) => entry.id !== args.id);
        return;
      }
      if (command === "lark_check_connection") return;
      if (command === "lark_inbox")
        return {
          items: status.sources
            .filter(
              (entry) =>
                entry.enabled &&
                !(backendAccessRevoked && entry.id === "BaseB"),
            )
            .map((entry) => ({
              id: `${entry.id}:recA`,
              sourceId: entry.id,
              recordId: entry.kind === "document" ? "" : "recA",
              sourceName: entry.name,
              kind: entry.kind,
              title:
                entry.kind === "document"
                  ? "Checkout PRD"
                  : entry.id === "BaseA"
                    ? "Checkout bug"
                    : "Auth bug",
              url: entry.url,
              state: "In progress",
              closed: false,
              updatedAt:
                entry.kind === "document" ? "" : "2026-10-15T08:00:00Z",
              assignees: ["Kai"],
            })),
          errors:
            backendAccessRevoked &&
            status.sources.some(
              (entry) => entry.id === "BaseB" && entry.enabled,
            )
              ? ["Backend bugs: access denied"]
              : [],
        };
      if (command === "lark_item_details")
        return {
          body:
            args.sourceId === "DocA"
              ? "Document acceptance requirements"
              : `Reproduction steps for ${args.sourceId}`,
          truncated: false,
          fields: args.sourceId === "DocA" ? [] : recordFields(args.sourceId),
        };
      if (
        command === "git_github_repositories" ||
        command === "git_list_branches"
      )
        return [];
      if (command.startsWith("plugin:event|")) return 1;
      if (command.startsWith("plugin:window|")) return false;
      throw new Error(`Unexpected fixture command: ${command}`);
    },
  },
});
localStorage.clear();
localStorage.setItem("monocode.inboxSource", "lark");
localStorage.setItem(
  "monocode.inboxConnections",
  JSON.stringify({
    github: false,
    linear: false,
    jira: false,
    gitlab: false,
    azuredevops: false,
    lark: true,
  }),
);

function Fixture() {
  const [settings, setSettings] = useState(
    !recordsFixture || new URLSearchParams(location.search).has("settings"),
  );
  const [sent, setSent] = useState("");
  const [revoked, setRevoked] = useState(false);
  const [closed, setClosed] = useState(false);
  return (
    <div className="flex h-full flex-col bg-surface text-content">
      <header className="flex flex-wrap items-center gap-4 border-b border-stroke p-3 text-[12px]">
        <span>Lark integration fixture · Mock API</span>
        <button onClick={() => setSettings(!settings)}>
          {settings ? "View Inbox" : "Manage Lark"}
        </button>
        <span role="status">{sent}</span>
        <button
          onClick={() => {
            backendAccessRevoked = !revoked;
            setRevoked(!revoked);
          }}
        >
          {revoked ? "Restore access" : "Revoke access"}
        </button>
      </header>
      {settings ? (
        <main className="mx-auto w-full max-w-3xl overflow-y-auto">
          <LarkSettings />
        </main>
      ) : closed ? (
        <span>Inbox closed</span>
      ) : (
        <InboxView
          cwd="/fixture/project"
          recents={[]}
          besideRail
          onAsk={async () => "fixture-session"}
          onAskRestart={async () => "fixture-session"}
          onAskMount={() => {}}
          onOpenIntegrations={() => setSettings(true)}
          onClose={() => setClosed(true)}
          onStart={async (item, body) => {
            setSent(`Context sent: ${item.title} / ${body}`);
          }}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
