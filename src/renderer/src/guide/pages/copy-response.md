# Copy responses

Every Claude tab has a **Responses** button at the right of its bar <kbd>{{key:responses}}</kbd>. It opens a panel beside the terminal that lists each of Claude's responses in the conversation, oldest first and the newest at the bottom, with the prompt it answers and when it was written. Each one is shown formatted, as Markdown, and has its own **Copy**, which copies that response exactly as Claude wrote it, Markdown included.

- The panel follows the conversation: a new response appears as Claude writes it.
- When work Claude ran in the background finishes, Claude carries on by itself. Its response then reads **After background work** where the prompt would be: you didn't type anything.
- A conversation you resumed lists its earlier responses too.
- <kbd>Esc</kbd> closes the panel while you're in it, and so do **×** and <kbd>{{key:responses}}</kbd>; the terminal gets the focus back.
- Before Claude has answered, the panel says **No responses yet**.
- To copy only part of a response, select it in the panel and copy as usual.

## Expanding and collapsing

Each response is a block with a header line: its number, the prompt it answers, the time, and **Copy**. The newest response is shown in full; older ones are collapsed to their first lines, fading out. Click a header, or press <kbd>↵</kbd> on it, to expand or collapse that response; clicking a collapsed response's text expands it too. With more than one response, **Expand all** and **Collapse all** at the top do it for every response. **Copy** is in the header, so it copies the whole response even while it's collapsed.

## Size

Drag the panel's left edge to make it wider or narrower, from 320 pixels up to 70% of the workspace. It keeps that width the next time you open it, also after restarting {{app}}.

**Full view** in the panel's header, or <kbd>{{key:responsesFullView}}</kbd>, gives it the whole workspace area, with the terminal hidden for the moment, which is easier for reading long answers. **Side panel**, <kbd>{{key:responsesFullView}}</kbd> or <kbd>Esc</kbd> puts it back beside the terminal.

<kbd>{{key:copyResponse}}</kbd> copies the last response without opening anything.

The panel and <kbd>{{key:copyResponse}}</kbd> work the same in both of Claude's display modes. They read the conversation from the transcript file Claude Code writes, never from the screen, so line wrapping and Claude's interface don't end up in the clipboard.

## In classic mode

In Claude's classic mode you also get:

- a small **Copy** button at the right of the line where each response ends, as in Claude's chat apps. It scrolls with the text and copies exactly that response.
- In the Responses panel beside the terminal, a click on a response's text scrolls the terminal to where it ends and marks that line for a moment. A response that isn't on the screen any more (for example after `/clear`) says **Not in the terminal**.

Full-screen mode redraws the whole screen, so nothing can be placed next to a response there: no inline Copy buttons, and a click in the panel doesn't scroll. Use the panel's Copy buttons instead.

## Classic or full-screen

Claude Code's display mode is its `tui` setting: `"default"` (classic) or `"fullscreen"`. To get the inline Copy buttons, type `/tui default` in a Claude tab; `/tui fullscreen` switches back. That Claude restarts in the new mode and resumes its conversation. The choice is saved in `settings.json` in the profile's account folder (see [Account folders](account-folders)), so every Claude of that profile started afterwards uses it; Claudes already running keep their mode until they restart.
