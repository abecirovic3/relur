# Resume

## Quitting

Quitting while something runs asks first: **Stop n running sessions?** lists each one with its profile, task and state. Claude counts while it runs; a shell counts only while a command runs in it, not while it waits at its prompt, and so does a setup command. **Quit** has the focus, so <kbd>{{key:quit}}</kbd> again confirms; **Cancel** or <kbd>Esc</kbd> keeps everything running. With nothing running, {{app}} quits without asking.

<kbd>{{key:quit}}</kbd>{{mac}}, **Quit** in the {{app}} menu and **Quit** in the Dock's menu{{/mac}}{{other}} and **File › Quit**{{/other}} quit completely: every session stops and nothing of {{app}} keeps running in the background.

## Closing the window

{{mac}}On macOS, closing the window with <kbd>{{key:closeWindow}}</kbd> or its close button doesn't stop anything: {{app}} keeps running, so Claude finishes its work and notifications keep coming. Click {{app}} in the Dock to bring the window back. The first time you close it, {{app}} says so once; **Cancel** keeps the window open. The message never shows again.

To quit whenever the window closes, choose **Quit When the Window Closes** in the {{app}} menu (off at first). Closing the window then quits as <kbd>{{key:quit}}</kbd> does, asking first while something runs.{{/mac}}{{other}}On Linux, closing the window quits, asking first while something runs; **Cancel** keeps the window open.{{/other}}

## Starting again

When {{app}} starts again, Claude continues the same conversation in each workspace where it was running, and starts there when you open the others. Terminal history isn't kept across restarts; Claude's conversation is.
