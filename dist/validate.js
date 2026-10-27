const STRING_ARRAY_FIELDS = [
    "enabledMcpjsonServers",
    "enabledPlugins",
    "enabledSkills",
    "enabledCommands",
];
const KNOWN_FIELDS = [...STRING_ARRAY_FIELDS, "description", "mcpServers"];
/** Levenshtein distance, capped at a small budget since we only need "close". */
function distance(a, b) {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [
        i,
        ...Array(b.length).fill(0),
    ]);
    for (let j = 0; j <= b.length; j++)
        rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
        }
    }
    return rows[a.length][b.length];
}
function closestField(key) {
    let best = null;
    let bestDistance = Infinity;
    for (const field of KNOWN_FIELDS) {
        const d = distance(key.toLowerCase(), field.toLowerCase());
        if (d < bestDistance) {
            bestDistance = d;
            best = field;
        }
    }
    // Only suggest when it reads as a typo rather than a different word.
    return bestDistance <= 3 ? best : null;
}
/**
 * Check a preset's shape before anything tries to use it.
 *
 * A misspelled field is otherwise silently ignored, and a string where an
 * array belongs gets iterated character by character, so both are reported
 * here rather than surfacing as a preset that mysteriously does nothing.
 */
export function validateShape(raw) {
    const issues = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return [{ level: "error", message: "Preset must be a JSON object." }];
    }
    const preset = raw;
    for (const key of Object.keys(preset)) {
        if (KNOWN_FIELDS.includes(key))
            continue;
        const suggestion = closestField(key);
        issues.push({
            level: "error",
            message: suggestion
                ? `Unknown field '${key}' — did you mean '${suggestion}'?`
                : `Unknown field '${key}'. Known fields: ${KNOWN_FIELDS.join(", ")}.`,
        });
    }
    for (const field of STRING_ARRAY_FIELDS) {
        const value = preset[field];
        if (value === undefined)
            continue;
        if (!Array.isArray(value)) {
            issues.push({
                level: "error",
                message: `'${field}' must be an array of strings, got ${typeof value}.`,
            });
            continue;
        }
        if (value.some((entry) => typeof entry !== "string")) {
            issues.push({
                level: "error",
                message: `'${field}' must contain only strings.`,
            });
        }
    }
    if (preset.description !== undefined && typeof preset.description !== "string") {
        issues.push({ level: "error", message: "'description' must be a string." });
    }
    const servers = preset.mcpServers;
    if (servers !== undefined) {
        if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
            issues.push({
                level: "error",
                message: "'mcpServers' must be an object mapping names to definitions.",
            });
        }
        else {
            for (const [name, def] of Object.entries(servers)) {
                if (!def || typeof def !== "object" || Array.isArray(def)) {
                    issues.push({
                        level: "error",
                        message: `Server '${name}' in 'mcpServers' must be an object.`,
                    });
                }
            }
        }
    }
    return issues;
}
