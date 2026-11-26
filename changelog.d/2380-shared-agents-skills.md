### Added

- `dgmo install` writes the skill to the shared `~/.agents/skills/dgmo-diagramming/` folder, read by Gemini CLI, OpenCode, Amp, Goose and others. A new `agents` target writes only that copy. It is skipped while the Diagrammo Codex plugin is enabled, so Codex lists the skill once.

### Changed

- Codex without the plugin now gets its skill from `~/.agents/skills`, and the old `~/.codex/skills/dgmo-diagramming` copy is removed, because Codex reads both folders and listed the skill twice.
