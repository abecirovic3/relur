# Prompt navigator

In Claude's classic mode, each prompt you send gets its number in the left margin, in the profile's color, and a [Copy button](copy-response) appears where each response ends. Only prompts you type are numbered: when background work Claude started finishes and Claude carries on by itself, that isn't a prompt.

The navigator, at the top right of the Claude tab, reads **Prompt n of N** for the prompt you're looking at. Its **↑** and **↓**, or <kbd>{{keys:promptStep}}</kbd>, jump to the previous or next prompt and scroll it near the top. None of this takes the focus from the terminal.

:::note Classic mode only
Claude Code's full-screen mode redraws the whole screen, so prompt numbers, the navigator and the Copy buttons can't be placed there; the [Responses panel](copy-response) lists every response, each with its own Copy. See [Classic or full-screen](copy-response#classic-or-full-screen).
:::
