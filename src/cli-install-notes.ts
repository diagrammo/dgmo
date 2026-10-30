// cli-install-notes.ts — the lines `dgmo install` closes with.
//
// The codebase report used to ship here as a slash command plus a Codex skill
// re-skinned from it. It now lives in the diagrammo/skills repo as the
// `dgmo-codebase-report` skill (#1108), so the installer points there instead
// of writing a copy that would drift from the maintained one.

const SKILLS_REPO = 'diagrammo/skills';

/** Closing lines naming the skills repo and how to install it. */
export function skillsInstallNote(): string[] {
  return [
    '',
    `More skills, including the codebase report, are in github.com/${SKILLS_REPO}.`,
    'In Claude Code:',
    `  /plugin marketplace add ${SKILLS_REPO}`,
    '  /plugin install diagrammo@diagrammo',
    `Other agents: copy a folder from that repo's skills/ into the agent's skills directory.`,
  ];
}
