# pi-harness

Standalone Pi Coding Agent harness for day-to-day coding work.

This repo extracts the useful orchestration pieces from `pi-vs-claude-code` into a separate, cleaner project:
- dispatcher-led specialist teams
- optional sequential chains
- tool-call safety rules
- purpose and task discipline
- optional cross-agent imports from `.claude`, `.codex`, and `.gemini`

It is designed to run in isolation from your global Pi extension state. Every launch command uses `--no-extensions` and loads only this repo's extensions.

Agent subprocesses inherit the parent session's model. If no model is set, they fall back to `openrouter/google/gemini-3-flash-preview`.

## What Is Included

Core extensions:
- `agent-team`
- `agent-chain`
- `damage-control`
- `purpose-gate`
- `tilldone`

Optional extensions:
- `cross-agent`
- `system-select`
- `theme-cycler`

Workspace config:
- `.pi/agents/teams.yaml`
- `.pi/agents/agent-chain.yaml`
- `.pi/damage-control-rules.yaml`
- `.pi/settings.json`
- `.pi/themes/` — 11 bundled themes
- `.pi/workflows/` — shared planning, release, and retro artifacts
- `.pi/memory/` — durable project memory and learnings
- `docs/` — company and domain context for agents

## Prerequisites

- `pi`
- `bun`
- `just`

## Install

```bash
bun install
```

## API Keys

Pi does not auto-load `.env` by itself. Either source `.env` first or use the provided `just` recipes:

```bash
cp .env.sample .env
source .env
just harness
```

## Launch Modes

Lean dispatcher harness:

```bash
just harness
```

Lean chain harness:

```bash
just harness-chain
```

Full dispatcher harness with cross-agent imports and persona switching:

```bash
just harness-full
```

Full chain harness:

```bash
just harness-chain-full
```

Plain Pi with global extensions disabled:

```bash
just pi
```

Codex from the repo root:

```bash
just codex
```

Repo-local launcher:

```bash
./bin/pi-harness
./bin/pi-harness full
./bin/pi-harness chain
./bin/pi-harness chain-full
./bin/pi-harness pi
./bin/pi-harness typecheck
./bin/codex-harness
```

## Agents & Teams

<!-- Keep in sync with .pi/agents/ -->

### Agent Personas

Each agent runs as an isolated Pi subprocess with its own tools and persistent session state.

| Agent | Role | Tools | Writes Files? |
|-------|------|-------|---------------|
| `scout` | Fast recon and codebase exploration | read, bash, grep, find, ls | No |
| `lead-software-engineer` | Senior engineering direction, architecture, and technical tradeoffs | read, bash, grep, find, ls | No |
| `lead-data-scientist` | Senior data science direction, metrics, and analytical tradeoffs | read, bash, grep, find, ls | No |
| `planner` | Architecture and implementation planning | read, grep, find, ls | No |
| `builder` | Implementation and code generation | read, write, edit, bash, grep, find, ls | **Yes** |
| `reviewer` | Code review and quality checks | read, bash, grep, find, ls | No |
| `tester` | Validation execution, scenario checks, and test evidence | read, bash, grep, find, ls | No |
| `release-manager` | Ship readiness, release notes, rollout, and rollback planning | read, write, edit, bash, grep, find, ls | **Yes** |
| `red-team` | Security and adversarial testing | read, bash, grep, find, ls | No |
| `plan-reviewer` | Plan critic — reviews, challenges, and validates implementation plans | read, grep, find, ls | No |
| `documenter` | Documentation and README generation | read, write, edit, grep, find, ls | **Yes** |
| `dispatcher` | Routes work to specialist agents instead of editing directly | dispatch_agent | No |

Agent definitions live in `.pi/agents/<name>.md`.

Agents can also declare a `runner` in frontmatter:
- `runner: pi` for Pi subprocesses
- `runner: codex` for Codex subprocesses

Current default runner split:
- Pi: leads, planner, plan-reviewer, reviewer, red-team, release-manager, documenter, dispatcher
- Codex: builder, data-engineer, analytics-engineer, ml-engineer, tester

Codex-run specialists are currently stateless per invocation. Shared context should flow through repo files, workflow artifacts, and memory files rather than per-agent Codex sessions.

### Teams

<!-- Keep in sync with .pi/agents/teams.yaml -->

Teams are named agent rosters loaded by the `agent-team` extension. Switch teams with `/agents-team <name>`.

