### Added

- **`dgmo install opencode` sets up OpenCode.** It adds a `dgmo` entry
  under `mcp` → `servers` in `~/.config/opencode/opencode.json` (or an
  existing `opencode.jsonc`; `./opencode.json` with `--scope project`),
  in the `{ "type": "local", "command": ["dgmo", "mcp"] }` shape OpenCode
  2.x writes itself, and keeps every other server and setting. The skill
  comes from the shared `~/.agents/skills/` copy, or OpenCode's own skills
  folder when the Codex plugin skips that copy. A config with comments is
  never rewritten: the install says what to add instead. A bare
  `dgmo install` detects OpenCode from `~/.config/opencode` or `opencode`
  on the PATH.
