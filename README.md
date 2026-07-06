# skill-eval-framework

Benchmarks whether an agent skill actually makes the agent better at the task it claims to improve. Same task, with the skill and without, fresh executor per run; the headline is raw pass counts per variant. Equally important is the follow-up, because that's what keeps a skill library maintainable: when the skill didn't help, what did the model get wrong, and which part of the skill should change?

v0.1 is shaped around one concrete consumer: knowledge-shaped skill libraries like [ethskills](https://ethskills.com), where each skill exists to beat a stale model prior (models quote 10-30 gwei gas; reality is sub-1 gwei). Nothing ethskills-specific is hardcoded, but every design choice answers to that use case. Generality gets added back when a real consumer needs it.

## How it works

There is no runner. Whatever coding agent you already drive orchestrates the benchmark loop — `AGENTS.md` is the full playbook, including every record schema. Two small scripts guard the steps where improvisation would corrupt results:

- `yarn setup` builds a clean workspace for one run: task prompt in, skill installed (or not), and a hard fail if any grading material would leak in.
- `yarn verify` grades a finished run: snapshots the output, runs the optional deterministic verifier, has a blind LLM judge grade the task's `expect:` lines, and writes `result.yaml`.

Executors are pluggable: `--executor claude` or `--executor codex`. Skills install at the cross-agent standard `.agents/skills/` (codex reads it natively; claude runs get a bridge copy at `.claude/skills/`).

The orchestrating agent never performs the task itself, and executors never see how they're graded.

## Layout

```
tasks/        task specs (yaml, one per task; filename = task id)
verifiers/    optional deterministic grading code, never enters a workspace
skills/       vendored skill versions under test
templates/    workspace seeds (gitignored; tasks record how to regenerate)
artifacts/    run output: result.yaml + run.diff + output/ committed,
              workspaces and transcripts gitignored
mistakes/     mistake records mined from failures
reports/      markdown comparisons per benchmark
scripts/      setup and verify
```

## Running a benchmark

```bash
yarn setup --task tasks/<id>.yaml --variant no_skill --run 1 --executor claude
# spawn a fresh executor in the printed workspace (spawn commands in AGENTS.md)
yarn verify --run artifacts/<id>/<run-id>
```

Repeat per variant and run count, then compare `result.yaml`s and write the report. `AGENTS.md` has the full loop, the task-authoring model (the agent drafts, the human sanity-checks once), and the mistake-record format.
