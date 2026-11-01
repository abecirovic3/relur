import { isWebUrl, type WorkflowInfo } from '@shared/workflow';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { type MouseEvent, useMemo } from 'react';
import { trpcClient, useTRPC } from '../trpc';
import { button, REVEAL_LABEL } from '../ui/controls';

const marked = new Marked({ gfm: true, async: false });

/** Tags that load something, take input or style the app; dropped from the document. */
const FORBID_TAGS = [
  'style',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'source',
  'picture',
  'track',
];

/** A relative image or link target: no scheme, not absolute. */
const isRelative = (url: string) => url !== '' && !/^[a-z][a-z0-9+.-]*:|^\/\/|^\//i.test(url);

const headingId = (text: string) =>
  `doc-${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

/**
 * The status file's Markdown as safe HTML (spec §13.8): sanitized with
 * DOMPurify (no scripts, event handlers, styles, forms, frames or media),
 * images kept only with a relative source (filled in later from the
 * worktree), links only to the web, mail or a heading of the document.
 */
export function renderDocument(markdown: string): { html: string; images: string[] } {
  const raw = marked.parse(markdown) as string;
  const images = new Set<string>();
  const purify = DOMPurify(window);
  purify.addHook('afterSanitizeAttributes', (node) => {
    const element = node as Element;
    switch (element.tagName) {
      case 'IMG': {
        const src = element.getAttribute('src') ?? '';
        element.removeAttribute('src');
        element.removeAttribute('srcset');
        if (isRelative(src)) {
          element.setAttribute('data-doc-src', src);
          images.add(src);
        } else {
          element.setAttribute('data-doc-blocked', '');
        }
        break;
      }
      case 'A': {
        const href = element.getAttribute('href') ?? '';
        element.removeAttribute('target');
        if (/^(https?|mailto):/i.test(href)) element.setAttribute('data-doc-external', '');
        else if (!href.startsWith('#')) element.removeAttribute('href');
        break;
      }
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        element.setAttribute('id', headingId(element.textContent ?? ''));
        break;
    }
  });
  const html = purify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR: ['style', 'id', 'name'],
    ALLOW_DATA_ATTR: false,
  });
  return { html, images: [...images] };
}

/**
 * The images filled in from the worktree as `data:` URLs; one that couldn't
 * be loaded, or wasn't relative, shows as its alt text.
 */
export function withImages(html: string, urls: Record<string, string | null> | undefined): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const img of template.content.querySelectorAll('img')) {
    const url = urls?.[img.getAttribute('data-doc-src') ?? ''];
    if (url?.startsWith('data:image/')) {
      img.setAttribute('src', url);
      continue;
    }
    if (!urls && img.hasAttribute('data-doc-src')) continue;
    const missing = document.createElement('span');
    missing.setAttribute('data-doc-missing', '');
    missing.textContent = `[image${img.alt ? `: ${img.alt}` : ''}]`;
    img.replaceWith(missing);
  }
  return template.innerHTML;
}

/**
 * The spec view (spec §13.8): the workspace's status file rendered as
 * Markdown, read-only, with a compact header from its front matter. It
 * follows the file as the workflow watcher reads it again.
 */
export function SpecView({
  workspaceId,
  workflow,
  idField,
}: {
  workspaceId: string;
  workflow: WorkflowInfo;
  idField: string | null;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const doc = useQuery(trpc.workflow.document.queryOptions({ workspaceId }, { staleTime: 0 }));
  useSubscription(
    trpc.workflow.documentChanges.subscriptionOptions(
      { workspaceId },
      {
        onData: () =>
          void queryClient.invalidateQueries({ queryKey: trpc.workflow.document.queryKey() }),
      },
    ),
  );
  const rendered = useMemo(() => (doc.data ? renderDocument(doc.data.markdown) : null), [doc.data]);
  const images = useQuery(
    trpc.workflow.documentImages.queryOptions(
      { workspaceId, sources: rendered?.images ?? [] },
      { enabled: (rendered?.images.length ?? 0) > 0, staleTime: 0 },
    ),
  );
  const html = useMemo(
    () =>
      rendered ? withImages(rendered.html, rendered.images.length > 0 ? images.data : {}) : '',
    [rendered, images.data],
  );
  const open = useMutation(trpc.workflow.openDocument.mutationOptions());

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element).closest('a');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href') ?? '';
    if (link.hasAttribute('data-doc-external')) {
      void trpcClient.shell.openExternal.mutate({ url: href });
    } else if (href.startsWith('#')) {
      const target = event.currentTarget.querySelector(
        `#${CSS.escape(headingId(decodeURIComponent(href.slice(1))))}`,
      );
      target?.scrollIntoView({ block: 'start' });
    }
  };

  if (!doc.data) {
    return (
      <div className="p-4 text-md text-fg-muted">
        {doc.error ? `✕ ${doc.error.message}` : (workflow.problem ?? 'Reading…')}
      </div>
    );
  }
  const fields = doc.data.fields;
  const id = idField ? fields[idField] : undefined;
  const links = Object.entries(fields).filter(([, value]) => isWebUrl(value));
  return (
    <div data-spec-view className="flex min-h-0 flex-1 flex-col bg-term">
      <div
        data-spec-header
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-4 py-2 text-sm"
      >
        {workflow.label ? (
          <span data-spec-status className="rounded-sm bg-raised px-1.5 py-px font-medium">
            {workflow.label}
          </span>
        ) : null}
        {id ? <span className="font-mono text-fg-muted">{id}</span> : null}
        {links.map(([key, url]) => (
          <button
            key={key}
            type="button"
            data-spec-link={key}
            className="text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg"
            title={url}
            onClick={() => void trpcClient.shell.openExternal.mutate({ url })}
          >
            {key} ↗
          </button>
        ))}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-subtle">
          {doc.data.file}
        </span>
        <button
          type="button"
          className={button('ghost', 'sm')}
          onClick={() => open.mutate({ workspaceId, how: 'open' })}
        >
          Open in editor
        </button>
        <button
          type="button"
          className={button('ghost', 'sm')}
          onClick={() => open.mutate({ workspaceId, how: 'reveal' })}
        >
          {REVEAL_LABEL}
        </button>
      </div>
      {open.error ? (
        <p role="alert" className="px-4 py-1 text-sm text-st-error">
          ✕ {open.error.message}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: links inside are keyboard reachable */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: it only handles clicks on its links */}
        <div
          data-spec-body
          className="doc-markdown mx-auto max-w-[820px] px-6 py-5 select-text"
          onClick={onClick}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by renderDocument
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
