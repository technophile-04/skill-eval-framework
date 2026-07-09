# skill-eval-framework

Benchmarks whether an agent skill actually makes the agent better at the task it claims to improve. Same task, with the skill and without, fresh executor per run; the headline is raw pass counts per variant. Equally important is the follow-up, because that's what keeps a skill library maintainable: when the skill didn't help, what did the model get wrong, and which part of the skill should change?

It's built for knowledge-shaped skill libraries like [ethskills](https://ethskills.com), where a skill earns its place by beating a stale model prior — models quote Ethereum gas at 10-30 gwei from memory when reality is sub-1 gwei. Nothing about that is hardcoded, but it's the use case the design answers to.

## Using it

Open your coding agent in this directory and tell it which skill to check:

```
I want to eval the skill at skills/gas
```

It reads `AGENTS.md`, drafts a task from the skill and shows it to you, drafts the `expect:` lines the judge will grade against and shows you those, then asks which executor to run and how many runs per variant. Each question comes with a recommended answer, so approving the whole thing takes a few words. Everything after that it does on its own.

## How it works

There is no runner. Whatever coding agent you already drive orchestrates the benchmark loop — `AGENTS.md` is the full playbook, including every record schema. Two small scripts guard the steps where improvisation would corrupt results:

- `yarn setup` builds a clean workspace for one run: task prompt in, skill installed (or not), and a hard fail if any grading material would leak in.
- `yarn verify` grades a finished run: snapshots the output, has a blind LLM judge grade the task's `expect:` lines against it, and writes `result.yaml`. No model is baked in — the orchestrator passes `--judge-agent` and `--judge-model`, and `result.yaml` records which judge graded which run.

Executors are pluggable: `--executor claude` or `--executor codex`. Skills install at the cross-agent standard `.agents/skills/` (codex reads it natively; claude runs get a bridge copy at `.claude/skills/`).

The orchestrating agent never performs the task itself, and executors never see how they're graded.

## Layout

```
tasks/        task specs (yaml, one per task; filename = task id)
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
yarn verify --run artifacts/<id>/<run-id> --judge-agent claude --judge-model <model>
```

Repeat per variant and run count, then compare `result.yaml`s and write the report. You don't normally type these — the orchestrator does. `AGENTS.md` has the full loop, the intake conversation, and the mistake-record format.
