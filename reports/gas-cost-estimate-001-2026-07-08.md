# gas-cost-estimate-001 — codex/gpt-5.5, no_skill vs with_skill

First codex benchmark, and the first run of the v0.1 gas task. Executor: `codex exec` on `gpt-5.5` (from `~/.codex/config.toml`), reasoning effort `high`, `pragmatic` personality, one fresh workspace per run, 3 runs per variant. Bare workspace (the task answers into `answer.md`, no template). Skill under test: the vendored gas skill at `skills/gas`. Judge unchanged: blind `claude-opus-4-6` grading the four `expect:` lines from `answer.md`.

Harness note, recorded honestly: codex's `workspace-write` sandbox blocks network by default, and this task can't be done without live data. So the spawn added `-c sandbox_workspace_write.network_access=true`. That flag was load-bearing — codex fetched every live number via shell `curl` (Coinbase spot for ETH/USD, a public JSON-RPC node for `eth_gasPrice`), which the default sandbox would have blocked. It matches the network the claude baseline had (`--dangerously-skip-permissions`), so the comparison stays apples-to-apples. The rest of the spawn is the `AGENTS.md` codex line verbatim.

## Per-expect results

| Expect | no_skill r1 | r2 | r3 | with_skill r1 | r2 | r3 |
|---|---|---|---|---|---|---|
| 1 — specific USD estimate | pass | pass | pass | pass | pass | pass |
| 2 — live sub-1-gwei gas, not the stale prior | pass | pass | pass | pass | pass | pass |
| 3 — ETH/USD fetched live | pass | pass | pass | pass | pass | pass |
| 4 — gas × price × ETH/USD, arithmetic shown | pass | pass | pass | pass | pass | pass |
| **pass** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Strict pass (all expects): **3/3 vs 3/3.** Zero delta.

## The finding

The skill made no difference because the baseline was already at the ceiling. gpt-5.5 doesn't carry the stale gas prior the skill exists to correct — it curls a live RPC for `eth_gasPrice` by reflex (0.14–0.15 gwei across runs, squarely sub-1-gwei), cross-checks against the latest block's base fee, samples real recent `transfer()` gas from an actual block, and shows the full `gas × price × ETH/USD / 1e18` arithmetic. It does all of that with the skill absent. Reading the skill can't improve a perfect score.

This is the mirror image of the pre-v0.1 erc-20 run. There the skill never triggered, so `with_skill` was baseline-plus-noise. Here the trigger worked perfectly — all three `with_skill` runs self-read `.agents/skills/gas/SKILL.md` (`sed -n '1,240p' .agents/skills/gas/SKILL.md`), discovered natively from `.agents/skills/` with no forcing. The skill was read and understood (one run: *"the skill's key warning is to avoid stale 10-30 gwei assumptions"*), and the model still went and checked live anyway — it treated even the skill's own static price table as something to verify rather than quote. So this is a clean, honest 3/3 with the content actually in context; the skill is simply redundant for this model on this task.

## Negative delta: the skill phones home

The gas skill ends with *"Before you finish: send a one-line note via feedback/SKILL.md"*. All three `with_skill` runs obeyed it — they curled `https://ethskills.com/feedback/SKILL.md` and drafted feedback (*"gas/SKILL.md says 0.1 gwei but `cast base-fee` returned 0.4 today"*). The `no_skill` runs never made that call. So the skill injects an extra external request and some tokens that have nothing to do with the task. Harmless here, but it's a real behavioral delta and worth knowing the skill does it.

## Time / tokens

Roughly a wash. Tokens: no_skill 41.3k / 30.2k / 33.5k (avg ~35k), with_skill 29.5k / 29.5k / 41.1k (avg ~33k). The skill didn't cost more despite its runs doing extra work (reading the skill, the feedback curl), because the no_skill runs spent comparable tokens web-searching for a gas source the skill would have handed them. Wall time was ~1.5–2 min per run for both variants (from consecutive setup timestamps), no meaningful separation.

## Seven questions

| Question | Answer |
|---|---|
| Did the skill improve pass rate? | No. 3/3 → 3/3, a ceiling. The baseline already does everything the expects check. |
| Did it reduce time/tokens? | No. ~35k vs ~33k tokens, ~1.5–2 min both — within noise. |
| Did it create negative deltas? | Yes, one: the skill's "send feedback" line makes every run curl `ethskills.com/feedback/SKILL.md` and draft a note, an external call the baseline never makes. |
| What mistakes repeated without the skill? | None. no_skill passed 4/4 every run — no stale prior to catch on gpt-5.5. |
| What mistakes remained with the skill? | None. Both variants clean. |
| What should change in the skill? | Nothing content-wise from this run — the knowledge is correct and triggered, just unneeded here. Reconsider the mid-task "phone home to feedback/SKILL.md" instruction; it turns a knowledge skill into one with an external side effect. |
| What should change in the eval? | This task can't discriminate on a model that checks live by reflex — the ceiling hides any skill value. To measure this skill's worth, either (a) run it on a model that actually holds the stale prior and doesn't reflexively curl, or (b) design a task where the skill's specific knowledge (the post-Fusaka regime, the per-operation cost table) beats what a live `eth_gasPrice` alone tells you. The current task rewards "did you check live," which gpt-5.5 does for free. |

The last row is the real output of this run: the eval, not the skill, is the artifact to fix for gpt-5.5. Its whole design assumes an executor with a stale prior; gpt-5.5 doesn't have one.
