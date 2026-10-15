import { useEffect, useRef, useState } from "react";
import type { LarkSource } from "../../inbox/model/lark";
import { Modal } from "../../../shared/ui/Modal";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { LoaderCircle } from "../../../shared/ui/icons";

type Props = {
  source: LarkSource;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function RemoveLarkSourceDialog({ source, onCancel, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const kind = source.kind === "base" ? "table" : "document";

  useEffect(() => {
    cancelRef.current?.focus();
    const dialog = contentRef.current?.closest('[role="dialog"]');
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      if (!buttons.length) return;
      event.preventDefault();
      const currentIndex = buttons.findIndex(
        (button) => button === document.activeElement,
      );
      const nextIndex =
        currentIndex < 0
          ? event.shiftKey
            ? buttons.length - 1
            : 0
          : (currentIndex + (event.shiftKey ? -1 : 1) + buttons.length) %
            buttons.length;
      buttons[nextIndex].focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  async function confirm() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Remove ${kind} source?`}
      size="sm"
      fitViewport
      onClose={() => {
        if (!pending.current) onCancel();
      }}
    >
      <div ref={contentRef} className="space-y-3 px-4 pb-4 pt-3 text-[12px]">
        <div className="rounded-lg border border-content/10 bg-content/5 p-3">
          <p className="break-words font-medium text-content">{source.name}</p>
          <p className="mt-1 break-all text-[11px] text-content/45">
            {source.url}
          </p>
        </div>
        <p className="leading-relaxed text-content/75">
          Only this source is removed from MonoCode. The original Lark {kind}
          {source.kind === "base" ? " and all its records" : ""} will not be
          deleted.
        </p>
        <p className="leading-relaxed text-content/50">
          It will no longer appear in Inbox. Other sources are unaffected. You
          can add this link again later, or disable the source instead to hide
          it temporarily.
        </p>
        {error ? (
          <p role="alert" className="break-words text-red-400">
            Could not remove this source. Try again. {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton ref={cancelRef} disabled={busy} onClick={onCancel}>
            Cancel
          </SecondaryButton>
          <SecondaryButton
            danger
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? (
              <LoaderCircle aria-hidden className="size-3 animate-spin" />
            ) : null}
            {busy ? "Removing…" : "Remove source"}
          </SecondaryButton>
        </div>
        {busy ? (
          <p role="status" className="sr-only">
            Removing source…
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
