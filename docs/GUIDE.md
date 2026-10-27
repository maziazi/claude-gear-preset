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
- [Command reference](#command-reference)
- [Where things live](#where-things-live)
- [Troubleshooting](#troubleshooting)

## Install

Requires [Claude Code](https://claude.com/claude-code) and Node 20 or newer.

```bash
npm install -g github:maziazi/claude-gear-preset
```

Check it:

```bash
ccgear version
```

If `ccgear` is not found, your global npm bin directory is not on `PATH`. Find
it with `npm bin -g` and add it to your shell profile.

## Your first preset

`ccgear create` opens your editor with everything it can find already filled
in, so the work is deleting what this context does not need.

```bash
ccgear create dev
```

You will see something like:

```json
{
  "description": "",
  "enabledMcpjsonServers": ["context7", "filesystem", "github", "playwright", "sentry"],
  "enabledPlugins": ["swift-lsp@claude-plugins-official"],
  "enabledSkills": ["ios-design", "commit", "okx-defi"],
  "enabledCommands": []
}
```

Cut it down to what a coding session actually uses, add a description, save,
and close the editor:

```json
{
  "description": "Coding session — iOS/SwiftUI focus",
  "enabledMcpjsonServers": ["context7", "filesystem", "playwright"],
  "enabledPlugins": ["swift-lsp@claude-plugins-official"],
  "enabledSkills": ["ios-design", "commit"],
  "enabledCommands": []
}
```

`ccgear` validates the preset as soon as you save and reports anything that
will not resolve.

`ccgear` uses `$VISUAL`, then `$EDITOR`, then falls back to `nano`. To use
VS Code or Cursor:

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

## Command reference

| Command | What it does |
| --- | --- |
| `ccgear list` | List presets with a summary of each |
| `ccgear show <name>` | Show one preset's contents and assets path |
| `ccgear create <name>` | Create a preset, pre-filled, in your editor |
| `ccgear edit <name>` | Edit an existing preset |
| `ccgear doctor <name>` | Check a preset without launching it |
| `ccgear remove <name>` | Delete a preset (bundled assets are kept) |
| `ccgear version` | Print the installed version |
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

**`'claude' not found on PATH`** — install Claude Code, or make sure the
`claude` binary is reachable from the shell you launch `ccgear` in.

**"Your Claude Code build does not support …"** — run `claude update`.
`ccgear` needs `--mcp-config`, `--strict-mcp-config`, `--setting-sources`,
and `--plugin-dir`.

**A skill or command does not show up in the session** — run
`ccgear doctor <name>`. A skill must be a directory containing `SKILL.md`; a
command must be a `.md` file. Referenced ones are looked up in
`~/.claude/skills/` and `~/.claude/commands/`.

**A server is listed but never connects** — `doctor` only checks that a
definition exists, not that it works. A server needing OAuth has to be signed
in once with `claude mcp login <name>`.

**Everything from my global setup still loads** — make sure you launched
through `ccgear <name>` and not plain `claude`.
