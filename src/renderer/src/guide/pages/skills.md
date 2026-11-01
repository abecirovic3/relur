# Skills

Your team's Claude Code skills can live in their own folder or git repository. {{app}} loads them into every Claude session of a profile, for that session only: nothing is copied into your repositories or written into Claude's own folders.

## Skill sources

A profile's skills come from its **skill sources**, in **Edit profile › Skills** (right-click the profile tab, **Edit profile…**). Under **Add a source**, choose one of these, give it a name if you like (otherwise it's named after the folder or URL), choose where it applies, and click **Add source**:

- **Folder:** a folder on this computer, for example your clone of the skills repository. {{app}} reads it where it is, so your edits show up the next time Claude starts.
- **Git URL:** {{app}} clones the repository into its own settings folder, with your own git login: a credential helper, an SSH key in ssh-agent, or a CLI login. It can't ask for a password, so if cloning fails, clone it once in a terminal to check your access.

Each source shows what it holds, the commit it's on, and its skills with their descriptions. **Update** on a git source runs `git pull --ff-only` and shows the result. **Remove…** stops loading it; for a git source you choose whether {{app}}'s clone is deleted too. A folder of yours is never deleted.

A source can carry a workflow for your team: a `{{workflowFile}}` file at its root. Right after you add the source, or after an **Update** that brought new commits, its card asks **This skill source includes a workflow. Use it?**, with the statuses in order (gates marked ◆), the status file and the Start prompt. If the profile has no workflow yet, **Use it** makes it the profile's at once. If it has one, {{app}} first lists what would change, such as a gate losing the hint and answer button you added, and asks **Replace your current workflow?**: **Replace** or **Keep mine**. **Not now** puts the offer away. Later, the card keeps a line **Includes a workflow · Use it**, or **Includes a workflow · this profile uses it** once it's the profile's. See [Workflows](workflows#sharing-a-workflow).

Changes in this tab are saved at once.

## What a source can hold

| Source | How its skills are named |
| --- | --- |
| A plugin: `.claude-plugin/plugin.json` at its top | `/<plugin>:<skill>`, with the plugin's own name |
| A folder of plugins, or a marketplace listing its plugins | `/<plugin>:<skill>` for each plugin |
| Plain skill folders: `<skill>/SKILL.md`, at the top or in `skills/` | `/<source>:<skill>`: {{app}} wraps them in a plugin named after the source |

A source with none of these shows **Nothing to load**.

Skills are loaded per source, never one by one: the skills of one plugin call each other and share scripts.

## Per project

A source applies to **all projects of this profile** or to **selected projects**, chosen when you add it or with **Edit** on its card.

Each project's **Skills** tab lists the profile's sources with a switch. Switching one off there leaves it on for the other projects; switching on a source made for selected projects adds this project to its list.

## How Claude gets them

- **Claude started by {{app}}**, in a workspace or with Start Claude here, gets each source that applies with `--plugin-dir`.
- **Shells** get the same sources in `CLAUDE_CODE_PLUGIN_DIRS`, so a `claude` you type in a workspace or project shell has them too. The home terminal gets the sources for all projects.
- A workspace that [spans several repositories](tasks-across-repositories) gets the sources of all of them.

Your repositories stay as they are. If a repository enables your team's installed plugin in its `.claude/settings.json`, the session uses the copy from your source.

:::note
Claude Code reads skills when it starts. A change to a source reaches Claude the next time it starts.
:::

:::tip Scripts in a skill
Write `${CLAUDE_PLUGIN_ROOT}` in `SKILL.md`, as in `bash "${CLAUDE_PLUGIN_ROOT}/skills/review/scripts/check.sh"`: Claude Code fills in the plugin's folder, also for a source loaded by {{app}}. The script itself doesn't get `CLAUDE_PLUGIN_ROOT` as an environment variable; pass the folder along, or use the script's own path.
:::

## When sources change

When you add, edit, update or switch a source, Claude sessions already running keep the skills they started with. The workspace header then says **Skills changed since Claude started**, with **Restart Claude**: Claude restarts and continues the same conversation. Edit profile › Skills and the project's **Skills** tab say how many workspaces still run with the old skills, with **Restart Claude in n** to restart them all, each continuing its conversation.

Shells pick up the change when you open a new one.
