import type { LarkSource, LarkSourceKind } from "../model/lark";

export function LarkSourceSelector({
  kind,
  sourceId,
  sources,
  onKind,
  onSource,
  onManage,
}: {
  kind: LarkSourceKind;
  sourceId: string;
  sources: readonly LarkSource[];
  onKind: (kind: LarkSourceKind) => void;
  onSource: (id: string) => void;
  onManage: () => void;
}) {
  return (
    <div className="space-y-2 border-b border-stroke px-3 py-2">
      <div
        role="tablist"
        aria-label="Lark content type"
        className="flex gap-1 rounded-md bg-content/5 p-0.5"
      >
        {(["base", "document"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={kind === option}
            className={`flex-1 rounded px-2 py-1 text-[12px] ${kind === option ? "bg-selection text-content" : "text-content/45 hover:text-content"}`}
            onClick={() => onKind(option)}
          >
            {option === "base" ? "Table records" : "Documents"}
          </button>
        ))}
      </div>
      <select
        aria-label="Lark source"
        className="h-7 w-full rounded-md border border-content/10 bg-surface px-2 text-[12px] text-content/70"
        value={sourceId}
        onChange={(event) => onSource(event.target.value)}
      >
        <option value="">
          {kind === "base" ? "All enabled tables" : "All enabled documents"}
        </option>
        {sources
          .filter((entry) => entry.enabled && entry.kind === kind)
          .map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
      </select>
      <button
        type="button"
        className="text-[11px] text-content/45 hover:text-content"
        onClick={onManage}
      >
        Manage sources and permissions
      </button>
    </div>
  );
}
