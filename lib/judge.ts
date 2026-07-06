import { spawnSync } from "node:child_process";
import type { ExpectStatus } from "./types.js";

export type JudgeResult =
  | { ok: true; expects: Record<string, ExpectStatus> }
  | { ok: false; expects: Record<string, ExpectStatus>; error: string };

const JUDGE_TIMEOUT_MS = 120_000;

const failExpectations = (expectations: string[]) =>
  Object.fromEntries(expectations.map((_, index) => [`expect_${index + 1}`, "fail" as const]));

const parseVerdicts = (output: string, expectations: string[]): JudgeResult => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
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

export const judgeExpectations = (taskInput: string, expectations: string[], evidence: string): JudgeResult => {
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
  const args = [
    "-u",
    "ANTHROPIC_API_KEY",
    "-u",
    "ANTHROPIC_AUTH_TOKEN",
    "claude",
    "-p",
    prompt,
    "--model",
    "claude-opus-4-6",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
  ];
  const result = spawnSync("env", args, { encoding: "utf8", timeout: JUDGE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });

  if (result.error) {
    return { ok: false, expects: failExpectations(expectations), error: result.error.message };
  }

  if (result.status !== 0) {
    return { ok: false, expects: failExpectations(expectations), error: result.stderr.trim() || "judge exited non-zero" };
  }

  return parseVerdicts(result.stdout.trim(), expectations);
};
