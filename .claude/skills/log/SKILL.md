---
name: log
description: Append an entry to LOG.md recording meaningful work done in this repo - what changed, why, how it was verified, and what was left open. Use when the user types /log, and at the end of any session that produced a commit, a decision, or a finding worth remembering. Keeps a running history that later agents and humans can read to understand why the code looks the way it does.
---

# Logging work to LOG.md

`LOG.md` at the repo root is the record git history cannot give on its own: the
reasoning behind a change, what was ruled out, how it was checked, and what was
left open. Git says *what* changed. `LOG.md` says *why it was worth changing*,
and *what to be careful of next time*.

## When to write an entry

Write one when the work produced any of:

- a commit that changes behaviour, data, schema, or build
- a decision, especially one that closed off an alternative
- a bug diagnosed, whether or not it was fixed
- a finding worth remembering — a trap, a stale doc, a constraint discovered
- a merge, branch consolidation, or migration run against a real database

Do **not** write one for: a typo, a reformat, a dependency bump with no
behaviour change, an experiment that was reverted and left no trace, or work the
user explicitly called throwaway. When in doubt, ask whether someone six months
from now would be confused without it. If not, skip it.

If the user typed `/log` with no work behind it yet, ask what they want recorded
rather than inventing an entry.

## How to write it

1. **Read `LOG.md` first.** Match its voice and structure. If the file is
   missing, create it with the `# Work log` header and the explanatory preamble.

2. **Get the real facts. Never guess them.**
   - date: use today's actual date, `YYYY-MM-DD`
   - commit SHAs: `git log --oneline -5` — use the short SHA of the commit(s)
     the entry covers. If the work is not committed yet, say so explicitly
     rather than leaving a blank.
   - files and line numbers: only cite ones you actually read this session

3. **Insert newest-first**, directly below the `---` that ends the preamble and
   above the previous newest entry. Never append to the bottom. Never disturb
   existing entries.

4. **Use this shape:**

```markdown
## YYYY-MM-DD · Imperative title, same voice as a commit subject

**Commit:** `abc1234`

What changed and, more importantly, why. Lead with the problem, not the
solution. If a decision closed off an alternative, name the alternative and
say why it lost.

**Verified:** how you actually know it works. Name the command and the result.
"Build passes" is weaker than "regenerated all four outputs, byte-identical".
If it was not verified, say that plainly.

**Careful of:** anything that will bite the next person. Optional, but this is
often the most valuable line in the entry.
```

`**Commit:**`, `**Verified:**` and `**Careful of:**` are the only fixed labels.
Add others sparingly when they genuinely help.

5. **Open follow-ups.** `LOG.md` ends with an `## Open follow-ups` section.
   Anything found but not fixed goes there, roughly worst first — not into the
   dated entry. When a follow-up gets fixed, delete it from that section in the
   same commit that fixes it, and describe the fix in the new dated entry.

## Style

Match the repo's existing prose, which is plain and specific and does not
inflate. Concretely:

- Say what happened. Do not editorialise about how significant it was.
- Prefer the concrete number to the adjective: "38 TS2353 errors" over
  "many type errors".
- Explain a decision by its reason, not its outcome.
- No em dashes.
- Keep an entry to what someone actually needs. Three tight paragraphs beat a
  page. Long is fine when the reasoning genuinely needs it.

## After writing

Show the user the entry you added. Do not commit `LOG.md` on your own unless
the user asked you to commit, or you are already committing related work — in
which case include it in that commit rather than making a second one.
