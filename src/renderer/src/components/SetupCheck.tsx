import type { Profile } from '@shared/schemas';
import { accountFolder, type InstallMethod, type SetupCheck, signInCommand } from '@shared/setup';
import { formatChord, matchShortcut } from '@shared/shortcuts';
import type { SessionInfo } from '@shared/terminal-protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { GuideLink } from '../guide/link';
import { useTRPC } from '../trpc';
import { button, isMac, Kbd, keyHint } from '../ui/controls';
import { StatusGlyph } from '../ui/StatusGlyph';
import { LOGIN_PROMISE } from './FirstLaunch';
import { TerminalView } from './TerminalView';

type Glyph = 'spin' | 'ok' | 'act' | 'bad' | 'wait';

interface Row {
  title: string;
  glyph: Glyph;
  label: string;
  detail: string | null;
  /** Detail in monospace (versions, commands, paths). */
  mono?: boolean;
  body?: ReactNode;
}

const LABEL_TONE: Record<Glyph, string> = {
  spin: 'text-fg-subtle',
  ok: 'text-fg-muted',
  act: 'text-st-permission font-medium',
  bad: 'text-st-error font-medium',
  wait: 'text-fg-subtle',
};

function RowGlyph({ glyph }: { glyph: Glyph }) {
  switch (glyph) {
    case 'spin':
      return <StatusGlyph glyph="working" />;
    case 'ok':
      return <span className="text-base leading-none font-bold text-diff-add">✓</span>;
    case 'act':
      return <StatusGlyph glyph="permission" />;
    case 'bad':
      return <StatusGlyph glyph="error" />;
    case 'wait':
      return <span className="box-border size-2 rounded-full border-[1.5px] border-line-strong" />;
  }
}

/** A command shown verbatim before it runs, with Copy (components.md, Command block). */
export function CommandBlock({ command }: { command: string }) {
  const trpc = useTRPC();
  const copy = useMutation(trpc.clipboard.writeText.mutationOptions());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex h-7.5 items-center gap-2 rounded-md border border-line bg-term pr-1 pl-2.5">
      <span aria-hidden className="font-mono text-md text-fg-subtle">
        $
      </span>
      <code
        data-command
        className="min-w-0 flex-1 overflow-x-auto font-mono text-md whitespace-nowrap"
      >
        {command}
      </code>
      <button
        type="button"
        className={button('ghost', 'sm')}
        onClick={() => copy.mutate({ text: command }, { onSuccess: () => setCopied(true) })}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** The real terminal of an install or sign-in command, with its state (components.md). */
function SetupTerminal({
  session,
  shell,
  folder,
}: {
  session: SessionInfo;
  shell: string;
  folder: string;
}) {
  const ok = session.exitCode === 0;
  return (
    <div className="overflow-hidden rounded-md border border-line bg-term">
      <div className="flex h-7 items-center gap-2 border-b border-line px-2.5 text-sm">
        <span className="font-mono text-fg-muted">$ Terminal</span>
        <span className="min-w-0 truncate font-mono text-xs text-fg-subtle">
          {shell} · CLAUDE_CONFIG_DIR={folder}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs">
          {session.status === 'running' ? (
            <>
              <StatusGlyph glyph="working" />
              <span className="text-fg-subtle">running</span>
            </>
          ) : (
            <span
              data-exit-code={session.exitCode ?? ''}
              className={ok ? 'text-diff-add' : 'text-st-error'}
            >
              exited · code {session.exitCode ?? session.signal ?? '?'}
            </span>
          )}
        </span>
      </div>
      <div className="h-[200px]">
        <TerminalView sessionId={session.id} />
      </div>
    </div>
  );
}

function InstallChooser({
  methods,
  onInstall,
  pending,
}: {
  methods: InstallMethod[];
  onInstall: (method: InstallMethod) => void;
  pending: boolean;
}) {
  const [chosen, setChosen] = useState<InstallMethod['id'] | null>(null);
  const selected =
    methods.find((m) => m.id === chosen) ?? methods.find((m) => m.recommended) ?? methods[0];
  if (!selected) {
    return (
      <p className="text-md text-fg-muted">
        Installing from here isn't available on this system yet.
      </p>
    );
  }
  return (
    <>
      <p className="text-md text-fg-muted">
        Install Claude Code with one of its official installers. It runs in a terminal below, and{' '}
        {formatChord({ ctrl: true, code: 'KeyC' }, isMac)} in the terminal stops it.
      </p>
      <div role="radiogroup" aria-label="Install method" className="flex flex-col gap-2">
        {methods.map((method) => {
          const on = method.id === selected.id;
          return (
            <label
              key={method.id}
              className={`flex cursor-default flex-col gap-1.5 rounded-lg border p-2.5 ${on ? 'border-fg-subtle bg-surface' : 'border-line'}`}
            >
              <span className="flex items-center gap-2 text-md">
                <input
                  type="radio"
                  name="install-method"
                  checked={on}
                  onChange={() => setChosen(method.id)}
                />
                <span className="font-medium">{method.label}</span>
                {method.recommended ? (
                  <span className="rounded-sm bg-raised px-1.5 text-xs text-fg-muted">
                    Recommended
                  </span>
                ) : null}
                <span className="ml-auto text-sm text-fg-subtle">{method.note}</span>
              </span>
              <CommandBlock command={method.command} />
            </label>
          );
        })}
      </div>
      <div>
        <button
          type="button"
          className={button('primary')}
          title={selected.command}
          disabled={pending}
          onClick={() => onInstall(selected)}
        >
          Install
        </button>
      </div>
    </>
  );
}

function SignInHelp() {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-md text-fg-muted">
      <li>
        Sign-in happens in your browser, through Claude Code. The browser decides which account
        signs in: whichever Claude account it is signed in to.
      </li>
      <li>
        To use a different account, sign out on claude.ai first, or open the login link from the
        terminal in a private window.
      </li>
      <li>The free Claude plan doesn't include Claude Code.</li>
    </ul>
  );
}

