# Resume

## Quitting

Quitting while something runs asks first: **Stop n running sessions?** lists each one with its profile, task and state. Claude counts while it runs; a shell counts only while a command runs in it, not while it waits at its prompt, and so does a setup command. **Quit** has the focus, so <kbd>{{key:quit}}</kbd> again confirms; **Cancel** or <kbd>Esc</kbd> keeps everything running. With nothing running, {{app}} quits without asking.

<kbd>{{key:quit}}</kbd>{{mac}}, **Quit** in the {{app}} menu and **Quit** in the Dock's menu{{/mac}}{{other}} and **File › Quit**{{/other}} quit completely: every session stops and nothing of {{app}} keeps running in the background.

## Closing the window

{{mac}}On macOS, closing the window with <kbd>{{key:closeWindow}}</kbd> or its close button doesn't stop anything: {{app}} keeps running, so Claude finishes its work and notifications keep coming. Click {{app}} in the Dock to bring the window back. The first time you close it, {{app}} says so once; **Cancel** keeps the window open. The message never shows again.

To quit whenever the window closes, choose **Quit When the Window Closes** in the {{app}} menu (off at first). Closing the window then quits as <kbd>{{key:quit}}</kbd> does, asking first while something runs.{{/mac}}{{other}}On Linux, closing the window quits, asking first while something runs; **Cancel** keeps the window open.{{/other}}

## Starting again

When {{app}} starts again, Claude continues the same conversation in each workspace where it was running, and starts there when you open the others. Terminal history isn't kept across restarts; Claude's conversation is.

## Work that was cut off

Quitting, logging out, an update with `install.sh` or a crash stops Claude in the middle of its turn, together with any commands or background agents it had running. {{app}} remembers where that happened. A workspace counts as **unfinished** when Claude was:

- **Working**, including while it waited for its own background agents;
- **interrupted with <kbd>Esc</kbd>** by you, just before the stop: it's never continued unless you choose so;
- **asking for permission**: never continued by itself; give the permission again in the workspace.

Done and Waiting for input don't count. After a crash, a workspace that was still Working counts the same.

The quit dialog says what comes next: "They'll continue when {{app}} starts again" or "You'll be asked when {{app}} starts again".

## Continuing it

With **Continue interrupted work when {{app}} starts** on in [Edit profile › General](edit-profile) (off at first), {{app}} sends the profile's continue prompt to each workspace that was Working, once Claude has resumed there: one after another, a few seconds apart, and never while your [plan usage](plan-usage) is at its limit. A notice above the terminal lists them; **Stop** cancels the ones not sent yet, which stay unfinished. The default prompt tells Claude that {{app}} was closed while it worked, which stopped its commands and background agents, and to continue where it left off; you can edit it there.

Otherwise, and for anything else left unfinished, {{app}} asks once at start, after the sessions have resumed: **Claude didn't finish in n workspaces**, grouped by profile, with each workspace's task, project, last prompt and when it stopped. Working ones are ticked, ones you interrupted with <kbd>Esc</kbd> aren't, and a permission request has no checkbox. **Continue selected** (<kbd>{{key:confirm}}</kbd>) sends the continue prompt to the ticked ones, the same way; it's disabled, with the reason, while plan usage is at its limit. **Not now** (<kbd>Esc</kbd>) leaves them as they are, and **Open** goes to that workspace.

## The Unfinished marker

An unfinished workspace shows **Unfinished** with two bars in its sidebar row ("Claude didn't finish when {{app}} closed") and is listed under Home's **Needs you**, without a notification or sound. In the workspace, a bar offers **Continue**, which sends the continue prompt, and **Dismiss**. Sending any prompt yourself clears the marker too.