| Team | Agents | Use When |
|------|--------|----------|
| `default` | planner, builder, reviewer, tester, release-manager | Stage-based default flow |
| `fast-path` | planner, builder, reviewer, tester | You already know the codebase and need less ceremony |
| `software` | scout, lead-software-engineer, planner, plan-reviewer, builder, reviewer, tester, release-manager | Software engineering and platform work |
| `data` | scout, lead-data-scientist, planner, plan-reviewer, builder, reviewer, tester, release-manager | Data engineering, analysis, and data science work |
| `research` | scout, lead-data-scientist, planner, plan-reviewer, documenter, reviewer | Investigation and analytical framing |
| `hardening` | scout, lead-software-engineer, planner, plan-reviewer, builder, reviewer, tester, release-manager, red-team | Security-sensitive or risky changes |
| `docs` | scout, planner, builder, documenter, reviewer, tester, release-manager | Tasks that include documentation and release updates |
| `full` | scout, lead-software-engineer, lead-data-scientist, planner, plan-reviewer, builder, reviewer, tester, release-manager, documenter, red-team | Full specialist roster |
| `fast-build` | planner, builder, reviewer, tester | Minimal plan-build-review-test cycle |

Defined in `.pi/agents/teams.yaml`.

### Chain Pipelines

<!-- Keep in sync with .pi/agents/agent-chain.yaml -->

Chains are automated multi-step sequences where each agent's output feeds the next. Run with `just harness-chain` and use `/chain` to switch the active pipeline.

| Chain | Steps | Description |
|-------|-------|-------------|
| `plan-build-review` | planner → plan-reviewer → builder → reviewer | Plan, critique, implement, and review |
| `scout-plan-build-review` | scout → planner → plan-reviewer → builder → reviewer | Scout first for ambiguous or larger tasks |
| `plan-build` | planner → builder | Fast two-step, no review |
| `scout-flow` | scout → scout → scout | Triple-pass deep recon |
| `plan-review-plan` | planner → plan-reviewer → planner | Iterative planning with critique |
| `full-review` | scout → planner → plan-reviewer → builder → reviewer | End-to-end pipeline |
| `docs-finish` | planner → plan-reviewer → builder → documenter → reviewer | Implement and then bring docs in sync |
| `hardening-review` | scout → planner → plan-reviewer → builder → reviewer → red-team | Risky change with adversarial review |
| `software-lifecycle` | lead-software-engineer → planner → builder → reviewer → tester → release-manager | Think, plan, build, review, test, and ship for software work |
| `data-lifecycle` | lead-data-scientist → planner → builder → reviewer → tester → release-manager | Think, plan, build, review, test, and ship for data work |
| `hardening-lifecycle` | lead-software-engineer → planner → plan-reviewer → builder → reviewer → tester → release-manager → red-team | Full risky-change lifecycle |

Defined in `.pi/agents/agent-chain.yaml`.

## Damage Control

The `damage-control` extension intercepts tool calls and blocks or gates dangerous operations before they execute. Rules are defined in `.pi/damage-control-rules.yaml`.

### Rule Categories

**`bashToolPatterns`** — Shell commands matched by regex. Blocked outright unless marked `ask: true`, in which case the user is prompted for confirmation.

| Category | Examples |
|----------|----------|
| Destructive filesystem | `rm -rf`, `mkfs.*`, `dd … of=/dev/` |
| Dangerous git | `git push --force`, `git reset --hard`, `git clean -fd`, `git filter-branch` |
| Cloud infrastructure | `aws s3 rm --recursive`, `gcloud projects delete`, `firebase projects:delete` |
| Platform deploys | `vercel remove`, `netlify sites:delete`, `wrangler delete` |
| SQL destruction | `DROP TABLE`, `TRUNCATE TABLE`, `DELETE FROM … ;` (no WHERE) |
| Ask-mode (user confirms) | `git checkout -- .`, `git stash drop`, `git branch -D`, `DELETE FROM … WHERE id=` |

**`zeroAccessPaths`** — Files that cannot be read or written. Covers secrets and credentials.

Examples: `.env`, `.env.*`, `~/.ssh/`, `~/.aws/`, `*.pem`, `*.key`, `*.tfstate`, `serviceAccountKey.json`

**`readOnlyPaths`** — Files that can be read but not written. Covers system dirs, lockfiles, and build output.

Examples: `/etc/`, `package-lock.json`, `bun.lockb`, `*.min.js`, `node_modules/`, `dist/`, `.next/`

**`noDeletePaths`** — Files that cannot be deleted. Covers repo scaffolding and CI config.

Examples: `.git/`, `.github/`, `LICENSE`, `README.md`, `CONTRIBUTING.md`, `Dockerfile`, `docker-compose.yml`

Customize rules by editing `.pi/damage-control-rules.yaml`.

## Slash Commands

### Core (all modes)

| Command | Extension | Description |
|---------|-----------|-------------|
| `/agents-team <name>` | agent-team | Switch to a named team |
| `/agents-list` | agent-team | List agents in the current team |
| `/agents-grid` | agent-team | Show all teams and their agents |
| `/agents-reset` | agent-team | Reset all agent sessions |
| `/chain` | agent-chain | Switch active chain pipeline |
| `/chain-list` | agent-chain | List available chains |
| `/chain-reset` | agent-chain | Reset chain session state |
| `/tilldone` | tilldone | Repeat the current task until complete |