/**
 * The setup check of one profile (spec §6.11): Claude Code installed, signed
 * in, ready. Install and sign-in run Claude Code's own commands in a terminal
 * shown here, after the user clicks.
 */
export function SetupCheckPanel({
  profile,
  header,
}: {
  profile: Profile;
  /** Shown above the checklist; null when embedded (the wizard has its own). */
  header: { title: string; subtitle: string } | null;
}) {
  const trpc = useTRPC();
  const profileId = profile.id;
  const result = useQuery(trpc.setup.get.queryOptions({ profileId }));
  const sessions = useQuery(trpc.sessions.list.queryOptions());
  const methods = useQuery(trpc.setup.installMethods.queryOptions());
  const diagnostics = useQuery(trpc.env.diagnostics.queryOptions());
  const recheck = useMutation(trpc.setup.check.mutationOptions());
  const install = useMutation(trpc.setup.install.mutationOptions());
  const signIn = useMutation(trpc.setup.signIn.mutationOptions());

  const check: SetupCheck | null = result.data ?? null;
  const session = check?.session
    ? (sessions.data?.find((s) => s.id === check.session?.sessionId) ?? null)
    : null;
  const commandRunning = session?.status === 'running';
  const shell = diagnostics.data?.shell.split('/').at(-1) ?? 'shell';
  const folder = check?.folder ?? accountFolder(profile);
  const checking = Boolean(check?.running) || recheck.isPending;
  const canRecheck = !commandRunning && !checking;
  const runRecheck = useRef(() => {});
  runRecheck.current = () => {
    if (canRecheck) recheck.mutate({ profileId });
  };

  // ⌘R checks again, here and in the wizard's dialog (spec §6.6).
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (matchShortcut('checkAgain', e, isMac) !== -1) {
        e.preventDefault();
        e.stopPropagation();
        runRecheck.current();
      }
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  const terminalFor = (step: 'install' | 'sign-in') =>
    session && check?.session?.step === step ? (
      <SetupTerminal session={session} shell={shell} folder={folder} />
    ) : null;
  const exitedWith = (step: 'install' | 'sign-in') =>
    session && check?.session?.step === step && session.status === 'exited'
      ? session.exitCode
      : undefined;
  const actionError = (install.error ?? signIn.error ?? recheck.error)?.message;
  const checkAgain = (
    <button
      type="button"
      className={button('secondary')}
      disabled={!canRecheck}
      onClick={() => runRecheck.current()}
    >
      Check again <Kbd>{keyHint('checkAgain')}</Kbd>
    </button>
  );

  const rows: Row[] = [];
  const installed = check?.installed ?? { state: 'waiting' as const };
  if (commandRunning && check?.session?.step === 'install') {
    rows.push({
      title: 'Claude Code installed',
      glyph: 'spin',
      label: 'Running',
      detail: 'Runs in a terminal below',
      body: terminalFor('install'),
    });
  } else if (installed.state === 'passed') {
    rows.push({
      title: 'Claude Code installed',
      glyph: 'ok',
      label: 'Passed',
      detail: installed.value.version,
      mono: true,
    });
  } else if (installed.state === 'action') {
    const code = exitedWith('install');
    const foundAt = 'foundAt' in installed ? installed.foundAt : null;
    let body: ReactNode;
    if (code !== undefined && code !== 0) {
      body = (
        <>
          <p className="font-medium text-st-error">Install failed · exit code {code}</p>
          <p className="text-md text-fg-muted">
            The installer stopped before claude was installed. Check your network connection and run
            it again. The full output is in the terminal.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={button('primary')}
              disabled={install.isPending}
              onClick={() => {
                const method = methods.data?.find((m) => m.command === check?.session?.command);
                if (method) install.mutate({ profileId, method: method.id });
              }}
            >
              Run again
            </button>
            {checkAgain}
          </div>
        </>
      );
    } else if (code === 0 || foundAt) {
      const dir = foundAt ? foundAt.slice(0, foundAt.lastIndexOf('/')) : '$HOME/.local/bin';
      body = (
        <>
          <p className="font-medium">Still not found after install</p>
          <p className="text-md text-fg-muted">
            {foundAt
              ? `Claude Code is installed at ${foundAt}, but that folder isn't on your login shell's PATH.`
              : "The installer finished, but claude isn't on your login shell's PATH."}{' '}
            Add this to your shell's startup file yourself, then check again. The app reads PATH
            from a fresh login shell.
          </p>
          <CommandBlock command={`export PATH="${dir}:$PATH"`} />
          <div>{checkAgain}</div>
        </>
      );
    } else {
      body = (
        <InstallChooser
          methods={methods.data ?? []}
          pending={install.isPending}
          onInstall={(method) => install.mutate({ profileId, method: method.id })}
        />
      );
    }
    rows.push({
      title: 'Claude Code installed',
      glyph: 'act',
      label: 'Needs action',
      detail: foundAt ? 'Not on PATH' : 'Not found',
      body: (
        <>
          {body}
          {terminalFor('install')}
        </>
      ),
    });
  } else if (installed.state === 'failed') {
    rows.push({
      title: 'Claude Code installed',
      glyph: 'bad',
      label: 'Failed',
      detail: installed.reason,
      body: <div>{checkAgain}</div>,
    });
  } else if (installed.state === 'checking') {
    rows.push({
      title: 'Claude Code installed',
      glyph: 'spin',
      label: 'Checking…',
      detail: installed.command,
      mono: true,
    });
  } else {
    rows.push({ title: 'Claude Code installed', glyph: 'spin', label: 'Checking…', detail: null });
  }

  const signedIn = check?.signedIn ?? { state: 'waiting' as const };
  const signInButton = (label: string) => (
    <button
      type="button"
      className={button('primary')}
      disabled={signIn.isPending}
      onClick={() => signIn.mutate({ profileId })}
    >
      {label}
    </button>
  );
  if (commandRunning && check?.session?.step === 'sign-in') {
    rows.push({
      title: 'Signed in',
      glyph: 'spin',
      label: 'Running',
      detail: 'Waiting for the browser…',
      body: (
        <>
          <p className="text-md text-fg-muted">
            Finish in your browser. For another account, open the link in a private window.
          </p>
          {terminalFor('sign-in')}
        </>
      ),
    });
  } else if (signedIn.state === 'passed') {
    const { email, plan, org } = signedIn.value;
    rows.push({
      title: 'Signed in',
      glyph: 'ok',
      label: 'Passed',
      detail: [email ?? 'Account unknown', plan, org].filter(Boolean).join(' · '),
    });
  } else if (signedIn.state === 'action') {
    const code = exitedWith('sign-in');
    const cancelled = code !== undefined && code !== 0;
    rows.push({
      title: 'Signed in',
      glyph: 'act',
      label: 'Needs action',
      detail: cancelled ? 'Login cancelled' : 'Not signed in',
      body: (
        <>
          {cancelled ? (
            <p className="text-md text-fg-muted">
              The browser sign-in was cancelled, so this folder still has no login. To use a
              different account, sign out on claude.ai first, or open the login link from the
              terminal in a private window.
            </p>
          ) : (
            <SignInHelp />
          )}
          <CommandBlock command={signInCommand(profile.claude.command)} />
          <div className="flex gap-2">
            {signInButton(cancelled ? 'Sign in again' : 'Sign in')}
            {cancelled ? checkAgain : null}
          </div>
          {terminalFor('sign-in')}
        </>
      ),
    });
  } else if (signedIn.state === 'failed') {
    rows.push({
      title: 'Signed in',
      glyph: 'bad',
      label: 'Failed',
      detail: signedIn.reason,
      body: <div>{checkAgain}</div>,
    });
  } else if (signedIn.state === 'checking') {
    rows.push({
      title: 'Signed in',
      glyph: 'spin',
      label: 'Checking…',
      detail: signedIn.command,
      mono: true,
    });
  } else {
    rows.push({ title: 'Signed in', glyph: 'wait', label: '', detail: null });
  }

  const ready = check?.ready ?? { state: 'waiting' as const };
  if (ready.state === 'passed') {
    rows.push({
      title: 'Ready',
      glyph: 'ok',
      label: 'Passed',
      detail: `Claude Code uses ${folder}`,
    });
  } else if (ready.state === 'failed') {
    rows.push({
      title: 'Ready',
      glyph: 'bad',
      label: 'Failed',
      detail: 'Wrong config folder',
      body: (
        <>
          <p className="text-md text-fg-muted">{ready.reason}</p>
          <div>{checkAgain}</div>
        </>
      ),
    });
  } else {
    rows.push({ title: 'Ready', glyph: 'wait', label: '', detail: 'After the steps above' });
  }

  return (
    <div data-setup-check={profileId} className="flex flex-col gap-4">
      {header ? (
        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="flex items-center gap-2 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
              {header.title}
              <GuideLink to="setup-check#when-a-row-needs-action" label="The setup check" />
            </h1>
            <p className="text-md text-pretty text-fg-muted">{header.subtitle}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {checkAgain}
            {commandRunning ? (
              <span className="text-xs text-fg-subtle">
                Check again unlocks when the command exits.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <ol className="overflow-hidden rounded-lg border border-line bg-surface">
        {rows.map((row) => (
          <li
            key={row.title}
            data-row={row.title}
            data-state={row.glyph}
            className="border-line not-first:border-t"
          >
            <div className="flex h-[42px] items-center gap-3 px-3.5">
              <span className="flex size-4 flex-none items-center justify-center">
                <RowGlyph glyph={row.glyph} />
              </span>
              <span
                className={`text-base ${row.glyph === 'wait' ? 'text-fg-subtle' : 'font-medium'}`}
              >
                {row.title}
              </span>
              {row.detail ? (
                <span
                  className={`min-w-0 truncate ${row.mono ? 'font-mono text-sm' : 'text-md'} ${row.glyph === 'bad' ? 'text-st-error' : 'text-fg-muted'}`}
                  title={row.detail}
                >
                  {row.detail}
                </span>
              ) : null}
              <span className={`ml-auto shrink-0 text-sm ${LABEL_TONE[row.glyph]}`}>
                {row.label}
              </span>
            </div>
            {row.body ? (
              <div className="flex flex-col gap-2.5 border-t border-line bg-canvas py-3 pr-3.5 pl-[42px]">
                {row.body}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {actionError ? <p className="text-md text-st-error">{actionError}</p> : null}
      <p className="text-sm text-pretty text-fg-subtle">{LOGIN_PROMISE}</p>
    </div>
  );
}
