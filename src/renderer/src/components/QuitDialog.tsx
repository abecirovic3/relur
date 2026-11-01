import { BRAND } from '@shared/brand';
import type { Profile } from '@shared/schemas';
import { GLYPH_LABEL, glyphFor } from '@shared/status';
import type { SessionInfo } from '@shared/terminal-protocol';
import type { Workspace } from '@shared/workspaces';
import { type FormEvent, useEffect, useRef } from 'react';
import { button, Kbd, keyHint } from '../ui/controls';
import { ProfileDot } from '../ui/profile-color';
import { StatusGlyph } from '../ui/StatusGlyph';
import { plural } from './DeleteWorkspaceDialog';
import { Modal, ModalFooter } from './Modal';

/**
 * Quit with running sessions (spec §5, components.md): every session that
 * quitting would interrupt, across profiles. Quit is the primary button.
 */
export function QuitDialog({
  sessionIds,
  sessions,
  workspaces,
  profiles,
  onAnswer,
}: {
  sessionIds: string[];
  sessions: SessionInfo[];
  workspaces: Workspace[];
  profiles: Profile[];
  onAnswer: (quit: boolean) => void;
}) {
  const rows = sessionIds.flatMap((id) => {
    const session = sessions.find((s) => s.id === id);
    return session ? [session] : [];
  });
  // Quit has the focus (components.md); the dialog would otherwise focus Cancel.
  const quitButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => quitButton.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAnswer(true);
  };
  return (
    <Modal
      title={`Stop ${plural(sessionIds.length, 'running session')}?`}
      description={`Quitting ${BRAND.displayName} stops ${sessionIds.length === 1 ? 'it' : 'them'}. Claude conversations resume on the next launch.`}
      onClose={() => onAnswer(false)}
    >
      <form onSubmit={submit}>
        <ul
          data-quit-sessions
          className="divide-y divide-line rounded-lg border border-line text-md"
        >
          {rows.map((session) => {
            const workspace = workspaces.find((w) => w.id === session.workspaceId) ?? null;
            const profile = profiles.find((p) => p.id === session.profileId);
            const glyph =
              session.kind === 'claude' && workspace
                ? glyphFor(workspace.state, workspace.unread, session.launching)
                : null;
            const state =
              session.kind === 'claude'
                ? glyph
                  ? GLYPH_LABEL[glyph]
                  : 'Claude is running'
                : session.kind === 'setup'
                  ? 'Setup command running'
                  : 'A command is running';
            return (
              <li key={session.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className="flex size-3 items-center justify-center">
                  {glyph ? (
                    <StatusGlyph glyph={glyph} />
                  ) : (
                    <span className="font-mono text-xs text-fg-muted">$</span>
                  )}
                </span>
                {profile ? <ProfileDot color={profile.color} size={6} /> : null}
                {workspace?.task.id ? (
                  <span className="font-mono text-xs text-fg-muted">{workspace.task.id}</span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">
                  {workspace ? workspace.task.title || workspace.name : session.title}
                </span>
                <span className="shrink-0 text-sm text-fg-muted">{state}</span>
              </li>
            );
          })}
        </ul>
        <ModalFooter>
          <button type="button" className={button('ghost', 'lg')} onClick={() => onAnswer(false)}>
            Cancel <Kbd>Esc</Kbd>
          </button>
          <button ref={quitButton} type="submit" className={button('primary', 'lg')}>
            Quit <Kbd onFg>{keyHint('quit')}</Kbd>
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
