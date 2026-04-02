---
description: Create and critique an engineering plan before implementation
---

# Plan Engineering Review

Create a high-quality engineering plan, then challenge it like a lead reviewer.

## Tasks

1. Read `.pi/workflows/problem.md`, `.pi/workflows/plan.md`, `.pi/workflows/test-plan.md`, and relevant code.
2. If multi-agent dispatch is available, prefer `planner` then `plan-reviewer`.
3. Produce an implementation plan covering:
   - scope
   - affected files and systems
   - sequencing
   - risks
   - rollout and fallback
4. Produce a test plan covering:
   - checks to run
   - failure modes to probe
   - evidence to capture
5. Update:
   - `.pi/workflows/plan.md`
   - `.pi/workflows/test-plan.md`

## Output

Respond with:
- the reviewed plan summary
- the top risks
- whether the task is ready for `builder`
