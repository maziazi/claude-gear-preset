/** A named bundle of MCP servers, skills, and slash commands. */
export interface Preset {
  description?: string;
  /**
   * Full MCP server definitions owned by this preset. Unlike
   * `enabledMcpjsonServers`, these need nothing installed globally, which makes
   * a preset portable between machines.
   */
  mcpServers?: Record<string, McpServerDefinition>;
  /** MCP server aliases, resolved against discovered definitions at launch. */
  enabledMcpjsonServers?: string[];
  /** Plugin ids in `name@marketplace` form. */
  enabledPlugins?: string[];
  /** Skill directory names under ~/.claude/skills. */
  enabledSkills?: string[];
  /** Command file basenames (without .md) under ~/.claude/commands. */
  enabledCommands?: string[];
}

/** A raw MCP server definition as it appears in a Claude config file. */
export type McpServerDefinition = Record<string, unknown>;

export interface Discovered {
  mcpServers: Map<string, McpServerDefinition>;
  plugins: string[];
  skills: string[];
  commands: string[];
}

export interface DoctorIssue {
  level: "error" | "warn";
  message: string;
}
