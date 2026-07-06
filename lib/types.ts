export type Variant = "no_skill" | "with_skill";
export type Executor = "claude" | "codex";

export type TaskSpec = {
  id: string;
  skill: string;
  input: string;
  template?: string;
  verifier?: string;
  expect?: string[];
  runs: number;
  notes?: string;
};

export type AssertionStatus = "pass" | "fail";

export type ResultRecord = {
  task: string;
  run: string;
  executor: Executor;
  variant: Variant;
  skill_version: string | null;
  created: string;
  assertions?: Record<string, AssertionStatus>;
  expects?: Record<string, AssertionStatus>;
  pass?: boolean;
};

export type VerifierReport = {
  assertions: Record<string, AssertionStatus>;
};

export type Verifier = (workspacePath: string) => Promise<VerifierReport>;
