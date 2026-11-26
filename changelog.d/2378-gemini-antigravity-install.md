### Added

- **`dgmo install gemini` and `dgmo install antigravity` set up Google's
  two CLIs.** Each adds a `dgmo` entry to the `mcpServers` key of its
  config — `~/.gemini/settings.json` for Gemini CLI (or
  `.gemini/settings.json` with `--scope project`),
  `~/.gemini/config/mcp_config.json` for Antigravity CLI — and keeps
  every other server and setting in the file. Both get the
  `dgmo-diagramming` skill once, in the shared `~/.agents/skills/`
  folder they both read (in `~/.gemini/skills/` instead while the Codex
  plugin is enabled). A bare `dgmo install`
  detects them from those files or from `gemini` / `agy` on the PATH.
