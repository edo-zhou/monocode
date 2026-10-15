import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { InboxItem } from "../model/githubTasks";
import { larkObject } from "../model/larkFields";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";

let previewQueue: Promise<void> = Promise.resolve();

async function loadPreview(
  item: InboxItem,
  fieldId: string,
  fileToken: string,
  signal: AbortSignal,
) {
  const previous = previewQueue;
  let release!: () => void;
  previewQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    if (signal.aborted) throw new Error("Preview cancelled");
    return await invoke<string>("lark_attachment_preview", {
      sourceId: item.teamId,
      recordId: item.larkRecordId,
      fieldId,
      fileToken,
    });
  } finally {
    release();
  }
}

function fileSize(size: unknown): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round((size / 1024) * 10) / 10} KB`;
  return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
}

function Attachment({
  item,
  fieldId,
  attachment,
}: {
  item: InboxItem;
  fieldId: string;
  attachment: Record<string, unknown>;
}) {
  const name =
    typeof attachment.name === "string" ? attachment.name : "Attachment";
  const fileToken =
    typeof attachment.file_token === "string" ? attachment.file_token : "";
  const previewable =
    ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
      String(attachment.type),
    ) &&
    !!fileToken &&
    !(typeof attachment.size === "number" && attachment.size > 8 * 1024 * 1024);
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!previewable || !container.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [previewable]);
  useEffect(() => {
    if (!visible || !previewable) return;
    const controller = new AbortController();
    setError("");
    setUrl("");
    void loadPreview(item, fieldId, fileToken, controller.signal)
      .then((url) => {
        if (!controller.signal.aborted) setUrl(url);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, [
    visible,
    previewable,
    item.teamId,
    item.larkRecordId,
    fieldId,
    fileToken,
    retry,
  ]);
  return (
    <div
      ref={container}
      className="min-w-0 rounded-md border border-stroke bg-content/[0.02] p-2"
    >
      {previewable ? (
        <button
          type="button"
          aria-label={`Preview ${name}`}
          disabled={!url || !!error}
          onClick={() => setOpen(true)}
          className="mb-2 flex h-24 w-full items-center justify-center overflow-hidden rounded bg-content/5 text-[11px] text-content/40 enabled:cursor-zoom-in"
        >
          {url && !error ? (
            <img
              src={url}
              alt={name}
              className="h-full w-full object-contain"
              onError={() =>
                setError("Could not decode this image. Open it in Lark.")
              }
            />
          ) : error ? (
            "Preview unavailable"
          ) : (
            "Loading preview…"
          )}
        </button>
      ) : null}
      <div className="break-words text-[12px] leading-5">{name}</div>
      <div className="break-words text-[11px] leading-5 text-content/45">
        {[fileSize(attachment.size), attachment.type]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {error ? (
        <p
          role="alert"
          className="my-1 break-words text-[11px] leading-4 text-red-400"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] leading-5">
        {error && previewable ? (
          <button
            type="button"
            aria-label={`Retry ${name}`}
            onClick={() => setRetry((value) => value + 1)}
            className="text-content/70 underline"
          >
            Retry preview
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void openUrl(item.url).catch((error: unknown) =>
              setError(String(error)),
            );
          }}
          className="text-content/50 underline underline-offset-2"
        >
          Open record in Lark
        </button>
      </div>
      {open && url ? (
        <ImageLightbox src={url} alt={name} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

export function LarkAttachments({
  item,
  fieldId,
  values,
}: {
  item: InboxItem;
  fieldId: string;
  values: unknown[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
        {values.slice(0, expanded ? values.length : 4).map((value, index) => {
          const attachment = larkObject(value);
          return (
            <Attachment
              key={`${String(attachment.file_token)}:${index}`}
              item={item}
              fieldId={fieldId}
              attachment={attachment}
            />
          );
        })}
      </div>
      {!expanded && values.length > 4 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[12px] text-content/60 underline"
        >
          Show all {values.length} attachments
        </button>
      ) : null}
    </div>
  );
}
