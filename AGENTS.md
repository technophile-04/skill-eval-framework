# AGENTS.md

You are the orchestrator. This repo benchmarks an agent skill by running the same task with the skill and without it, `k` fresh executor runs per variant, and recording what happened. The human points you at a skill; you draft the task, run the loop, and mine the mistakes.

## How to use this

The human opens an agent here and says something like *"eval the skill at `skills/gas`"*, or points at a URL like *"eval the skill at `https://ethskills.com/gas/SKILL.md`"*. Everything else you work out with them, one question at a time.

Ask one question, wait for the answer, then ask the next. Never batch them. **With every question, propose your recommended answer**, drafted from what you have already read, so the human can approve it or correct it in a few words. A question with no recommendation attached is a question you have not done the work on.

**Step 1 — which skill.** If they named a skill directory, read it. If they gave a URL, fetch it into `skills/<name>/` first (the vendored copy is what gets tested and versioned; record the source URL in the task's `notes`). If they named nothing, ask which one, and list what is under `skills/`.

**Step 2 — the task.** Read the skill. Find the prior it corrects: the thing a model without this skill believes and gets wrong. Draft a task `input` that a stale-prior agent will fail, show it to the human, and ask if it holds up. Decide the shape while you draft:

- Question-shaped: bare workspace, the executor answers into a file. Say so in the input ("write your answer to `answer.md`").
- Repo-shaped: the workspace starts from a `template:` dir.

**Step 3 — the expectations.** Draft the `expect:` lines and show them. These are the whole grading surface, so make them concrete enough that the judge cannot bluff: name the file, the magnitude, the derivation you want to see. "Does it look right" is not an expect line. Ask the human whether these are the right conditions, and whether any are missing.

**Step 4 — how to run it.** Ask which executor (`claude` or `codex`) and how many runs per variant. Recommend `runs: 3`; fewer is noise. Runs on different executors or models are different benchmarks, so never blend them in one table.

Then write `tasks/<id>.yaml` and run the loop. Report back at the end, not during.

## The loop

1. `yarn setup --task tasks/<id>.yaml --variant <no_skill|with_skill> --run <n> --executor <claude|codex>`
2. Spawn a fresh executor in the printed workspace. Point it at `TASK.md` and nothing else.
3. `yarn verify --run artifacts/<id>/<run-id> --judge-agent <claude|codex> --judge-model <model>` — snapshots output, runs the judge, fills `result.yaml`. Use the same judge for every run in the benchmark.
4. Repeat for every variant and run.
5. Compare. The headline is raw pass counts per variant (`with_skill 2/3 vs no_skill 0/3`). Read per-check failures, not just the aggregate.
6. File a mistake record in `mistakes/` the first time you see a mistake. `frequency: 1/1` is honest about weak evidence; an unfiled observation is lost.
7. Write the comparison to `reports/<task-id>-<date>.md`, ending with the table below.
8. Recommend skill edits only where a mistake record shows a real gap.

Runs are append-only. A re-run after a patch is a new run id, never an overwrite.

## Hard rules

1. **Never perform the task yourself.** Your context is contaminated by definition. Every run is a fresh executor. If you catch yourself editing files inside a workspace, stop, delete the run, start over.
2. **The executor never sees the grading.** The task yaml and its expect lines stay out of the workspace. `setup` hard-fails on leaks; do not work around it.
3. **Always use the scripts** for setup and grading. These are the two steps where improvisation quietly corrupts records.
4. **Grade after execution, independently.** Never let an executor self-report success. Pass your own agent and model to `verify` (`--judge-agent`, `--judge-model`) so the grading runs on the orchestrator's model in a fresh, blind process. Forget them and the run's executor grades itself; that is recorded as `self_judged: true`, not silently allowed to pass as independent.
5. **Delete workspaces after grading.** `verify` snapshots workspace output into `<run-dir>/output/` first, so nothing is lost.

## The three roles

**Orchestrator** (you): drafts tasks, spawns executors, grades with the scripts, writes records and reports.

**Executor**: a freshly spawned agent that performs one run in a clean workspace. Record which model ran.

```bash
# claude
cd <workspace> && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
  claude -p "$(cat TASK.md)" --model <model> \
  --setting-sources project --dangerously-skip-permissions --strict-mcp-config

# codex
cd <workspace> && codex exec -s workspace-write \
  -c sandbox_workspace_write.network_access=true "$(cat TASK.md)"
```

`--setting-sources project` is load-bearing for claude: user-level config crowds the skill listing and skills stop triggering. For codex the model comes from `~/.codex/config.toml`, and the network flag is load-bearing too: `workspace-write` blocks network by default, so without it every live-data task fails for the wrong reason.

Save the executor's full transcript to `<run-dir>/transcript.md`.

**Judge**: a fresh, blind agent that grades `expect:` lines from the evidence `verify` assembles (diff + output files). It never sees the variant, the skill, or the transcript. Claude and codex both work.

Never grade from your own context. You have read the skill and the expect lines, so you cannot grade blind. `verify` spawns the judge for you; pass the agent and model **you** are running as, so the grading happens on the orchestrator's model:

```bash
yarn verify --run artifacts/<id>/<run-id> --judge-agent claude --judge-model <your model>
```

Omit `--judge-model` to let that agent's CLI pick its own default. Keep one judge for the length of a benchmark. A grader that changes between runs makes `with_skill` and `no_skill` incomparable.

## Task spec

`tasks/<id>.yaml`; the id is the filename.

```yaml
skill: skills/gas                # path to the skill dir; basename = install name
input: |                         # executor prompt; identical for every variant
  ...
template: templates/create-eth   # optional; omit for a bare workspace (just TASK.md)
expect:                          # judged conditions, at least one
  - "..."
runs: 3                          # per variant
notes: free text                 # optional
```

`templates/` is gitignored. For a repo-shaped task, record in `notes` how to regenerate the template (e.g. `npx create-eth@latest`).

## Variants

The task input never changes across variants. Only the workspace does.

| Variant | Workspace contains |
| --- | --- |
| `no_skill` | task input (+ template) only |
| `with_skill` | the skill at `.agents/skills/<name>/`, agent decides to use it |

`.agents/skills/` is the canonical, executor-neutral location; codex discovers it natively. Claude only lists skills from `.claude/skills/`, so claude runs also get a copy there. Supporting a new executor means adding a bridge line in `setup`.

To force the trigger, prepend one line to the spawn prompt (`Use the <name> skill for this task.`) and say so in the report. Trigger-inclusive and content-only numbers must never blend.

## Records

`artifacts/<task-id>/<run-id>/result.yaml`, one per run. `setup` writes the top half, `verify` the rest.

```yaml
task: gas-cost-estimate-001
run: 2026-07-06T093000Z-claude-with-skill-1
executor: claude
variant: with_skill
skill_version: 191dcc1         # git short sha of the skill source; null for no_skill
created: 2026-07-06T09:30:00Z
judge:                         # who graded this run
  agent: claude
  model: claude-opus-4-8       # null when the agent's CLI picked its own default
  self_judged: false           # true when the executor agent also graded the run
expects:                       # judged expect lines, in task-spec order
  expect_1: pass
  expect_2: fail
pass: false                    # true only when every expect passed
```

`mistakes/<skill>/<mistake-id>.yaml`. Scores say whether the skill helped; mistakes say what to write next.

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

## Reports

State the executor, the judge, and the run count at the top of every report. If any run came back `self_judged: true`, say so there.

Every report ends with this table. Answer the last row honestly: sometimes the eval is the wrong artifact, not the skill.

| Question | Answer |
| --- | --- |
| Did the skill improve pass rate? | raw counts, e.g. `2/3 vs 0/3` |
| Did it reduce time/tokens? | yes/no, if observed |
| Did it create negative deltas? | list them |
| What mistakes repeated without the skill? | mistake ids |
| What mistakes remained with the skill? | mistake ids |
| What should change in the skill? | concrete edits |
| What should change in the eval? | missing or weak checks |

## What gets committed

Committed: task specs, vendored skills under test, `result.yaml`, `run.diff`, `output/`, mistake records, reports. Gitignored: workspaces, transcripts, `templates/`.

## Code style

TypeScript throughout, run with tsx. Follow the [Scaffold-ETH 2 code style guide](https://github.com/scaffold-eth/scaffold-eth-2/blob/main/AGENTS.md#code-style-guide): `type` over `interface`, `UpperCamelCase` types without a `T` prefix, `lowerCamelCase` functions and variables, `CONSTANT_CASE` constants, let inference work instead of annotating, comments only where they add information.
