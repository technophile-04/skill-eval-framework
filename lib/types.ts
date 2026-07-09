export type Variant = "no_skill" | "with_skill";
export type Executor = "claude" | "codex";

export type TaskSpec = {
  id: string;
  skill: string;
  input: string;
  template?: string;
  expect: string[];
  runs: number;
  notes?: string;
};

export type ExpectStatus = "pass" | "fail";

export type JudgeSpec = {
  agent: Executor;
  model: string | null;
};

// self_judged: the agent that performed the run also graded it. Not fatal, but a
// model is a weak judge of its own mistakes — say so in the report.
export type JudgeRecord = JudgeSpec & {
  self_judged: boolean;
};

export type ResultRecord = {
  task: string;
  run: string;
  executor: Executor;
  variant: Variant;
  skill_version: string | null;
  created: string;
  judge?: JudgeRecord;
  expects?: Record<string, ExpectStatus>;
  pass?: boolean;
};
