import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { InboxView } from "../../src/features/inbox/ui/InboxView";
import { LINEAR_CHANGE_EVENT } from "../../src/features/inbox/model/linear";
import "../../src/styles/index.css";

const parameters = new URLSearchParams(location.search);
const connections = {
  github: true,
  linear: true,
  jira: parameters.has("all"),
  gitlab: true,
  azuredevops: parameters.has("all"),
  lark: true,
};
mockWindows("main");
mockIPC(
  (command) => {
    if (command === "lark_status")
      return { connected: true, realm: "lark", appId: "fixture", sources: [] };
    const provider = {
      git_github_status: "github",
      linear_status: "linear",
      jira_status: "jira",
      gitlab_status: "gitlab",
      azure_devops_status: "azuredevops",
    }[command] as keyof typeof connections | undefined;
    if (provider)
      return {
        connected: connections[provider],
        installed: true,
        authenticated: true,
      };
    if (command === "lark_inbox") return { items: [], errors: [] };
    if (
      command === "git_github_repositories" ||
      command === "git_github_work_items" ||
      command.includes("_list_")
    )
      return [];
    if (command.endsWith("_repo")) return "";
    if (command === "plugin:window|is_maximized") return false;
    throw new Error(`Unexpected fixture command: ${command}`);
  },
  { shouldMockEvents: true },
);
localStorage.setItem("monocode.inboxConnections", JSON.stringify(connections));
if (!localStorage.getItem("monocode.inboxSource"))
  localStorage.setItem(
    "monocode.inboxSource",
    parameters.get("source") ?? "lark",
  );

function Fixture() {
  const [linearConnected, setLinearConnected] = useState(true);
  const [integration, setIntegration] = useState("");
  const [closed, setClosed] = useState(false);
  return (
    <div className="flex h-full flex-col bg-surface text-content">
      <header className="flex h-10 shrink-0 items-center gap-4 border-b border-stroke px-3 text-[12px]">
        <span>Inbox tabs · Mock API</span>
        <button
          onClick={() => {
            connections.linear = !linearConnected;
            setLinearConnected(!linearConnected);
            window.dispatchEvent(new Event(LINEAR_CHANGE_EVENT));
          }}
        >
          {linearConnected ? "Disconnect Linear" : "Connect Linear"}
        </button>
        <span role="status">{integration}</span>
      </header>
      {closed ? (
        <span>Inbox closed</span>
      ) : (
        <InboxView
          cwd="/fixture/project"
          recents={[]}
          besideRail
          onAsk={async () => "fixture-session"}
          onAskRestart={async () => "fixture-session"}
          onAskMount={() => {}}
          onOpenIntegrations={setIntegration}
          onClose={() => setClosed(true)}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
