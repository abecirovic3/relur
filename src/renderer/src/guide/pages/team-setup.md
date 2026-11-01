# Set up your team's skills and workflow

If your team keeps its Claude Code skills in a repository and runs tasks through a workflow, this page sets up {{app}} for it, in order. You don't type the workflow in yourself: **Set up from my skills** has Claude read your skills and fill it in, and you check it. Each step says what it's for. The names here are examples; use your team's.

It takes a few minutes, once per profile. Everything you enter is kept in {{app}}'s settings, never in your repositories.

## 1. Add the skills source

Right-click the profile tab, **Edit profile…**, then **Skills**. Under **Add a source**, add your team's skills repository as a **Git URL**, for example `git@git.example.com:team/claude-skills.git`, or your clone of it as a **Folder**, then **Add source**.

**What it's for:** Claude started by {{app}} gets these skills in this profile's sessions, so `/team-skills:plan-task` and the rest are there in every workspace, without installing anything into Claude or the repositories. Pick **Folder** if you change the skills yourself: your edits reach Claude the next time it starts.

The source's card lists every skill it found. If it says **Nothing to load**, the source isn't laid out as a plugin or as skill folders; see [Skills](skills#what-a-source-can-hold).

If the source already carries a shared workflow (a `{{workflowFile}}` file at its root), its card asks **This skill source includes a workflow. Use it?** Click **Use it** and the profile has your team's workflow: go on with step 2, then skip to step 5 to check it.

## 2. Add your projects

**Add project** (<kbd>{{key:addProject}}</kbd>) for each repository. Two settings in the dialog matter for a team workflow:

- **Worktrees:** choose **Choose folder…** and pick the folder your repositories are in, for example `~/Projects`. For a project you already have, use **Change…** under **Worktrees** in its project view.
- **Base branch:** the branch your team merges tasks into, for example `main` or `develop`. {{app}} suggests the remote's default branch; change it before you add the project if your team works on another.

**What it's for:** worktrees then go to `~/Projects/.worktrees/<project>/<branch>`. Workflow skills often create their worktrees there too, so the ones {{app}} creates and the ones a skill creates end up side by side, and {{app}} offers to [adopt](adopting-worktrees) the skill's. See [Where worktrees go](worktrees). Every new workspace branches off the base branch, fetched fresh from the remote, and the Changes panel compares the task against it. For one task you can pick another base in [New workspace](new-workspace).

Typing `~/Projects` itself as the path, instead of one repository, lists all the repositories in it, so you can add them in one go.

## 3. Start one task with your skills

Create a workspace (<kbd>{{key:newWorkspace}}</kbd>) and run your workflow skill in its Claude tab, the way you'd normally work, until the skill has written its status file, say `docs/specs/<task>/specification.md` with `status: drafting`.

**What it's for:** the next step reads that file to see how your skills record a task's status.

## 4. Set up the workflow from your skills

Open **Edit profile › Workflow**. **Set up from my skills** is near the top (when the profile already has a workflow, click **Set up from my skills…** to open it). Pick the **Skill source** and, under **A task in progress**, the workspace from step 3 with its status file, then click **Propose a workflow**. This profile's Claude reads the skills and the status file, and only those: it can't change anything, run commands or reach the web. After a minute or two the form is filled in:

- the status file and which field ties it to the workspace,
- the statuses in order, with the **gates** where the skill waits for you, and a hint and an answer button for each gate,
- a **Start prompt** that runs your workflow skill, and a **Continue prompt**,
- a task lookup, if one of the profile's connectors can read an issue.

Nothing is saved yet. Read the note above the form: **Couldn't determine** lists what Claude couldn't work out, so you fill that in. If it found a task lookup, **Also set up the task lookup** saves that too; it's ticked unless the profile already has one. Check the **Preview** at the bottom, which reads the task you picked. Fix what needs fixing, then **Save workflow**.

**What it's for:** {{app}} shows the status as a stepper in the workspace and as a label in the sidebar. A gate is a status where the skill stops and waits for a person, say to review the spec: the workspace then shows **Awaiting approval** and you get one notification. A final status ends the workflow. The gate's hint says what's expected of you, and its answer button, for example **Approve spec**, types `I approve the spec.` into Claude. At the other steps, **Continue** types the Continue prompt.

A colleague can also send you a working workflow as a file for **Import…** on the same tab. Once yours works, **Export…** it and put the file at the root of your skill source as `{{workflowFile}}`, so the next person gets it in step 1. See [Workflows](workflows#sharing-a-workflow).

### Or enter it by hand

Tick **Read a workflow status in this profile's workspaces** and fill in the form yourself. For a skill that keeps its status in `docs/specs/<task>/specification.md`:

| Field | Example |
| --- | --- |
| Status file | `docs/specs/*/specification.md` |
| Under **Advanced**: The workspace's file has the field … equal to the workspace's … | `branch`, branch |
| Under **Advanced**: Status field | `status` |
| Under **Advanced**: Title field | `title`, if the skill writes one |
| Under **Advanced**: Document label | `Spec` |

Then the statuses, in order, with the value the skill writes, a label, and a kind:

| Value in the file | Label | Kind |
| --- | --- | --- |
| `drafting` | Drafting | Step |
| `spec-review` | Spec review | Gate, hint `Review and approve the spec`, button **Approve spec** → `I approve the spec.` |
| `implementing` | Implementing | Step |
| `code-review` | Code review | Gate |
| `done` | Done | Final |

Pick a workspace under **Preview** to check the settings against a real worktree before you save. See [Workflows](workflows).

## 5. Check the Start prompt and the task lookup

On the **Workflow** tab, check the **Start prompt**, for example `/team-skills:plan-task {id} {title}`, or write one if it's empty.

**What it's for:** it's Claude's first message in a new workspace, so the workflow starts by itself as soon as the worktree is ready. `{id}` and `{title}` come from the task you type. It's sent only when the task has an id: a workspace for a quick experiment without one starts Claude plainly. It's sent once: resuming or restarting Claude doesn't send it again. Leave it empty to start each task yourself.

Then open the **Task lookup** tab. If step 4 set it up, type a real task id next to **Test**: it shows the title, or why there is none. Otherwise pick **Ask Claude** and list the one tool of your tracker's connector that reads a ticket under **Tools it may use**, for example `mcp__tracker__get_issue`, or pick **Run a command** if your tracker has a command line tool that prints a title, and **Test** it. If Claude wasn't allowed a tool it needed, **Allow this tool** adds it. Save with **Save task lookup**.

**What it's for:** you can then start a task by typing its key alone: {{app}} finds the title, names the branch after it and creates the workspace. The lookup only reads, so give it read tools only.

A project that works differently can have its own settings in its project view: its **Workflow** tab can **Override for this project**, turn the workflow off with **None**, or set its own Start prompt, which replaces the profile's for that project. Its **Skills** tab can switch a skills source off for that project.

## 6. Try it on a task

Create a workspace for a small task by typing its key alone, for example `ABC-1` (<kbd>{{key:newWorkspace}}</kbd>), and pressing <kbd>↵</kbd>. The title is looked up and the workspace created. Without a task lookup, type the title after the key: `ABC-1 Fix a typo in the README`.

1. Claude starts with your Start prompt. Type `/` in Claude's tab: your team's skills are listed.
2. As the skill works, the stepper in the workspace header moves along.
3. At a gate the workspace shows **Awaiting approval**. Click **Review**: the status file opens in the workspace's **Spec** tab. Read what the skill asks you to review.
4. Click **Approve spec**, the gate's answer button, or answer in Claude's tab (<kbd>{{key:continueWorkflow}}</kbd> takes you there). The skill goes on to the next step.

If the stepper doesn't move, open **Edit profile › Workflow** and pick this workspace under **Preview**: it says what it found, or why it found nothing.
