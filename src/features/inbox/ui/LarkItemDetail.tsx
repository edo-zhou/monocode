import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import type { InboxItem } from "../model/githubTasks";
import { larkItemDetails, type LarkDetails } from "../model/lark";

export function LarkItemDetail({
  item,
  projects,
  cwd,
  revision,
  onDiscuss,
  onStart,
}: {
  item: InboxItem;
  projects: readonly { path: string; name: string }[];
  cwd: string;
  revision: number;
  onDiscuss?: () => void;
  onStart?: (item: InboxItem, body?: string) => void | Promise<void>;
}) {
  const [details, setDetails] = useState<LarkDetails | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [project, setProject] = useState(() =>
    projects.some((entry) => entry.path === cwd)
      ? cwd
      : (projects[0]?.path ?? ""),
  );
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setDetails(null);
    void larkItemDetails(item)
      .then((next) => {
        if (!cancelled) setDetails(next);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.teamId, item.larkRecordId, item.updatedAt, revision]);
  const document = item.larkKind === "document";
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-5 text-[13px] text-content">
      <div className="mb-2 text-[11px] text-content/45">
        Lark · {document ? "Document" : "Base record"} · Read-only
      </div>
      <h2 className="break-words text-lg font-semibold">{item.title}</h2>
      <p className="mt-1 break-words text-[12px] text-content/50">
        {item.teamName}
        {!document && item.stateType ? ` · ${item.stateType}` : ""}
      </p>
      <div className="my-4 flex flex-wrap items-center gap-2">
        <SecondaryButton disabled={loading || !!error} onClick={onDiscuss}>
          Ask
        </SecondaryButton>
        {onStart ? (
          <>
            <SecondaryButton
              disabled={
                !details ||
                loading ||
                !!error ||
                starting ||
                !projects.some((entry) => entry.path === project)
              }
              onClick={() => {
                if (!details || starting) return;
                setStarting(true);
                setActionError("");
                void Promise.resolve()
                  .then(() =>
                    onStart({ ...item, projectPath: project }, details.body),
                  )
                  .catch((error: unknown) =>
                    setActionError(
                      error instanceof Error ? error.message : String(error),
                    ),
                  )
                  .finally(() => setStarting(false));
              }}
            >
              {starting
                ? "Sending…"
                : document
                  ? "Use as context"
                  : "Send to agent"}
            </SecondaryButton>
            <select
              aria-label="Lark work project"
              className="h-7 max-w-56 rounded-md border border-content/10 bg-surface px-2 text-[12px]"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            >
              {!projects.length ? (
                <option value="">Add a local project first</option>
              ) : null}
              {projects.map((entry) => (
                <option value={entry.path} key={entry.path}>
                  {entry.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <SecondaryButton
          onClick={() =>
            void openUrl(item.url).catch((error: unknown) =>
              setActionError(String(error)),
            )
          }
        >
          Open in Lark
        </SecondaryButton>
      </div>
      {document ? (
        <p className="mb-3 rounded-md bg-content/5 p-2 text-[12px] text-content/50">
          Plain-text document context. Images, embedded tables and comments
          remain in Lark. This is not a Bug or task record.
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-content/45">
          Loading source content…
        </p>
      ) : null}
      {error || actionError ? (
        <p role="alert" className="mb-3 text-red-400">
          {error || actionError}
        </p>
      ) : null}
      {details?.truncated ? (
        <p className="mb-2 text-amber-500">
          Content is truncated. Open the source for the complete document or
          record.
        </p>
      ) : null}
      {details ? (
        <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-content/80">
          {details.body || "No text content"}
        </pre>
      ) : null}
    </div>
  );
}
