set dotenv-load := true

default:
    @just --list

pi:
    pi --no-extensions

codex:
    codex --cd {{justfile_directory()}}

harness:
    pi --no-extensions -e extensions/damage-control.ts -e extensions/purpose-gate.ts -e extensions/agent-team.ts -e extensions/tilldone.ts

harness-full:
    pi --no-extensions -e extensions/cross-agent.ts -e extensions/damage-control.ts -e extensions/purpose-gate.ts -e extensions/agent-team.ts -e extensions/system-select.ts -e extensions/tilldone.ts -e extensions/theme-cycler.ts

harness-chain:
    pi --no-extensions -e extensions/damage-control.ts -e extensions/purpose-gate.ts -e extensions/agent-chain.ts -e extensions/tilldone.ts

harness-chain-full:
    pi --no-extensions -e extensions/cross-agent.ts -e extensions/damage-control.ts -e extensions/purpose-gate.ts -e extensions/agent-chain.ts -e extensions/system-select.ts -e extensions/tilldone.ts -e extensions/theme-cycler.ts

typecheck:
    bun x tsc --noEmit
