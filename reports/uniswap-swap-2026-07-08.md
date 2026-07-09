# uniswap-swap — bare vs SE-2 docs vs ethskills (codex/gpt-5.5)

A three-arm A/B, not a with/without run: same task, same bare workspace, same four blind-judged criteria — the only variable is which SKILL.md url the prompt tells the agent to follow. The question is whether a knowledge layer (ethskills) or a scaffold-procedure skill (SE-2 docs) makes a better app than a smart agent told to build one with no skill at all.

| Arm | Prompt names | Task file |
| --- | --- | --- |
| bare | no skill url | `uniswap-swap-bare-001` |
| se2docs | `docs.scaffoldeth.io/SKILL.md` (procedural bootstrapper) | `uniswap-swap-se2docs-001` |
| ethskills | `ethskills.com/SKILL.md` (knowledge index) | `uniswap-swap-ethskills-001` |

Executor: `codex exec` on `gpt-5.5`, effort `high`, one run per arm. Bare workspace, no template — each arm scaffolds SE-2 itself (`npx create-eth`). Sandbox `workspace-write` with network enabled (same as the gas run; the agents `curl` and scaffold live). Judge: blind `claude-opus-4-6`, grading four code-inspection criteria from the snapshotted source. The app is USDC→WETH on mainnet, chosen so every criterion has to show up: USDC needs an approve (allowance UX), USDC is 6 decimals (the decimals trap), a real swap needs canonical addresses and a slippage bound. 1 run each = directional, not conclusive.

## Result: a three-way tie at the floor

| Expect | bare | se2docs | ethskills |
| --- | --- | --- | --- |
| 1 — canonical mainnet addresses, no hallucination | pass | pass | pass |
| 2 — approve/allowance flow, only when needed, with pending state | pass | pass | pass |
| 3 — real decimals (USDC 6, not 18) | pass | pass | pass |
| 4 — non-zero min-out / slippage bound | pass | pass | pass |
| **pass** | 4/4 | 4/4 | 4/4 |

Every arm cleared every criterion. On gpt-5.5, the correctness floor this rubric measures is free — the bare agent gets canonical addresses, an allowance-gated approve button, per-token decimals, and a slippage bound without any skill. Same ceiling effect the gas task hit: when the baseline is already at the top, neither skill can move the score.

## What the tie hides

A 4/4 tie is not three equal apps — it's a rubric that only sees the floor. The arms diverge above it, and the divergence is monotonic with how much knowledge the prompt pointed at:

- **Router choice.** bare used the older V3 `SwapRouter` (`0xE592…1564`, still carries a `deadline` param); both skill arms used the modern `SwapRouter02` (`0x68b3…Fc45`). Not graded, but the skill arms picked the current contract.
- **Implementation depth.** The swap page grew bare 346 → se2docs 424 → ethskills 542 lines. The ethskills arm added configurable slippage tiers (0.25/0.5/1%), a QuoterV2 integration for live quotes, and per-token allowance reads via Scaffold hooks — all things the rubric's four lines don't ask for.
- **No custom contract anywhere.** A swap UI calls Uniswap directly, so none of the three wrote a meaningful `.sol` contract (only create-eth's boilerplate + a deploy script). The audit dimension has nothing to bite on here — it needs its own task with a real contract, which is the next thing to build.

Whether "more lines + more tiers" is better UX or gold-plating is exactly the question this code-inspection rubric can't answer. That's a live-UX/browser pass (v2), not a text judge.

## Harness note: what a repo-shaped task broke

The gas task hid a pile of assumptions because its output was one text file. The first repo-shaped task surfaced them, and grading needed five fixes (all committed with this run):

1. `create-eth` skips its own `git init` when the workspace sits inside a parent repo, so `verify` never sees a `workspace/.git` and falls to the snapshot path rather than a clean diff.
2. The snapshot only excluded *top-level* `node_modules`. Now it prunes generated/vendored dirs at any depth — including Foundry's `lib/` (the OpenZeppelin + forge-std repos), which is `node_modules` for Solidity and was the single biggest source of bloat (2.1 GB → ~0.5 MB of source).
3. A file-size backstop, and skipping binary assets (favicons, fonts) whose NUL bytes broke the judge prompt.
4. The judge passed evidence as an argv string — repo evidence blew past the OS argv limit (E2BIG). It now goes in on stdin.
5. The judge occasionally wraps its JSON in a fence or a line of preamble; the parser now extracts the JSON object instead of demanding a bare one.

None of these touch grading logic — they're about capturing the right bytes and getting them to the judge. But they're the difference between this task shape working and not.

## Seven questions

| Question | Answer |
| --- | --- |
| Did the skill improve pass rate? | No. 4/4 across all three arms. The rubric's floor is free on gpt-5.5. |
| Did it reduce time/tokens? | No — the opposite direction. More knowledge, more elaborate build (346 → 424 → 542 lines of swap UI); the ethskills arm did the most work. |
| Did it create negative deltas? | No functional regressions. The only cost is extra elaboration (slippage tiers, quoter) that may be gold-plating for an MVP. |
| What mistakes repeated without the skill? | None the rubric caught. bare's one soft miss: it reached for the older V3 router instead of SwapRouter02. |
| What mistakes remained with the skill? | None. |
| What should change in the skill? | Nothing provable here — this task can't separate the arms. The comparison the skills are actually for (address correctness at scale, UX quality, audit depth) needs tasks that discriminate above the floor. |
| What should change in the eval? | The real work. (1) A live-UX pass (run the app, browser-drive the approve→swap flow, screenshot states) — the only way to grade "is the UI actually good," which is half of what these skills claim. (2) A dedicated audit task: hand all arms the *same* planted-vulnerability contract and score found-vs-missed, isolating whether the audit skill beats a smart agent just asked to audit. (3) Consider a weaker executor where the correctness floor isn't free — on gpt-5.5 it is, so this task measures the model, not the skill. |

The honest read: on gpt-5.5 this task confirms the hypothesis you started with — a capable agent told to build an SE-2 swap app already gets the fundamentals right, skill or no skill. What the skills change is depth, not correctness. To find where a knowledge layer actually pays, the eval has to look above the floor — live UX and real audit — which is the next build, not this one.
