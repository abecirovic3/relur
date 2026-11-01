import { matchShortcut } from '@shared/shortcuts';
import { type ReactNode, useEffect, useRef } from 'react';
import { isMac } from '../ui/controls';

/**
 * A modal built on <dialog>: focus trapping, focus restore and Escape come
 * from the browser. The first field gets focus, or the element marked
 * `data-autofocus` (destructive dialogs put it on Cancel). ⌘↵ submits the dialog's
 * form; clicking the scrim cancels only while nothing has been typed.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  icon,
  wide = false,
  tall = false,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Shown before the title, such as the profile dot. */
  icon?: ReactNode;
  /** 620px, closer to the top, with a scrolling body (the New profile wizard). */
  wide?: boolean;
  /** With `wide`: a fixed height, so switching tabs doesn't resize the dialog. */
  tall?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const typed = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    // showModal focuses the first focusable element (a "?" Guide link, say); an
    // element marked data-autofocus (Cancel in destructive dialogs) wins.
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      // React's StrictMode closes and reopens the dialog on mount; the queued
      // close event then arrives while it is open again and must be ignored.
      onClose={() => {
        if (!ref.current?.open) onClose();
      }}
      onInput={() => {
        typed.current = true;
      }}
      onKeyDown={(event) => {
        if (matchShortcut('confirm', event.nativeEvent, isMac) !== -1) {
          event.preventDefault();
          // A nested dialog submits its own form only.
          event.stopPropagation();
          ref.current?.querySelector('form')?.requestSubmit();
        }
      }}
      onMouseDown={(event) => {
        // The dialog element itself is only hit outside its content box: the scrim.
        if (event.target === ref.current && !typed.current) ref.current?.close();
      }}
      className={`mx-auto max-w-[calc(100vw-2rem)] rounded-xl border border-line-strong bg-raised p-0 text-fg shadow-dialog backdrop:bg-scrim ${wide ? 'mt-12 max-h-[calc(100vh-88px)] w-[620px]' : 'mt-24 w-[500px]'} ${tall ? 'h-[min(720px,calc(100vh-88px))]' : ''}`}
    >
      <div className="p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {icon}
          {title}
        </h2>
        {description ? <div className="mt-0.5 text-md text-fg-muted">{description}</div> : null}
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}

/** Right-aligned dialog buttons: Cancel, then the primary action. */
export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex items-center justify-end gap-2">{children}</div>;
}
