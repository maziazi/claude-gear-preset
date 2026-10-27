/** Subcommands offered before any preset name. */
const SUBCOMMANDS = [
  "list",
  "show",
  "create",
  "clone",
  "edit",
  "doctor",
  "remove",
  "version",
  "help",
];

const BASH = `# ccgear bash completion
_ccgear() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${SUBCOMMANDS.join(" ")} $(ccgear list --names 2>/dev/null)" -- "$cur") )
    return
  fi

  case "$prev" in
    show|edit|doctor|remove|clone)
      COMPREPLY=( $(compgen -W "$(ccgear list --names 2>/dev/null)" -- "$cur") )
      ;;
    create)
      COMPREPLY=()
      ;;
  esac
}
complete -F _ccgear ccgear`;

const ZSH = `#compdef ccgear
# ccgear zsh completion
_ccgear() {
  local -a presets subcommands
  subcommands=(${SUBCOMMANDS.join(" ")})
  presets=(\${(f)"$(ccgear list --names 2>/dev/null)"})

  if (( CURRENT == 2 )); then
    _describe 'subcommand' subcommands
    _describe 'preset' presets
    return
  fi

  case "\${words[2]}" in
    show|edit|doctor|remove|clone)
      _describe 'preset' presets
      ;;
  esac
}
compdef _ccgear ccgear`;

const FISH = `# ccgear fish completion
complete -c ccgear -f
${SUBCOMMANDS.map((c) => `complete -c ccgear -n '__fish_use_subcommand' -a '${c}'`).join("\n")}
complete -c ccgear -n '__fish_use_subcommand' -a '(ccgear list --names 2>/dev/null)'
complete -c ccgear -n '__fish_seen_subcommand_from show edit doctor remove clone' -a '(ccgear list --names 2>/dev/null)'`;

export const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof SUPPORTED_SHELLS)[number];

export function completionScript(shell: Shell): string {
  switch (shell) {
    case "bash":
      return BASH;
    case "zsh":
      return ZSH;
    case "fish":
      return FISH;
  }
}
