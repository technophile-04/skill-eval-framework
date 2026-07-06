# AGENTS.md

You are the orchestrator. This repo benchmarks agent skills: same task, with skill and without, k fresh executor runs per variant, records. v0.1 is shaped around one concrete consumer — knowledge-shaped skill libraries like [ethskills](https://ethskills.com), where each skill exists to beat a stale model prior. The human points you at a skill; you draft the task, run the loop, and mine the mistakes.

## The three roles

**Orchestrator** (you): drafts tasks, spawns executors, grades with the scripts, writes records and reports.

**Executor**: a freshly spawned agent that performs one run in a clean workspace. Two are supported; the executor is pinned per benchmark, and runs on different executors or models are different benchmarks — never blend them in one table.

```bash
# claude
cd <workspace> && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
  claude -p "$(cat TASK.md)" --model claude-opus-4-6 \
  --setting-sources project --dangerously-skip-permissions --strict-mcp-config

# codex
cd <workspace> && codex exec -s workspace-write "$(cat TASK.md)"
```

`--setting-sources project` is load-bearing for claude: user-level config crowds the skill listing and skills stop triggering. For codex the model comes from `~/.codex/config.toml` — record which one ran.

Save the executor's full transcript to `<run-dir>/transcript.md`.

**Judge**: a blind LLM (pinned in `lib/judge.ts`, currently `claude-opus-4-6`) that grades `expect:` lines from the evidence `verify` assembles (diff + output files). It never sees the variant, the skill, or the transcript.

## Authoring a task — who writes what

You draft the task yaml from the skill under test: read the skill, find the prior it corrects, write an `input` a stale-prior agent will get wrong, and `expect:` lines that catch exactly that. The human sanity-checks the draft once; from then on grading is the script and the judge, never you.

All grading goes through `expect:` lines — they scale across a skill library without per-skill code. Write them concrete enough that the judge can't bluff: name the file, the magnitude, the derivation you want to see, not just "does it look right".

Task yaml, all fields (`tasks/<id>.yaml`; the id is the filename):

```yaml
skill: skills/gas                # path to the skill dir; basename = install name
input: |                         # executor prompt; identical for every variant
  ...
template: templates/create-eth   # optional; omit for a bare workspace (just TASK.md)
expect:                          # judged conditions, at least one
  - "..."
runs: 3                          # per variant; below 3 is noise
notes: free text                 # optional
```

Question-shaped tasks (most of ethskills) run in a bare workspace and answer into files — say so in the input ("write your answer to answer.md"). Repo-shaped tasks use a template dir; `templates/` is gitignored, so record in `notes` how to regenerate it (e.g. `npx create-eth@latest`).

## The loop

1. `yarn setup --task tasks/<id>.yaml --variant <no_skill|with_skill> --run <n> --executor <claude|codex>`
2. Spawn a fresh executor in the printed workspace. Point it at `TASK.md` and nothing else.
3. `yarn verify --run artifacts/<id>/<run-id>` — snapshots output, runs the judge, fills `result.yaml`.
4. After all runs: the headline is raw pass counts per variant (`with_skill 2/3 vs no_skill 0/3`). Compare per-check failures, not just the aggregate.
5. File a mistake record in `mistakes/` the first time you see a mistake — `frequency: 1/1` is honest about weak evidence; an unfiled observation is just lost.
6. Write the comparison to `reports/<task-id>-<date>.md`, ending with the seven-question table below.
7. Recommend skill edits only where mistake records show a real gap. Runs are append-only history; a re-run after a patch is a new run id.

## Hard rules

1. **Never perform the task yourself.** Your context is contaminated by definition. Every run is a fresh executor. If you catch yourself editing files inside a workspace, stop, delete the run, start over.
2. **The executor never sees the grading.** The task yaml and its expect lines stay out of the workspace. `setup` enforces this and hard-fails on leaks; don't work around it.
3. **Always use the scripts** for setup and grading — these are the two steps where improvisation quietly corrupts records.
4. **Grade after execution, independently.** Never let an executor self-report success.
5. **Delete workspaces after grading.** `verify` snapshots un-gitted workspace output into `<run-dir>/output/` first, so nothing is lost; the records are the history.

## Variants and skill install

The task input never changes across variants; only the workspace does.

| Variant | Workspace contains |
| --- | --- |
| `no_skill` | task input (+ template) only |
| `with_skill` | the skill at `.agents/skills/<name>/`, agent decides to use it |

`.agents/skills/` is the canonical, executor-neutral location — codex discovers it natively. Claude only lists skills from `.claude/skills/`, so claude runs also get a copy there; that's the whole adapter. A future executor (opencode etc.) is a new bridge line in `setup`, nothing more.

Forcing the trigger is not a flag: prepend one line to the spawn prompt (`Use the <name> skill for this task.`) and say so in the report, so trigger-inclusive and content-only numbers never blend.

## Records

`artifacts/<task-id>/<run-id>/result.yaml` — one record per run. `setup` writes the top half, `verify` the rest:

```yaml
task: gas-cost-estimate-001
run: 2026-07-06T093000Z-claude-with-skill-1
executor: claude
variant: with_skill
skill_version: 191dcc1         # git short sha of the skill source; null for no_skill
created: 2026-07-06T09:30:00Z
expects:                       # judged expect lines, in task-spec order
  expect_1: pass
  expect_2: fail
pass: false                    # every expect passed
```

`mistakes/<skill>/<mistake-id>.yaml` — the part that makes the framework useful. Scores say whether the skill helped; mistakes say what to write next:

```yaml
mistake_id: gas-stale-eth-price
skill: gas
first_seen: 2026-07-06
frequency:                     # per variant
  no_skill: 3/3
  with_skill: 1/3
category: stale-knowledge
symptom: "Computes USD cost from a remembered ETH price instead of checking one."
expected_pattern: "Fetch ETH/USD live (Chainlink feed, CoinGecko) before quoting dollars."
skill_section: "What You Probably Got Wrong"   # the section that should prevent this, or "none" for a gap
status: open                   # open | fixed | wontfix
```

Records from before v0.1 (`erc20-goldtoken-001`) use the old schema — valid history, never rewrite them. Their task spec and deterministic verifier were removed along with the verifier concept; the full files live in git history.

## Reports

Every report ends with the same table:

| Question | Answer |
| --- | --- |
| Did the skill improve pass rate? | raw counts, e.g. `2/3 vs 0/3` |
| Did it reduce time/tokens? | yes/no, if observed |
| Did it create negative deltas? | list them |
| What mistakes repeated without the skill? | mistake ids |
| What mistakes remained with the skill? | mistake ids |
| What should change in the skill? | concrete edits |
| What should change in the eval? | missing or weak checks |

The last row is there on purpose. Sometimes the eval is the wrong artifact, not the skill.

## What gets committed

Committed: task specs, vendored skills under test, `result.yaml`, `run.diff`, `output/`, mistake records, reports. Gitignored: workspaces, transcripts, `templates/`.

## Code style

TypeScript throughout, run with tsx. Follow the [Scaffold-ETH 2 code style guide](https://github.com/scaffold-eth/scaffold-eth-2/blob/main/AGENTS.md#code-style-guide): `type` over `interface`, `UpperCamelCase` types without a `T` prefix, `lowerCamelCase` functions and variables, `CONSTANT_CASE` constants, let inference work instead of annotating, comments only where they add information.
