import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { clearInboxCache } from "../../inbox/model/githubTasks";
import {
  checkLarkConnection,
  connectLark,
  disconnectLark,
  larkConnected,
  previewLarkSource,
  removeLarkSource,
  saveLarkSource,
  splitLarkLinks,
  toggleLarkSource,
  type LarkPreview,
  type LarkRealm,
  type LarkSource,
  type LarkStatus,
} from "../../inbox/model/lark";

const INPUT =
  "h-8 w-full rounded-md border border-content/10 bg-transparent px-2 text-[12px] text-content outline-none focus:border-content/30 disabled:opacity-50";
type Candidate = LarkPreview & { selected: boolean; closedText: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LarkSettings() {
  const [status, setStatus] = useState<LarkStatus | null>(null);
  const [realm, setRealm] = useState<LarkRealm>("lark");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [links, setLinks] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState("Loading connection…");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    void larkConnected()
      .then((next) => {
        if (request !== generation.current) return;
        setStatus(next);
        setRealm(next.realm);
        setAppId(next.appId);
      })
      .catch((error: unknown) => {
        if (request === generation.current) setError(message(error));
      })
      .finally(() => {
        if (request === generation.current) setBusy("");
      });
    return () => {
      generation.current += 1;
    };
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy("");
    }
  }

  async function refreshSources() {
    clearInboxCache();
    setStatus(await larkConnected());
  }

  async function validate(text: string, editing?: LarkSource) {
    const urls = splitLarkLinks(text);
    if (!urls.length)
      throw new Error("Paste at least one Base, Docx or Wiki link.");
    const request = ++generation.current;
    setCandidates([]);
    setFailures([]);
    const seen = new Set<string>();
    for (const [index, url] of urls.entries()) {
      setBusy(`Validating link ${index + 1} of ${urls.length}…`);
      try {
        const previews = await previewLarkSource(url);
        if (request !== generation.current) return;
        const unique = previews.filter((preview) => {
          if (seen.has(preview.source.id)) return false;
          seen.add(preview.source.id);
          return true;
        });
        setCandidates((current) => [
          ...current,
          ...unique.map((preview) => ({
            ...preview,
            source:
              editing?.id === preview.source.id
                ? {
                    ...preview.source,
                    name: editing.name,
                    mapping: editing.mapping,
                    enabled: editing.enabled,
                  }
                : preview.source,
            selected:
              editing?.id === preview.source.id ||
              (preview.samples.length > 0 &&
                !status?.sources.some(
                  (source) => source.id === preview.source.id,
                )),
            closedText: (editing?.id === preview.source.id
              ? editing.mapping
              : preview.source.mapping
            ).closedValues.join(", "),
          })),
        ]);
      } catch (error) {
        if (request !== generation.current) return;
        setFailures((current) => [...current, `${url}: ${message(error)}`]);
      }
    }
    if (request === generation.current)
      setNotice(
        "Validation only. Review the preview and confirm before adding any source.",
      );
  }

  function updateCandidate(id: string, change: Partial<Candidate>) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.source.id === id ? { ...candidate, ...change } : candidate,
      ),
    );
  }

  async function saveSelected() {
    let saved = 0;
    const errors: string[] = [];
    for (const candidate of candidates.filter(
      (candidate) => candidate.selected,
    )) {
      try {
        await saveLarkSource(candidate.source);
        saved += 1;
        setCandidates((current) =>
          current.filter((entry) => entry.source.id !== candidate.source.id),
        );
      } catch (error) {
        errors.push(`${candidate.source.name}: ${message(error)}`);
      }
    }
    await refreshSources();
    setFailures((current) => [...current, ...errors]);
    setNotice(
      `${saved} source${saved === 1 ? "" : "s"} saved. Remote tables and documents were not modified.`,
    );
  }

  const selected = candidates.filter((candidate) => candidate.selected);
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5 text-[12px]">
      <p className="leading-relaxed text-content/55">
        No Lark CLI required. MonoCode reads Base records and Docx/Wiki
        documents directly through the official API. This connection uses your
        own app identity, not your personal Lark login.
      </p>
      <div className="rounded-lg border border-content/10 p-3">
        <h3 className="mb-2 font-medium text-content">
          1. Verify the app connection
        </h3>
        {status?.connected ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto break-all text-content/65">
              {status.realm === "lark" ? "Lark" : "Feishu"} · {status.appId} ·
              Configured
            </span>
            <SecondaryButton
              disabled={!!busy}
              onClick={() =>
                void run("Checking connection…", async () => {
                  await checkLarkConnection();
                  setNotice(
                    "App credentials verified. Each source still needs its own access check.",
                  );
                })
              }
            >
              Check connection
            </SecondaryButton>
            <SecondaryButton
              disabled={!!busy}
              onClick={() =>
                void run("Disconnecting…", async () => {
                  await disconnectLark();
                  setSecret("");
                  setCandidates([]);
                  setFailures([]);
                  await refreshSources();
                  setNotice(
                    "Disconnected. Saved credentials and source settings removed; remote content is unchanged.",
                  );
                })
              }
            >
              Disconnect
            </SecondaryButton>
          </div>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run("Verifying app credentials…", async () => {
                setStatus(await connectLark(realm, appId, secret));
                setSecret("");
                clearInboxCache();
                setNotice(
                  "App credentials verified. Next, validate the links you want to add.",
                );
              });
            }}
          >
            <label className="flex flex-col gap-1 text-content/65">
              Region
              <select
                aria-label="Lark region"
                className={INPUT}
                value={realm}
                disabled={!!busy}
                onChange={(event) => setRealm(event.target.value as LarkRealm)}
              >
                <option value="lark">Lark (larksuite.com)</option>
                <option value="feishu">Feishu (feishu.cn)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-content/65">
              App ID
              <input
                aria-label="Lark App ID"
                className={INPUT}
                value={appId}
                disabled={!!busy}
                required
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
                onChange={(event) => setAppId(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-content/65">
              App Secret
              <input
                aria-label="Lark App Secret"
                type="password"
                className={INPUT}
                value={secret}
                disabled={!!busy}
                required
                autoComplete="off"
                maxLength={4096}
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
            <p className="text-content/45">
              Use a self-built app you control. The secret is kept in your
              system credential store, never in source settings or browser
              storage. Do not distribute a shared app secret to end users.
            </p>
            <div>
              <SecondaryButton
                type="submit"
                disabled={!!busy || !appId.trim() || !secret.trim()}
              >
                Verify and connect
              </SecondaryButton>
            </div>
          </form>
        )}
        <details className="mt-3 text-content/55">
          <summary className="cursor-pointer">
            Required permissions and setup
          </summary>
          <div className="mt-2 space-y-2 leading-relaxed">
            <p>
              Create and publish a self-built app. Request read-only scopes:{" "}
              <code>bitable:app:readonly</code>,{" "}
              <code>docx:document:readonly</code>, and{" "}
              <code>wiki:wiki:readonly</code> for Wiki links.
            </p>
            <p>
              Grant the app access to each Base/document or Wiki space. API
              scopes alone do not grant resource access. Base advanced
              permissions can hide records even when the API succeeds.
            </p>
            <p>
              App identity cannot infer “assigned to me”. Use a Base view
              filtered to the desired owner and paste that view link. The view
              filter is preserved.
            </p>
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() =>
                void openUrl(
                  `https://open.${realm === "lark" ? "larksuite.com" : "feishu.cn"}/app`,
                ).catch((error: unknown) => setError(message(error)))
              }
            >
              Open developer console
            </button>
          </div>
        </details>
      </div>

      {status?.connected ? (
        <>
          <div className="rounded-lg border border-content/10 p-3">
            <h3 className="mb-2 font-medium text-content">
              2. Add and validate links
            </h3>
            <p className="mb-2 text-content/45">
              One link per line, up to 20 at a time. A Base link without a table
              expands into its tables. Wiki links resolve to their actual Base
              or document. Nothing is added until you confirm.
            </p>
            <textarea
              aria-label="Lark source links"
              className={`${INPUT} min-h-24 resize-y py-2`}
              value={links}
              disabled={!!busy}
              maxLength={20000}
              placeholder="https://team.larksuite.com/base/…?table=…&view=…\nhttps://team.larksuite.com/wiki/…"
              onChange={(event) => setLinks(event.target.value)}
            />
            <div className="mt-2">
              <SecondaryButton
                disabled={!!busy || !links.trim()}
                onClick={() =>
                  void run("Validating links…", () => validate(links))
                }
              >
                Validate links
              </SecondaryButton>
            </div>
          </div>
          {candidates.length ? (
            <div className="space-y-3">
              <h3 className="font-medium text-content">
                3. Review and confirm sources
              </h3>
              {candidates.map((candidate) => (
                <div
                  key={candidate.source.id}
                  className="rounded-lg border border-content/10 p-3"
                >
                  <label className="mb-2 flex items-start gap-2 font-medium text-content">
                    <input
                      type="checkbox"
                      aria-label={`Select ${candidate.source.name}`}
                      checked={candidate.selected}
                      disabled={!!busy}
                      onChange={(event) =>
                        updateCandidate(candidate.source.id, {
                          selected: event.target.checked,
                        })
                      }
                    />
                    <span>
                      {candidate.source.kind === "base"
                        ? "Base table"
                        : "Document"}{" "}
                      · {candidate.source.name}
                    </span>
                  </label>
                  <label className="flex flex-col gap-1 text-content/60">
                    Source name
                    <input
                      aria-label={`Name for ${candidate.source.id}`}
                      className={INPUT}
                      value={candidate.source.name}
                      disabled={!!busy}
                      maxLength={200}
                      onChange={(event) =>
                        updateCandidate(candidate.source.id, {
                          source: {
                            ...candidate.source,
                            name: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  {candidate.source.kind === "base" ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {(["title", "status", "assignee"] as const).map((key) => (
                        <label
                          key={key}
                          className="flex flex-col gap-1 capitalize text-content/60"
                        >
                          {key} field{key === "title" ? " *" : ""}
                          <select
                            aria-label={`${key} field for ${candidate.source.id}`}
                            className={INPUT}
                            value={candidate.source.mapping[key]}
                            disabled={!!busy}
                            onChange={(event) =>
                              updateCandidate(candidate.source.id, {
                                ...(key === "status" ? { closedText: "" } : {}),
                                source: {
                                  ...candidate.source,
                                  mapping: {
                                    ...candidate.source.mapping,
                                    [key]: event.target.value,
                                    ...(key === "status"
                                      ? { closedValues: [] }
                                      : {}),
                                  },
                                },
                              })
                            }
                          >
                            <option value="">
                              {key === "title"
                                ? "Choose a field"
                                : "Not mapped"}
                            </option>
                            {candidate.fields
                              .filter(
                                (field) =>
                                  key !== "assignee" || field.kind === 11,
                              )
                              .map((field) => (
                                <option key={field.id} value={field.id}>
                                  {field.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                      <label className="flex flex-col gap-1 text-content/60">
                        Closed status values (comma-separated)
                        <input
                          aria-label={`Closed values for ${candidate.source.id}`}
                          className={INPUT}
                          value={candidate.closedText}
                          disabled={!!busy || !candidate.source.mapping.status}
                          onChange={(event) =>
                            updateCandidate(candidate.source.id, {
                              closedText: event.target.value,
                              source: {
                                ...candidate.source,
                                mapping: {
                                  ...candidate.source.mapping,
                                  closedValues: event.target.value
                                    .split(/[,，]/)
                                    .map((value) => value.trim())
                                    .filter(Boolean),
                                },
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                  <div className="mt-2 whitespace-pre-wrap break-words rounded-md bg-content/5 p-2 text-content/65">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-content/40">
                      Access verified · Sample content
                    </p>
                    {candidate.samples.length ? (
                      candidate.samples.map((sample, index) => (
                        <p key={index} className="line-clamp-5">
                          {sample}
                        </p>
                      ))
                    ) : (
                      <p>No visible records</p>
                    )}
                  </div>
                  {candidate.source.viewId ? (
                    <p className="mt-2 text-content/45">
                      Only records visible in view {candidate.source.viewId}{" "}
                      will be imported.
                    </p>
                  ) : null}
                  {candidate.warning ? (
                    <p className="mt-2 text-amber-500">{candidate.warning}</p>
                  ) : null}
                  {status.sources.some(
                    (source) => source.id === candidate.source.id,
                  ) ? (
                    <p className="mt-2 text-content/45">
                      Already added. Select to update this source, not create a
                      duplicate.
                    </p>
                  ) : null}
                </div>
              ))}
              <SecondaryButton
                disabled={
                  !!busy ||
                  !selected.length ||
                  selected.some(
                    (candidate) =>
                      candidate.source.kind === "base" &&
                      !candidate.source.mapping.title,
                  )
                }
                onClick={() => void run("Saving sources…", saveSelected)}
              >
                Confirm {selected.length} source
                {selected.length === 1 ? "" : "s"}
              </SecondaryButton>
            </div>
          ) : null}
          {(["base", "document"] as const).map((kind) => (
            <div key={kind} className="space-y-2">
              <h3 className="font-medium text-content">
                {kind === "base" ? "Table sources" : "Documents"}{" "}
                <span className="text-content/40">
                  (
                  {
                    status.sources.filter((source) => source.kind === kind)
                      .length
                  }
                  )
                </span>
              </h3>
              {status.sources
                .filter((source) => source.kind === kind)
                .map((source) => (
                  <div
                    key={source.id}
                    className="rounded-lg border border-content/10 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        aria-label={`Enable ${source.name}`}
                        checked={source.enabled}
                        disabled={!!busy}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          void run("Updating source…", async () => {
                            await toggleLarkSource(source.id, enabled);
                            await refreshSources();
                          });
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-content/80">
                          {source.name}
                        </p>
                        <p className="mt-1 break-all text-[11px] text-content/40">
                          {source.url}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-3">
                      <button
                        type="button"
                        disabled={!!busy}
                        className="text-content/60 hover:text-content disabled:opacity-40"
                        onClick={() =>
                          void run("Validating source…", () =>
                            validate(source.url, source),
                          )
                        }
                      >
                        Validate / edit
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        aria-label={`Remove ${source.name}`}
                        className="text-content/45 hover:text-red-400 disabled:opacity-40"
                        onClick={() =>
                          void run("Removing source…", async () => {
                            await removeLarkSource(source.id);
                            await refreshSources();
                          })
                        }
                      >
                        Remove source
                      </button>
                    </div>
                  </div>
                ))}
              {!status.sources.some((source) => source.kind === kind) ? (
                <p className="text-content/40">
                  {kind === "base"
                    ? "No tables added yet."
                    : "No documents added yet. Documents appear separately from table records in Inbox."}
                </p>
              ) : null}
            </div>
          ))}
        </>
      ) : null}
      {busy ? (
        <p role="status" className="text-content/60">
          {busy}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-content/60">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-red-400">
          {error}
        </p>
      ) : null}
      {failures.map((failure, index) => (
        <p role="alert" key={index} className="break-words text-red-400">
          {failure}
        </p>
      ))}
    </div>
  );
}
