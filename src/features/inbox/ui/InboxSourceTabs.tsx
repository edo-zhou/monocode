import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "../../../shared/ui/icons";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { moveItem } from "../../../shared/lib/reorder";
import { INBOX_SOURCE_LABELS, type InboxSource } from "../model/inboxFilters";
import { InboxProviderMark } from "./InboxProviderMark";

type Props = {
  sources: InboxSource[];
  selected: InboxSource;
  onSelect: (source: InboxSource) => void;
  onReorder: (sources: InboxSource[]) => void;
  trailing?: ReactNode;
};

export function InboxSourceTabs({
  sources,
  selected,
  onSelect,
  onReorder,
  trailing,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabs = useRef(new Map<InboxSource, HTMLButtonElement>());
  const pointer = useRef({ x: 0, y: 0 });
  const instructionsId = useId();
  const [announcement, setAnnouncement] = useState("");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const setStripRef = useCallback(
    (element: HTMLDivElement | null) => {
      stripRef.current = element;
      lockOverscroll(element);
    },
    [lockOverscroll],
  );
  const [overflow, setOverflow] = useState({
    needed: false,
    left: false,
    right: false,
  });
  const sourcesKey = [...sources].sort().join(",");

  const reveal = useCallback((source: InboxSource) => {
    const strip = stripRef.current;
    const tab = tabs.current.get(source);
    if (!strip || !tab) return;
    const viewport = strip.getBoundingClientRect();
    const bounds = tab.getBoundingClientRect();
    if (bounds.left < viewport.left)
      strip.scrollLeft += bounds.left - viewport.left;
    else if (bounds.right > viewport.right)
      strip.scrollLeft += bounds.right - viewport.right;
  }, []);

  function reorder(next: InboxSource[], moved: InboxSource) {
    onReorder(next);
    setAnnouncement(
      `${INBOX_SOURCE_LABELS[moved]} moved to position ${next.indexOf(moved) + 1} of ${next.length}.`,
    );
    requestAnimationFrame(() => {
      tabs.current.get(moved)?.focus({ preventScroll: true });
      reveal(moved);
    });
  }
  const sortable = useAnimatedReorder(sources, reorder);

  function onKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    source: InboxSource,
  ) {
    if (sortable.draggingId || event.ctrlKey || event.metaKey) return;
    const index = sources.indexOf(source);
    const direction =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (event.altKey) {
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = Math.max(
        0,
        Math.min(sources.length - 1, index + direction),
      );
      if (destination !== index)
        reorder(moveItem(sources, index, destination), source);
      return;
    }
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    const next =
      event.key === "Home"
        ? sources[0]
        : event.key === "End"
          ? sources[sources.length - 1]
          : sources[(index + direction + sources.length) % sources.length];
    onSelect(next);
    tabs.current.get(next)?.focus({ preventScroll: true });
    reveal(next);
  }

  useEffect(() => {
    const strip = stripRef.current;
    const dragged = sortable.draggingId
      ? tabs.current.get(sortable.draggingId)
      : null;
    if (!strip || !dragged) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      if (!dragged.hasAttribute("data-dragging")) return;
      const elapsed = Math.min(now - previous, 32);
      previous = now;
      const bounds = strip.getBoundingClientRect();
      const { x, y } = pointer.current;
      if (y >= bounds.top - 12 && y <= bounds.bottom + 12) {
        const velocity =
          x < bounds.left + 24
            ? -Math.min(1, (bounds.left + 24 - x) / 24)
            : x > bounds.right - 24
              ? Math.min(1, (x - bounds.right + 24) / 24)
              : 0;
        strip.scrollLeft += velocity * elapsed * 0.7;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sortable.draggingId]);

  const syncOverflow = useCallback(() => {
    const strip = stripRef.current;
    const container = containerRef.current;
    if (!strip || !container) return;
    const next = {
      needed: strip.scrollWidth > container.clientWidth + 1,
      left: strip.scrollLeft > 1,
      right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1,
    };
    setOverflow((current) =>
      current.needed === next.needed &&
      current.left === next.left &&
      current.right === next.right
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const strip = stripRef.current;
    if (!container || !strip) return;
    const onResize = () => {
      reveal(selectedRef.current);
      syncOverflow();
    };
    const onWheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.deltaX !== 0 ||
        event.deltaY === 0 ||
        strip.scrollWidth <= strip.clientWidth
      )
        return;
      event.preventDefault();
      const scale =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? strip.clientWidth
            : 1;
      strip.scrollLeft += event.deltaY * scale;
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    observer.observe(strip);
    strip.addEventListener("scroll", syncOverflow, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: false });
    onResize();
    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", syncOverflow);
      container.removeEventListener("wheel", onWheel);
    };
  }, [sourcesKey, reveal, syncOverflow]);

  useLayoutEffect(() => {
    reveal(selected);
    syncOverflow();
  }, [selected, reveal, syncOverflow]);

  function scroll(direction: -1 | 1) {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({
      left: direction * Math.max(strip.clientWidth * 0.75, 112),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  return (
    <div className="flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-stroke px-2">
      {sources.length > 0 ? (
        <div
          ref={containerRef}
          className="flex h-full min-w-0 flex-1 items-center gap-0.5"
          onPointerMove={(event) => {
            pointer.current = { x: event.clientX, y: event.clientY };
          }}
        >
          {overflow.needed ? (
            <button
              type="button"
              aria-label="Scroll inbox sources left"
              title="Scroll sources left"
              disabled={!overflow.left}
              onClick={() => scroll(-1)}
              className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-content/60 hover:bg-content/5 disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronLeft className="size-3.5" />
            </button>
          ) : null}
          <div
            ref={setStripRef}
            role="tablist"
            aria-label="Inbox source"
            className="scrollbar-none flex h-full min-w-0 flex-1 items-center gap-px overflow-x-auto overflow-y-hidden overscroll-none"
          >
            {sources.map((source) => (
              <button
                key={source}
                ref={(element) => {
                  if (element) tabs.current.set(source, element);
                  else tabs.current.delete(source);
                  sortable.setItemRef(source, element);
                }}
                type="button"
                role="tab"
                aria-selected={selected === source}
                aria-describedby={instructionsId}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                tabIndex={selected === source ? 0 : -1}
                title={`${INBOX_SOURCE_LABELS[source]} — Drag to reorder, or Alt+Left/Right`}
                onPointerDown={(event) =>
                  sortable.onItemPointerDown(source, event)
                }
                onKeyDown={(event) => onKeyDown(event, source)}
                onClick={(event) => {
                  if (event.detail === 0 || !sortable.consumeClick())
                    onSelect(source);
                }}
                className={`reorder-item relative flex h-6 shrink-0 touch-none select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] leading-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-content/50 ${selected === source ? "bg-selection text-content" : "text-content/50 hover:bg-content/5 hover:text-content"} data-[dragging]:bg-selection data-[dragging]:text-content`}
              >
                <InboxProviderMark
                  provider={source}
                  className="block size-3.5 shrink-0"
                />
                <span>{INBOX_SOURCE_LABELS[source]}</span>
              </button>
            ))}
          </div>
          {overflow.needed ? (
            <button
              type="button"
              aria-label="Scroll inbox sources right"
              title="Scroll sources right"
              disabled={!overflow.right}
              onClick={() => scroll(1)}
              className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-content/60 hover:bg-content/5 disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronRight className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      {trailing}
      <span id={instructionsId} className="sr-only">
        Use Left and Right to select a source. Drag or use Alt+Left and
        Alt+Right to reorder sources.
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  );
}
