# skill-eval-framework

A minimal, extensible eval framework for agent skills. To start using just point your [claude code](https://github.com/anthropics/claude-code) or [codex](https://github.com/openai/codex) at this repo and it orchestrates the whole benchmark itself.

The loop it's built around:

1. write or edit a skill
2. run the benchmark
3. read what the runs got wrong
4. patch the skill where they point
5. run again

The loop repeats until the skill is crisp, or you learn it isn't valuable.

## Using it

Two harnesses are supported right now, [claude code](https://github.com/anthropics/claude-code) and [codex](https://github.com/openai/codex), so make sure the ones you'll use are installed. Either can fill any of the three roles in a benchmark: the orchestrator you open here, the executors that perform the runs, and the judge that grades them. Mixing is fine (claude orchestrating, codex executing), and so is running everything on one. Opening it up to opencode and other harnesses is planned.

```bash
git clone https://github.com/technophile-04/skill-eval-framework.git
cd skill-eval-framework
yarn install
claude   # or codex
```

Then tell it which skill to check:

```
I want to eval the skill at https://ethskills.com/gas/SKILL.md
```

Before anything runs, it interviews you. It reads `AGENTS.md`, drafts a task from the skill and shows it to you, then drafts the `expect:` lines and shows you those. The expect lines are the conditions the judge grades against, so this is the step worth slowing down on; they're the whole grading surface. Last it asks which executor to run and how many runs per variant. One question at a time, each with a recommended answer, so approving the whole thing takes a few words. Everything after that it does on its own.

When the benchmark is done, everything it produced is still on disk, so you can keep asking the orchestrator questions (which run spent more tokens, what the failing run actually wrote) instead of re-running anything.

## Layout

```
skill-eval-framework/
├─ AGENTS.md                     the rules; the orchestrator reads this first
├─ skills/                       vendored skill versions under test
├─ tasks/                        task specs, one yaml per task (filename = task id)
├─ scripts/setup-workspace.ts    seeds the clean workspace, hard-fails on grading leaks
├─ scripts/verify.ts             snapshots a finished run, spawns the judge
├─ lib/judge.ts                  the blind judge: evidence in, graded expects out
├─ artifacts/                    per run: result.yaml + run.diff + output/ committed,
│                                workspaces and transcripts gitignored
├─ mistakes/                     mistake records mined from failures
├─ reports/                      markdown comparisons per benchmark
└─ templates/                    workspace seeds (gitignored; tasks record how to regenerate)

# there is no runner. the orchestrator is
# whatever agent you happen to open here
```

## How it works

A benchmark is the same task run with the skill and without, a fresh executor per run, and raw pass counts per variant as the headline.

The orchestrating agent works from `AGENTS.md`, the full playbook including every record schema. Two small scripts guard the steps where improvisation would quietly corrupt results:

- `yarn setup` builds a clean workspace for one run: task prompt in, skill installed (or not), and a hard fail if any grading material would leak in. The isolation is load-bearing, not hygiene. An executor that knows how it's being judged starts acting smart, so it gets the task and nothing else.
- `yarn verify` grades a finished run: snapshots the output, has a blind LLM judge grade the task's `expect:` lines against it, and writes `result.yaml`. No judge is baked in; the orchestrator passes `--judge-agent` and `--judge-model`, and `result.yaml` records which judge graded which run.

Every run leaves three files behind: the diff of what the executor changed, its full transcript, and the graded `result.yaml`. The orchestrating agent never performs the task itself.

Executors are pluggable: `--executor claude` or `--executor codex`. Skills install at the cross-agent standard `.agents/skills/` (codex reads it natively; claude runs get a bridge copy at `.claude/skills/`).

Because the fixed part is this small, the orchestrator can bend the framework into shapes it wasn't written for, like comparing two similar skills from different developers.

## Running a benchmark

```bash
yarn setup --task tasks/<id>.yaml --variant no_skill --run 1 --executor claude
# spawn a fresh executor in the printed workspace (spawn commands in AGENTS.md)
yarn verify --run artifacts/<id>/<run-id> --judge-agent claude --judge-model <model>
```

Repeat per variant and run count, then compare `result.yaml`s and write the report. You don't normally type these; the orchestrator does. `AGENTS.md` has the full loop, the intake conversation, and the mistake-record format.
