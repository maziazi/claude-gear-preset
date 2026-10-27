# Guide

A walkthrough from installing `ccgear` to running several specialised Claude
Code sessions side by side.

- [Install](#install)
- [Your first preset](#your-first-preset)
- [Running presets](#running-presets)
- [Running several at once](#running-several-at-once)
- [Bundling tools into a preset](#bundling-tools-into-a-preset)
- [Moving a preset to another machine](#moving-a-preset-to-another-machine)
- [Checking a preset](#checking-a-preset)
- [Starting from an existing preset](#starting-from-an-existing-preset)
- [Tab completion](#tab-completion)
- [Command reference](#command-reference)
- [Where things live](#where-things-live)
- [Troubleshooting](#troubleshooting)

## Install

Requires [Claude Code](https://claude.com/claude-code) and Node 20 or newer.

```bash
npm install -g https://github.com/maziazi/claude-gear-preset/archive/refs/heads/main.tar.gz
```

Use that tarball URL, not `github:maziazi/claude-gear-preset` — a bug in npm's
git-dependency caching ([npm/cli#5170](https://github.com/npm/cli/issues/5170))
can leave the installed files symlinked to a temp directory npm then deletes,
so the command exists but points at nothing. Installing from the tarball URL
avoids that code path.

Check it:

```bash
ccgear version
```

If `ccgear` is not found, your global npm bin directory is not on `PATH`. Find
it with `npm bin -g` and add it to your shell profile.

## Your first preset

```bash
ccgear create dev
```

You are asked for a description, then shown a checkbox list for each kind of
tool it found:

```
MCP servers  (2 selected)
  ↑↓ move · space toggle · a all · n none · enter confirm
  [ ] context7
> [x] filesystem
  [x] playwright
  [ ] sentry
  … 8 more
```

Nothing starts selected — pick the handful this context needs. Categories with
nothing installed are skipped. The preset is validated as soon as it is saved
and anything that will not resolve is reported.

### Editing raw JSON instead

Pass `--editor` to skip the prompts and edit the file directly. The preset is
pre-filled with everything discovered, so the work becomes deleting what you
do not need:

```bash
ccgear create dev --editor
ccgear edit dev --editor
```

This is also what happens automatically when there is no terminal to prompt
in, such as in a script or CI job.

`ccgear` uses `$VISUAL`, then `$EDITOR`, then falls back to `nano`:

```bash
export EDITOR="code"     # or: cursor
```

## Running presets

```bash
ccgear dev
```

Claude Code starts with only that preset's servers, skills, and commands —
nothing else you have installed is visible to the session.

Anything after the preset name goes to `claude` unchanged:

```bash
ccgear dev --model opus
ccgear dev -p "summarise the diff"
```

## Running several at once

Each preset is an ordinary process, so two terminals are all it takes:

```bash
# terminal 1
ccgear dev

# terminal 2
ccgear daily
```

Neither session can see the other's tools, and there is no shared state to
coordinate. Run as many as you like.

One caveat: each preset is a separate prompt prefix, so each keeps its own
cache. Work in blocks — finish in one preset before switching — rather than
hopping between presets every few minutes.

## Bundling tools into a preset

The fields above reference tools installed globally. A preset can also carry
its own, which is how you get a setup that works on a machine with nothing
installed.

Create a folder next to the preset file, named after it. Anything inside is
picked up automatically — there is nothing to list in the JSON:

```bash
mkdir -p ~/.claude/gear/research/skills/source-notes
mkdir -p ~/.claude/gear/research/commands
```

```markdown
<!-- ~/.claude/gear/research/skills/source-notes/SKILL.md -->
---
name: source-notes
description: How to record a source while researching.
---

Record every claim with its source URL and the date you read it.
```

```markdown
<!-- ~/.claude/gear/research/commands/digest.md -->
---
description: Summarise today's findings.
---

Summarise what I learned today, grouped by topic, with sources.
```

MCP servers travel the same way — full definitions instead of names:

```json
{
  "description": "Research — fully self-contained",
  "mcpServers": {
    "tavily": {
      "type": "http",
      "url": "https://mcp.tavily.com/mcp/?tavilyApiKey=YOUR_KEY"
    }
  }
}
```

The result needs nothing installed globally:

```bash
ccgear show research
```

```
Preset : research
Desc   : Research — fully self-contained
Assets : /Users/you/.claude/gear/research

MCP servers (1):
  tavily  (bundled)

Skills (1):
  source-notes  (bundled)

Commands (1):
  digest  (bundled)
```

Both styles mix freely in one preset. When a bundled asset and a referenced
one share a name, the bundled copy wins — shipping your own version means you
meant to use it.

## Moving a preset to another machine

Copy the preset file and its folder together:

```bash
# on the old machine
cp -r ~/.claude/gear/research.json ~/.claude/gear/research /path/to/backup/

# on the new one
cp -r /path/to/backup/research.json /path/to/backup/research ~/.claude/gear/
```

Only bundled entries travel. If the preset also references globally installed
tools by name, those still need to exist on the new machine — `ccgear doctor`
will tell you which are missing.

Avoid committing a preset with API keys in `mcpServers` to a public repository.

## Checking a preset

```bash
ccgear doctor dev
```

It reports:

- servers named in `enabledMcpjsonServers` that no config defines
- skills and commands that do not exist
- misspelled fields, with the closest match suggested
- fields of the wrong type
- a Claude Code that is missing or too old for the flags `ccgear` relies on

`create` and `edit` run this automatically when you save.

### Actually connecting

The checks above read files. A definition can be perfectly well-formed while
the binary is missing, the token has expired, or the endpoint is down. Add
`--deep` to open a real MCP session with each server:

```bash
ccgear doctor dev --deep
```

```
✔ No issues found.

Connecting to 3 server(s)…
  ✔ context7: connected — Context7 4.4.3
  ✔ filesystem: connected — secure-filesystem-server 2.0.1
  ! sentry: needs authentication (HTTP 401)
  ✗ my-api: command not found: my-mcp-server
```

Servers are probed in parallel, so this usually takes a second or two. A
server needing authentication is marked `!` rather than `✗` — sign in once
with `claude mcp login <name>`. `ccgear` exits non-zero if anything failed,
which makes `--deep` usable as a check in a script.

No model is involved and nothing is billed: the probe sends the MCP
`initialize` handshake and reads the reply.

## Starting from an existing preset

`clone` copies a preset and its bundled assets, which is usually faster than
building a near-identical one from scratch:

```bash
ccgear clone dev dev-backend
ccgear edit dev-backend
```

## Tab completion

```bash
# zsh — add to a directory on your $fpath
ccgear completion zsh > ~/.zfunc/_ccgear

# bash
ccgear completion bash >> ~/.bashrc

# fish
ccgear completion fish > ~/.config/fish/completions/ccgear.fish
```

Subcommands and preset names both complete. Restart the shell afterwards.

## Command reference

| Command | What it does |
| --- | --- |
| `ccgear list` | List presets with a summary of each (`--names` for bare names) |
| `ccgear show <name>` | Show one preset's contents and assets path |
| `ccgear create <name>` | Create a preset (interactive; `--editor` for raw JSON) |
| `ccgear clone <from> <to>` | Copy a preset, bundled assets included |
| `ccgear edit <name>` | Edit a preset (interactive; `--editor` for raw JSON) |
| `ccgear doctor <name>` | Check a preset; `--deep` also connects to each server |
| `ccgear remove <name>` | Delete a preset (bundled assets are kept) |
| `ccgear version` | Print the installed version |
| `ccgear completion <shell>` | Print a completion script (bash, zsh, fish) |
| `ccgear <name> [args...]` | Launch Claude Code with that preset |

Preset names may use letters, digits, `-` and `_`, and cannot shadow a
subcommand above.

## Where things live

```
~/.claude/gear/
├── dev.json            preset definition
├── research.json
└── research/           optional, bundled assets for `research`
    ├── skills/
    └── commands/
```

Set `$CCGEAR_DIR` to keep presets somewhere else:

```bash
export CCGEAR_DIR="$HOME/Dropbox/ccgear"
```

Globally installed tools are read from, never written to:

| Source | Used for |
| --- | --- |
| `~/.claude.json`, `~/.claude/settings.json`, `.mcp.json` | MCP server definitions |
| `~/.claude/settings.json` → `enabledPlugins` | plugin ids |
| `~/.claude/skills/` | skills referenced by name |
| `~/.claude/commands/` | commands referenced by name |

## Troubleshooting

**`ccgear: command not found`** — the global npm bin directory is not on
`PATH`. Find it with `npm bin -g`.

**`ccgear` exists but running it fails, or `which ccgear` shows a broken
symlink** — you likely installed with `github:maziazi/claude-gear-preset`
instead of the tarball URL. Remove it and reinstall from the tarball:

```bash
npm uninstall -g claude-gear-preset
npm install -g https://github.com/maziazi/claude-gear-preset/archive/refs/heads/main.tar.gz
```

**`'claude' not found on PATH`** — install Claude Code, or make sure the
`claude` binary is reachable from the shell you launch `ccgear` in.

**"Your Claude Code build does not support …"** — run `claude update`.
`ccgear` needs `--mcp-config`, `--strict-mcp-config`, `--setting-sources`,
and `--plugin-dir`.

**A skill or command does not show up in the session** — run
`ccgear doctor <name>`. A skill must be a directory containing `SKILL.md`; a
command must be a `.md` file. Referenced ones are looked up in
`~/.claude/skills/` and `~/.claude/commands/`.

**A server is listed but never connects** — run `ccgear doctor <name> --deep`,
which connects to each one and says why. A server needing OAuth has to be
signed in once with `claude mcp login <name>`.

**Everything from my global setup still loads** — make sure you launched
through `ccgear <name>` and not plain `claude`.
