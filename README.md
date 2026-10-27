# claude-gear-preset (`ccgear`)

[![CI](https://github.com/maziazi/claude-gear-preset/actions/workflows/ci.yml/badge.svg)](https://github.com/maziazi/claude-gear-preset/actions/workflows/ci.yml)

Bundle MCP servers, skills, and slash commands into named presets, then launch
focused Claude Code sessions — several at once, each with its own toolkit.

```bash
ccgear dev      # terminal 1: context7 + filesystem + playwright, iOS skills
ccgear daily    # terminal 2: obsidian + tavily, no skills
```

Both run at the same time. Neither can see the other's tools.

## Why

Claude Code loads every MCP server and skill you have installed into every
session. A session spent writing SwiftUI does not need a blockchain RPC server
in its tool list, and a session spent reading notes does not need a browser
driver. Beyond the token cost, a shorter tool list means fewer wrong turns:
the model picks from what is actually relevant.

Presets are not a proxy or a gateway. `ccgear` writes a few temp files and
hands them to `claude` through flags it already supports, so there is no extra
process between you and your tools, and no single point of failure.

## Install

```bash
npm install -g https://github.com/maziazi/claude-gear-preset/archive/refs/heads/main.tar.gz
```

Requires Node 20+ and [Claude Code](https://claude.com/claude-code).

Use the tarball URL above, not `github:maziazi/claude-gear-preset` — npm's
git-dependency caching has a bug ([npm/cli#5170](https://github.com/npm/cli/issues/5170))
that can leave the installed package symlinked to a temp directory it then
deletes, breaking the command. The tarball URL skips that code path entirely.

New to it? The [guide](docs/GUIDE.md) walks through install, setup, and daily
use with worked examples.

## Usage

```bash
ccgear list                 # list presets
ccgear show <name>          # show a preset's contents
ccgear create <name>        # create a preset (interactive; --editor for raw JSON)
ccgear add <name>           # add a NEW mcp server / skill / command to a preset
ccgear clone <from> <to>    # copy a preset, bundled assets included
ccgear edit <name>          # edit a preset (interactive; --editor for raw JSON)
ccgear doctor <name>        # check a preset (--deep also connects to each server)
ccgear remove <name>        # delete a preset
ccgear version              # print the installed version
ccgear completion <shell>   # print a completion script (bash, zsh, fish)
ccgear <name> [args...]     # launch Claude Code with that preset
```

`ccgear create` walks through the tools it discovers as checkbox lists, one
kind at a time. With `--editor`, or when there is no terminal to prompt in, it
writes a pre-filled JSON file and opens your editor instead.

Anything after the preset name is passed straight through to `claude`:

```bash
ccgear dev --model opus
```

The first time a preset uses a given set of MCP servers, `ccgear` connects to
them before starting the session — Claude Code otherwise answers the first
prompt without waiting, and a server still downloading its package misses the
session with no error. Later launches skip it. Override with `--warm` or
`--no-warm`.

## Terminal integration

Plugins that ship only hooks — terminal integrations like Warp's — load in
every session automatically, even though isolating a session otherwise drops
them. They contribute nothing to the context, so there is no reason to make
you choose. Plugins that also bring skills, commands, or MCP servers stay
opt-in through `enabledPlugins`.

Tabs are named `<preset> - <topic>` as you work, rather than every one of them
reading `✳ Claude Code`.

## Preset format

Presets are JSON files in `~/.claude/gear/` (override with `$CCGEAR_DIR`).

```json
{
  "description": "Coding session — iOS/SwiftUI focus",
  "enabledMcpjsonServers": ["context7", "filesystem", "playwright"],
  "enabledPlugins": ["swift-lsp@claude-plugins-official"],
  "enabledSkills": ["ios-design", "pas-design-system"],
  "enabledCommands": ["review"]
}
```

These fields reference things already installed on the machine:

| Field | Source |
| --- | --- |
| `enabledMcpjsonServers` | `~/.claude.json`, `~/.claude/settings.json`, `.mcp.json` walked up from the cwd, plugin caches |
| `enabledPlugins` | `enabledPlugins` in `~/.claude/settings.json` |
| `enabledSkills` | directory names under `~/.claude/skills/` |
| `enabledCommands` | `*.md` basenames under `~/.claude/commands/` |

## Self-contained presets

A preset can also carry its own tools, so it works on a machine where nothing
is installed globally — useful for moving a setup between machines or sharing
one with someone else.

Give the preset a folder next to its JSON file. Anything inside is bundled
automatically; there is nothing to list:

```
~/.claude/gear/
├── portable.json
└── portable/
    ├── skills/
    │   └── vault-rules/SKILL.md
    └── commands/
        └── standup.md
```

MCP servers travel the same way, as full definitions under `mcpServers`:

```json
{
  "description": "Fully self-contained",
  "mcpServers": {
    "my-api": { "command": "npx", "args": ["-y", "my-mcp-server"] }
  }
}
```

The two styles mix freely. When a bundled asset and a referenced one share a
name, the bundled copy wins — shipping your own version means you meant to use
it. `ccgear show` marks bundled entries so you can tell them apart.

To move a preset to another machine, copy `<name>.json` and `<name>/` together.

## How it works

On launch, `ccgear` builds a temp directory containing an MCP config and a
synthetic plugin holding the preset's skills and commands, then runs:

```bash
claude --mcp-config <temp>/mcp-config.json \
       --strict-mcp-config \
       --setting-sources project,local \
       --plugin-dir <temp>/bundle \
       -n <preset>
```

Each flag does one necessary thing:

- `--strict-mcp-config` with `--mcp-config` — only the named servers connect.
- `--setting-sources project,local` — drops user-scope skills and commands.
  Without it, `--strict-mcp-config` isolates MCP servers but every global skill
  still loads.
- `--plugin-dir` — adds back exactly the skills and commands the preset names.

Temp files are deleted when the session exits. Nothing is written to your
settings, and because each preset is just another `claude` process, running
several at once needs no coordination.

Skill directories are symlinked so large folders cost nothing to include, with
a copy as fallback on Windows, where symlinks need Developer Mode. Command
files are always copied: Claude Code's loader skips symlinked `.md` files, so
a linked command would silently never appear.

## Trade-offs

Each preset is a distinct prompt prefix, so each keeps its own cache lineage.
Work in blocks — finish in one preset before switching — rather than hopping
between presets every few minutes.

## Documentation

- [Guide](docs/GUIDE.md) — install, setup, bundling, moving presets between
  machines, troubleshooting

## Prior art

[`claude-code-profiles`](https://github.com/Naraujo13/claude-code-profiles) (MIT)
solves the same problem for MCP servers and installed plugins. `ccgear` is an
independent implementation that adds standalone skills and slash commands,
which that tool does not cover.

## License

MIT
