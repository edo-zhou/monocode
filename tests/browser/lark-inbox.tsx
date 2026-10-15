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

Object.assign(window, {
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
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
  const [settings, setSettings] = useState(true);
  const [sent, setSent] = useState("");
  const [revoked, setRevoked] = useState(false);
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
      ) : (
        <InboxView
          cwd="/fixture/project"
          recents={[]}
          besideRail
          onAsk={async () => "fixture-session"}
          onAskRestart={async () => "fixture-session"}
          onAskMount={() => {}}
          onOpenIntegrations={() => setSettings(true)}
          onStart={async (item, body) => {
            setSent(`Context sent: ${item.title} / ${body}`);
          }}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
