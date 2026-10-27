import { homedir } from "node:os";
import { join } from "node:path";
const home = homedir();
/** Where ccgear stores its presets. Kept separate from ccp's ~/.claude/profiles. */
export const GEAR_DIR = process.env.CCGEAR_DIR ?? join(home, ".claude", "gear");
export const CLAUDE_JSON = join(home, ".claude.json");
export const CLAUDE_SETTINGS = join(home, ".claude", "settings.json");
export const USER_SKILLS_DIR = join(home, ".claude", "skills");
export const USER_COMMANDS_DIR = join(home, ".claude", "commands");
export const PLUGIN_CACHE_DIR = join(home, ".claude", "plugins", "cache");
export const PLUGIN_MARKETPLACES_DIR = join(home, ".claude", "plugins", "marketplaces");
export function presetPath(name) {
    return join(GEAR_DIR, `${name}.json`);
}
/**
 * Directory holding assets that belong to one preset.
 *
 * Anything under `<assets>/skills` or `<assets>/commands` is bundled
 * automatically, so a preset can carry its own tools without them being
 * installed globally first.
 */
export function presetAssetsDir(name) {
    return join(GEAR_DIR, name);
}
export function presetSkillsDir(name) {
    return join(presetAssetsDir(name), "skills");
}
export function presetCommandsDir(name) {
    return join(presetAssetsDir(name), "commands");
}
