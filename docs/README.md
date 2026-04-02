# Company Context

These files are placeholders for the domain context your agents should learn from
before making decisions.

Recommended usage:
- keep them short, explicit, and current
- prefer definitions and decision rules over long prose
- update them when the business, metrics, or architecture changes
- if you do not know the answer yet, leave `TBD` instead of guessing

Suggested maintenance flow:
1. Add the minimum useful context
2. Let the agents use it
3. Expand only where repeated mistakes show a real gap

If you do not have company context on this machine yet, start with:
1. `intake-template.md`
2. `supply-chain-glossary.md`
3. `metrics.md`
4. `architecture.md`
