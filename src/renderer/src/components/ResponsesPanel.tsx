import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import {
  type KeyboardEvent,
  type MouseEvent,
  memo,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ConversationAids } from '../terminal/conversation';
import { trpcClient, useTRPC } from '../trpc';
import { button, iconButton, keyHint } from '../ui/controls';
import { renderDocument, withImages } from './SpecView';

/** Puts the Claude terminal in focus, as Esc in the Changes panel does. */
const focusTerminal = () =>
  document.querySelector<HTMLElement>('[data-terminal] .xterm-helper-textarea')?.focus();

const time = (at: string | null) =>
  at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

/** The side panel's width: dragged by its left edge, kept in this window's storage. */
const WIDTH_KEY = 'responses-panel-width';
const MIN_WIDTH = 320;
/** At most this share of the workspace area. */
const MAX_SHARE = 0.7;

function savedWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= MIN_WIDTH ? value : null;
  } catch {
    return null;
  }
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Not kept; the panel still works.
  }
}

/**
 * One response as a block: a header (number, the prompt it answers on one
 * line, time, Copy) that expands or collapses it, then its Markdown; collapsed,
 * a few lines fading out.
 */
const ResponseItem = memo(function ResponseItem({
  number,
  text,
  prompt,
  afterBackground,
  at,
  expanded,
  onToggle,
  onReveal,
}: {
  number: number;
  text: string;
  prompt: string | null;
  /** It follows Claude's background work handing back, not a prompt (spec §6.8). */
  afterBackground: boolean;
  at: string | null;
  expanded: boolean;
  onToggle: (number: number) => void;
  /** Scrolls the terminal to it (classic mode); null where it can't. */
  onReveal: ((text: string) => boolean) | null;
}) {
  // Images show as their alt text: a response has no files of its own.
  const html = useMemo(() => withImages(renderDocument(text).html, {}), [text]);
  const [copied, setCopied] = useState(false);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!copied && !missing) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setMissing(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [copied, missing]);
  const copy = () =>
    void trpcClient.clipboard.writeText.mutate({ text }).then(() => setCopied(true));
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element).closest('a');
    if (link) {
      event.preventDefault();
      if (link.hasAttribute('data-doc-external')) {
        void trpcClient.shell.openExternal.mutate({ url: link.getAttribute('href') ?? '' });
      }
      return;
    }
    // Selecting text to copy part of it isn't a click on the response.
    if (window.getSelection()?.toString()) return;
    if (!expanded) onToggle(number);
    if (onReveal && !onReveal(text)) setMissing(true);
  };
  const onHeaderKey = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onToggle(number);
  };
  return (
    <article
      data-response={number}
      data-expanded={expanded ? 'true' : 'false'}
      className="border-b border-line"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: it holds the Copy button, which a button can't */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        data-response-header
        className="flex cursor-pointer items-center gap-2 px-3.5 pt-2.5 pb-1.5 outline-none hover:bg-raised focus-visible:bg-raised"
        title={expanded ? 'Collapse' : 'Expand'}
        onClick={() => onToggle(number)}
        onKeyDown={onHeaderKey}
      >
        <span className="w-3 text-xs text-fg-subtle">{expanded ? '▾' : '▸'}</span>
        <span className="font-mono text-xs font-semibold text-fg-muted">{number}</span>
        <span
          className="min-w-0 flex-1 truncate text-xs text-fg-subtle"
          title={prompt ?? undefined}
        >
          {prompt
            ? `› ${prompt.replace(/\s+/g, ' ')}`
            : afterBackground
              ? 'After background work'
              : ''}
        </span>
        {missing ? (
          <span className="text-xs text-fg-subtle">Not in the terminal</span>
        ) : time(at) ? (
          <span className="font-mono text-xs text-fg-subtle">{time(at)}</span>
        ) : null}
        <button
          type="button"
          data-response-copy
          className={button('ghost', 'sm')}
          title="Copy this response, as Markdown"
          onClick={(event) => {
            event.stopPropagation();
            copy();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: scrolling the terminal is a convenience; the header expands */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: as above */}
      <div
        data-response-body
        className={`doc-markdown mx-3.5 mb-3 rounded-md px-1 select-text ${
          expanded
            ? ''
            : 'max-h-[4.6em] overflow-hidden [mask-image:linear-gradient(to_bottom,black_30%,transparent)]'
        } ${onReveal || !expanded ? 'cursor-pointer hover:bg-raised' : ''}`}
        title={onReveal ? 'Show it in the terminal' : expanded ? undefined : 'Expand'}
        onClick={onClick}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by renderDocument
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
});

/**
 * The Responses panel of a Claude tab (spec §6.8): every response of the
 * conversation, read from the transcript, newest last, each a collapsible
 * block rendered as Markdown with its own Copy. It follows the transcript as
 * Claude writes it. In classic mode a click on a response scrolls the
 * terminal to it. Beside the terminal its left edge resizes it; Full view
 * gives it the whole workspace area.
 */