### Optional (full mode only)

| Command | Extension | Description |
|---------|-----------|-------------|
| `/theme` | theme-cycler | Cycle through bundled themes |
| `/system` | system-select | Switch system prompt persona |

The `cross-agent` extension scans `.claude/`, `.gemini/`, and `.codex/` directories at both the project root and `$HOME` for commands, skills, and agents. Discovered commands are registered as slash commands automatically.

The dispatcher can also switch teams automatically via the `select_team` tool before dispatching work. Current routing intent:
- `software` for backend, app, service, and platform engineering work
- `data` for pipelines, warehouse models, SQL transformations, and data contracts
- `analysis` for metrics, dashboards, experimentation readouts, and analytical SQL
- `ml-platform` for training, inference, feature pipelines, evaluation, and monitoring
- `hardening` for risky or security-sensitive work

## Workflow Layer

This repo now includes a lightweight `gstack`-inspired workflow layer shared by both Pi and Codex.

Workflow artifacts:
- `.pi/workflows/problem.md`
- `.pi/workflows/plan.md`
- `.pi/workflows/test-plan.md`
- `.pi/workflows/review-readiness.md`
- `.pi/workflows/release.md`
- `.pi/workflows/retro.md`

Durable memory:
- `.pi/memory/project.md`
- `.pi/memory/work-style.md`
- `.pi/memory/learnings.md`

Mirrored workflow commands exist in both `.claude/commands/` and `.codex/commands/`:
- `/prime`
- `/office-hours`
- `/plan-eng-review`
- `/review-readiness`
- `/ship`
- `/retro`
- `/learn`
- `/codex`

`/codex` is the primary Codex handoff command.

Suggested cadence:
1. `/office-hours`
2. `/plan-eng-review`
3. build with the appropriate team or chain
4. `/review-readiness`
5. `/ship`
6. `/retro`
7. `/learn` when you want to refine project memory

## Codex Access

Codex is now a first-class entrypoint for this repo:
- `just codex`
- `./bin/codex-harness`
- project-local `.codex/commands/` matching the workflow prompts
- project-local Claude command `/codex` for Codex handoff without manual `cd`

That gives Pi and Codex the same command vocabulary and the same workflow artifact layer.

## Default & Full Workflows

### Default Workflow

`just harness` loads:
- `damage-control`
- `purpose-gate`
- `agent-team`
- `tilldone`

The default specialist team is:
- `scout`
- `planner`
- `plan-reviewer`
- `builder`
- `reviewer`

Persistent worker state is stored in `.pi/agent-sessions/`.

The typical dispatch flow:
1. `scout` when the request is ambiguous or needs repo discovery
2. `planner` to produce the implementation plan
3. `plan-reviewer` to critique the plan before code is written
4. `builder` to make the change
5. `reviewer` to check for bugs, regressions, and missing tests

Additional specialists brought in by other teams:
- `documenter` for README/docs/example updates after implementation
- `red-team` for adversarial review of risky work like auth, secrets, migrations, infra, and destructive commands

### Full Workflow

`just harness-full` adds:
- `cross-agent`
- `system-select`
- `theme-cycler`

Cross-agent prompt discovery points at:
- `../.claude/commands`
- `../.codex/commands`
- `../.gemini/commands`

## Validation

```bash
just typecheck
```

CI runs the same typecheck on pushes and pull requests.

## Repo Layout

```text
pi-harness/
├── bin/
│   └── pi-harness
├── extensions/
│   ├── agent-chain.ts
│   ├── agent-team.ts
│   ├── cross-agent.ts
│   ├── damage-control.ts
│   ├── purpose-gate.ts
│   ├── system-select.ts
│   ├── theme-cycler.ts
│   ├── themeMap.ts
│   └── tilldone.ts
├── .pi/
│   ├── agents/
│   │   ├── builder.md
│   │   ├── dispatcher.md
│   │   ├── documenter.md
│   │   ├── plan-reviewer.md
│   │   ├── planner.md
│   │   ├── red-team.md
│   │   ├── reviewer.md
│   │   ├── scout.md
│   │   ├── agent-chain.yaml
│   │   └── teams.yaml
│   ├── themes/            (11 themes)
│   ├── agent-sessions/
│   ├── damage-control-rules.yaml
│   └── settings.json
├── .github/
│   ├── workflows/ci.yml
│   └── ISSUE_TEMPLATE/
├── .claude/commands/
├── CONTRIBUTING.md
├── LICENSE.md
├── justfile
├── package.json
├── bun.lock
└── tsconfig.json
```

## Contributing & License

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines and [LICENSE.md](LICENSE.md) for terms.
