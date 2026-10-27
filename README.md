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
npm install -g github:maziazi/claude-gear-preset
```

Requires Node 20+ and [Claude Code](https://claude.com/claude-code).

## Usage

```bash
ccgear list                 # list presets
ccgear show <name>          # show a preset's contents
ccgear create <name>        # create a preset (opens $EDITOR, pre-filled)
ccgear edit <name>          # edit an existing preset
ccgear doctor <name>        # check for missing servers/skills/commands
ccgear remove <name>        # delete a preset
ccgear <name> [args...]     # launch Claude Code with that preset
```

`ccgear create` pre-fills the preset with everything it can discover, so the
job is deleting what this context does not need. Anything after the preset name
is passed straight through to `claude`:

```bash
ccgear dev --model opus
```

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

| Field | Source |
| --- | --- |
| `enabledMcpjsonServers` | `~/.claude.json`, `~/.claude/settings.json`, `.mcp.json` walked up from the cwd, plugin caches |
| `enabledPlugins` | `enabledPlugins` in `~/.claude/settings.json` |
| `enabledSkills` | directory names under `~/.claude/skills/` |
| `enabledCommands` | `*.md` basenames under `~/.claude/commands/` |

## How it works

On launch, `ccgear` builds a temp directory containing an MCP config and a
synthetic plugin whose `skills/` and `commands/` entries are symlinks to your
real ones, then runs:

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

## Trade-offs

Each preset is a distinct prompt prefix, so each keeps its own cache lineage.
Work in blocks — finish in one preset before switching — rather than hopping
between presets every few minutes.

## Prior art

[`claude-code-profiles`](https://github.com/Naraujo13/claude-code-profiles) (MIT)
solves the same problem for MCP servers and installed plugins. `ccgear` is an
independent implementation that adds standalone skills and slash commands,
which that tool does not cover.

## License

MIT