export function ResponsesPanel({
  workspaceId,
  aids,
  alternate,
  narrow,
  full,
  onToggleFull,
  onClose,
}: {
  workspaceId: string;
  /** The Claude terminal's aids, to scroll to a response. */
  aids: ConversationAids | null;
  /** Claude is in full-screen mode: nothing to scroll to. */
  alternate: boolean;
  narrow: boolean;
  /** It fills the workspace area, the terminal hidden. */
  full: boolean;
  onToggleFull: () => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const responses = useQuery(
    trpc.conversation.responses.queryOptions({ workspaceId }, { staleTime: 0 }),
  );
  useSubscription(
    trpc.conversation.changes.subscriptionOptions(
      { workspaceId },
      {
        onData: () =>
          void queryClient.invalidateQueries({ queryKey: trpc.conversation.responses.queryKey() }),
      },
    ),
  );
  const list = responses.data ?? [];
  const newest = list.length;
  // The newest response is expanded, older ones collapsed, unless toggled.
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const isExpanded = (number: number) => toggled[number] ?? number === newest;
  const toggle = useMemo(
    () => (number: number) =>
      setToggled((current) => ({
        ...current,
        [number]: !(current[number] ?? number === newest),
      })),
    [newest],
  );
  const setAll = (expanded: boolean) =>
    setToggled(Object.fromEntries(list.map((r) => [r.index + 1, expanded])));

  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keeps to the newest response while the list is scrolled to its end.
  const atEnd = useRef(true);
  // In focus when it opens and when it changes size, so Esc reaches it (the terminal may be hidden).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when full view changes
  useEffect(() => asideRef.current?.focus(), [full]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the responses change
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [list]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  const close = () => {
    onClose();
    focusTerminal();
  };
  // Esc: from full view back to the side panel; beside the terminal, closes it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (full) onToggleFull();
    else close();
  };
  // Not in full view: the terminal is hidden there.
  const reveal = useMemo(
    () => (aids && !alternate && !full ? (text: string) => aids.reveal(text) : null),
    [aids, alternate, full],
  );

  // Its width beside the terminal, between MIN_WIDTH and MAX_SHARE of the area.
  const [width, setWidth] = useState(() => savedWidth() ?? (narrow ? MIN_WIDTH : 420));
  const [areaWidth, setAreaWidth] = useState(0);
  useLayoutEffect(() => {
    const area = asideRef.current?.parentElement;
    if (!area) return;
    const observer = new ResizeObserver(() => setAreaWidth(area.clientWidth));
    observer.observe(area);
    setAreaWidth(area.clientWidth);
    return () => observer.disconnect();
  }, []);
  const clamp = (value: number) =>
    Math.max(MIN_WIDTH, Math.min(value, areaWidth > 0 ? areaWidth * MAX_SHARE : value));
  const shown = clamp(width);
  // The drag's latest width, saved on release (the render may not have caught up yet).
  const drag = useRef<{ x: number; width: number; now: number } | null>(null);
  const onDragStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: shown, now: shown };
  };
  const onDragMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.now = clamp(drag.current.width + drag.current.x - event.clientX);
    setWidth(drag.current.now);
  };
  const onDragEnd = () => {
    if (!drag.current) return;
    saveWidth(drag.current.now);
    drag.current = null;
  };

  return (
    <aside
      ref={asideRef}
      data-responses-panel
      data-full={full ? 'true' : 'false'}
      aria-label="Responses"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={full ? undefined : { width: shown }}
      className={`relative flex min-h-0 flex-col bg-canvas outline-none ${full ? 'min-w-0 flex-1' : 'shrink-0 border-l border-line'}`}
    >
      {full ? null : (
        <div
          data-responses-resize
          title="Drag to resize"
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-line-strong/60"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        />
      )}
      <div className="flex h-[34px] shrink-0 items-center gap-1.5 border-b border-line bg-surface pr-2 pl-3.5">
        <span className="text-md font-semibold">Responses</span>
        <span className="font-mono text-xs text-fg-subtle">
          {responses.data ? list.length : ''}
        </span>
        <span className="flex-1" />
        {list.length > 1 ? (
          <>
            <button type="button" className={button('ghost', 'sm')} onClick={() => setAll(true)}>
              Expand all
            </button>
            <button type="button" className={button('ghost', 'sm')} onClick={() => setAll(false)}>
              Collapse all
            </button>
          </>
        ) : null}
        <button
          type="button"
          data-responses-full
          className={button('ghost', 'sm')}
          aria-pressed={full}
          title={
            full
              ? `Back to the side panel (Esc, ${keyHint('responsesFullView')})`
              : `Over the whole workspace (${keyHint('responsesFullView')})`
          }
          onClick={onToggleFull}
        >
          {full ? 'Side panel' : 'Full view'}
        </button>
        <button
          type="button"
          className={iconButton}
          title={`Close (${full ? '' : 'Esc, '}${keyHint('responses')})`}
          aria-label="Close responses"
          onClick={close}
        >
          ×
        </button>
      </div>
      {responses.error ? (
        <p role="alert" className="p-3 text-sm text-st-error select-text">
          ✕ {responses.error.message}
        </p>
      ) : null}
      {responses.data && list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center">
          <div className="font-medium">No responses yet</div>
          <div className="max-w-[240px] text-sm text-fg-subtle">
            Claude's responses in this conversation appear here as it writes them.
          </div>
        </div>
      ) : null}
      {list.length > 0 ? (
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className={full ? 'mx-auto max-w-[900px]' : undefined}>
            {list.map((r) => (
              <ResponseItem
                key={r.index}
                number={r.index + 1}
                text={r.text}
                prompt={r.prompt}
                afterBackground={r.afterBackground}
                at={r.at}
                expanded={isExpanded(r.index + 1)}
                onToggle={toggle}
                onReveal={reveal}
              />
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
