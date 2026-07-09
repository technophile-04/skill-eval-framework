import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Executor, ExpectStatus, JudgeSpec } from "./types.js";

export type JudgeResult =
  | { ok: true; expects: Record<string, ExpectStatus> }
  | { ok: false; expects: Record<string, ExpectStatus>; error: string };

const JUDGE_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const failExpectations = (expectations: string[]) =>
  Object.fromEntries(expectations.map((_, index) => [`expect_${index + 1}`, "fail" as const]));

// Agents wrap their answer in prose or fences however they like. Grab the outermost
// JSON object rather than demanding the whole stdout parse.
const extractJson = (output: string) => {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");

  return start === -1 || end <= start ? null : output.slice(start, end + 1);
};

const parseVerdicts = (output: string, expectations: string[]): JudgeResult => {
  const json = extractJson(output);

  if (!json) {
    return { ok: false, expects: failExpectations(expectations), error: "judge output contained no JSON object" };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, expects: failExpectations(expectations), error: "judge output was not strict JSON" };
  }

  const verdicts = parsed && typeof parsed === "object" ? (parsed as { verdicts?: unknown }).verdicts : undefined;

  if (!Array.isArray(verdicts)) {
    return { ok: false, expects: failExpectations(expectations), error: "judge output missing verdicts array" };
  }

  const expects: Record<string, ExpectStatus> = {};

  for (let index = 0; index < expectations.length; index++) {
    const condition = index + 1;
    const verdict = verdicts.find(
      item => item && typeof item === "object" && (item as { condition?: unknown }).condition === condition,
    );
    const passed = verdict && typeof verdict === "object" ? (verdict as { pass?: unknown }).pass : undefined;

    if (typeof passed !== "boolean") {
      return { ok: false, expects: failExpectations(expectations), error: `judge output missing condition ${condition}` };
    }

    expects[`expect_${condition}`] = passed ? "pass" : "fail";
  }

  return { ok: true, expects };
};

type Spawned = { ok: true; output: string } | { ok: false; error: string };

// `claude -p` prints the final message to stdout. Both auth env vars are unset so a
// stray key can't silently swap the account the judge grades under. The prompt goes in
// on stdin, not argv: repo-shaped runs assemble evidence far larger than the OS argv
// limit (E2BIG), and `-p` with no positional prompt reads it from stdin.
const runClaudeJudge = (prompt: string, model: string | null): Spawned => {
  const args = ["-u", "ANTHROPIC_API_KEY", "-u", "ANTHROPIC_AUTH_TOKEN", "claude", "-p"];

  if (model) {
    args.push("--model", model);
  }

  args.push("--setting-sources", "project", "--strict-mcp-config");

  const result = spawnSync("env", args, {
    input: prompt,
    encoding: "utf8",
    timeout: JUDGE_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  if (result.status !== 0) {
    return { ok: false, error: result.stderr.trim() || "judge exited non-zero" };
  }

  return { ok: true, output: result.stdout };
};

// `codex exec` interleaves session logging with the answer on stdout, so take the
// final message from --output-last-message instead. read-only: the judge reads
// evidence, it never edits a workspace. `-` for the prompt reads it from stdin, keeping
// repo-shaped evidence off argv (E2BIG).
const runCodexJudge = (prompt: string, model: string | null): Spawned => {
  const dir = mkdtempSync(path.join(tmpdir(), "skill-eval-judge-"));
  const messagePath = path.join(dir, "last-message.txt");
  const args = ["exec", "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "-o", messagePath];

  if (model) {
    args.push("-m", model);
  }

  args.push("-");

  try {
    const result = spawnSync("codex", args, {
      input: prompt,
      encoding: "utf8",
      timeout: JUDGE_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    if (result.error) {
      return { ok: false, error: result.error.message };
    }

    if (result.status !== 0) {
      return { ok: false, error: result.stderr.trim() || "judge exited non-zero" };
    }

    return { ok: true, output: readFileSync(messagePath, "utf8") };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const JUDGE_RUNNERS: Record<Executor, (prompt: string, model: string | null) => Spawned> = {
  claude: runClaudeJudge,
  codex: runCodexJudge,
};

export const judgeExpectations = (
  taskInput: string,
  expectations: string[],
  evidence: string,
  judge: JudgeSpec,
): JudgeResult => {
  const prompt = [
    "You are grading a coding-agent run. You are blind to the variant and skill.",
    "Decide whether each numbered condition is satisfied by the evidence for the task.",
    'Return only strict JSON: {"verdicts":[{"condition":1,"pass":true,"reason":"..."}]}',
    "",
    "TASK:",
    taskInput,
    "",
    "EVIDENCE:",
    evidence,
    "",
    "EXPECT CONDITIONS:",
    ...expectations.map((condition, index) => `${index + 1}. ${condition}`),
  ].join("\n");

  const spawned = JUDGE_RUNNERS[judge.agent](prompt, judge.model);

  if (!spawned.ok) {
    return { ok: false, expects: failExpectations(expectations), error: spawned.error };
  }

  return parseVerdicts(spawned.output.trim(), expectations);
};
