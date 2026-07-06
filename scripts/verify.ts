import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import { judgeExpectations } from "../lib/judge.js";
import type { AssertionStatus, Executor, ResultRecord, TaskSpec, Variant, Verifier, VerifierReport } from "../lib/types.js";

const ROOT = process.cwd();
const EXECUTORS = new Set<Executor>(["claude", "codex"]);
const VARIANTS = new Set<Variant>(["no_skill", "with_skill"]);
const VERIFY_ARGS = new Set(["run"]);
const TASK_FIELDS = new Set(["skill", "input", "template", "verifier", "expect", "runs", "notes"]);
const REMOVED_TASK_FIELDS = new Set(["id", "domain", "workspace", "skill_source", "runs_per_variant"]);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = args[i + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    i++;
  }

  for (const key of Object.keys(parsed)) {
    if (!VERIFY_ARGS.has(key)) {
      throw new Error(`unknown argument: --${key}`);
    }
  }

  return parsed;
};

const requireString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing required field: ${name}`);
  }

  return value;
};

const requireNumber = (value: unknown, name: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`missing required numeric field: ${name}`);
  }

  return value;
};

const optionalStringArray = (value: unknown, name: string) => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new Error(`${name} must be a string array when present`);
  }

  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const loadYamlFile = (filePath: string) => {
  const loaded = yaml.load(readFileSync(filePath, "utf8"));

  if (!isRecord(loaded)) {
    throw new Error(`${filePath} must be a yaml mapping`);
  }

  return loaded;
};

const loadTaskSpec = (taskPath: string): TaskSpec => {
  const loaded = loadYamlFile(taskPath);

  for (const field of Object.keys(loaded)) {
    if (REMOVED_TASK_FIELDS.has(field)) {
      throw new Error(`${field} was removed in v0.1`);
    }

    if (!TASK_FIELDS.has(field)) {
      throw new Error(`unknown task spec field: ${field}`);
    }
  }

  const spec: TaskSpec = {
    id: path.basename(taskPath, ".yaml"),
    skill: requireString(loaded.skill, "skill"),
    input: requireString(loaded.input, "input"),
    runs: requireNumber(loaded.runs, "runs"),
  };

  if (loaded.verifier !== undefined) {
    spec.verifier = requireString(loaded.verifier, "verifier");
  }

  const expect = optionalStringArray(loaded.expect, "expect");

  if (expect !== undefined) {
    spec.expect = expect;
  }

  if (spec.verifier === undefined && (expect === undefined || expect.length === 0)) {
    throw new Error("task spec must define verifier or at least one expect");
  }

  if (loaded.template !== undefined) {
    spec.template = requireString(loaded.template, "template");
  }

  if (loaded.notes !== undefined) {
    spec.notes = requireString(loaded.notes, "notes");
  }

  return spec;
};

const parseExecutor = (value: string): Executor => {
  if (!EXECUTORS.has(value as Executor)) {
    throw new Error(`unknown executor in result.yaml: ${value}`);
  }

  return value as Executor;
};

const parseVariant = (value: string): Variant => {
  if (!VARIANTS.has(value as Variant)) {
    throw new Error(`unknown variant in result.yaml: ${value}`);
  }

  return value as Variant;
};

const loadResultRecord = (resultPath: string): ResultRecord => {
  const loaded = loadYamlFile(resultPath);

  return {
    task: requireString(loaded.task, "task"),
    run: requireString(loaded.run, "run"),
    executor: parseExecutor(requireString(loaded.executor, "executor")),
    variant: parseVariant(requireString(loaded.variant, "variant")),
    skill_version: loaded.skill_version === null ? null : requireString(loaded.skill_version, "skill_version"),
    created: requireString(loaded.created, "created"),
    assertions: loaded.assertions === undefined ? undefined : readAssertions(loaded.assertions),
    expects: loaded.expects === undefined ? undefined : readAssertions(loaded.expects),
    pass: loaded.pass === undefined ? undefined : Boolean(loaded.pass),
  };
};

const walkFiles = async (dir: string) => {
  const entries: string[] = [];
  const pending = [dir];

  while (pending.length > 0) {
    const current = pending.pop() as string;
    const childNames = await readdir(current, { withFileTypes: true });

    for (const child of childNames) {
      const fullPath = path.join(current, child.name);

      if (child.isDirectory()) {
        pending.push(fullPath);
      } else if (child.isFile()) {
        entries.push(fullPath);
      }
    }
  }

  return entries;
};

const writeDiff = async (workspacePath: string, diffPath: string) => {
  const diff = execFileSync("git", ["-C", workspacePath, "diff"], { encoding: "utf8" });
  const status = execFileSync("git", ["-C", workspacePath, "status", "--porcelain"], { encoding: "utf8" });
  const content = `${diff}${diff.endsWith("\n") || diff.length === 0 ? "" : "\n"}\n# Untracked files and status\n${status}`;

  await writeFile(diffPath, content);
  return content;
};

const snapshotOutput = async (workspacePath: string, outputPath: string) => {
  await rm(outputPath, { recursive: true, force: true });

  for (const file of await walkFiles(workspacePath)) {
    const relativePath = path.relative(workspacePath, file);
    const segments = relativePath.split(path.sep);

    if (
      relativePath === "TASK.md" ||
      segments[0] === ".agents" ||
      segments[0] === ".claude" ||
      segments[0] === "node_modules"
    ) {
      continue;
    }

    const target = path.join(outputPath, relativePath);

    await mkdir(path.dirname(target), { recursive: true });
    await cp(file, target);
  }
};

const buildEvidence = async (runDir: string) => {
  const sections: string[] = [];
  const diffPath = path.join(runDir, "run.diff");
  const outputPath = path.join(runDir, "output");

  if (existsSync(diffPath)) {
    sections.push(["# run.diff", readFileSync(diffPath, "utf8")].join("\n"));
  }

  if (existsSync(outputPath)) {
    for (const file of await walkFiles(outputPath)) {
      const relativePath = path.relative(outputPath, file);

      sections.push([`# output/${relativePath}`, readFileSync(file, "utf8")].join("\n"));
    }
  }

  return sections.join("\n\n");
};

const readAssertions = (value: unknown) => {
  if (!isRecord(value)) {
    throw new Error("assertions must be a mapping");
  }

  const assertions: Record<string, AssertionStatus> = {};

  for (const [name, status] of Object.entries(value)) {
    if (status !== "pass" && status !== "fail") {
      throw new Error(`verifier assertion ${name} must be pass or fail`);
    }

    assertions[name] = status;
  }

  return assertions;
};

const validateVerifierReport = (report: VerifierReport) => {
  if (!isRecord(report) || !isRecord(report.assertions)) {
    throw new Error("verifier must return an assertions mapping");
  }

  const assertions = readAssertions(report.assertions);

  if (Object.keys(assertions).length === 0) {
    throw new Error("verifier must return at least one assertion");
  }

  return assertions;
};

const summarize = (
  assertions: Record<string, AssertionStatus>,
  expects: Record<string, AssertionStatus>,
) => {
  const rows = [...Object.entries(assertions), ...Object.entries(expects)];
  const nameWidth = Math.max("check".length, ...rows.map(([name]) => name.length));

  console.log(`${"check".padEnd(nameWidth)}  status`);
  console.log(`${"-".repeat(nameWidth)}  ------`);

  for (const [name, status] of rows) {
    console.log(`${name.padEnd(nameWidth)}  ${status}`);
  }
};

const main = async () => {
  try {
    const args = parseArgs();
    const runArg = requireString(args.run, "--run");
    const runDir = path.resolve(ROOT, runArg);
    const resultPath = path.join(runDir, "result.yaml");

    if (!existsSync(resultPath)) {
      throw new Error(`missing result.yaml at ${resultPath}`);
    }

    const rawResult = loadYamlFile(resultPath);

    if (Object.prototype.hasOwnProperty.call(rawResult, "pass")) {
      throw new Error(`run already graded; delete ${runDir} and re-run setup-workspace if you need a redo`);
    }

    const result = loadResultRecord(resultPath);
    const taskSpec = loadTaskSpec(path.join(ROOT, "tasks", `${result.task}.yaml`));
    const workspacePath = path.join(runDir, "workspace");

    if (existsSync(path.join(workspacePath, ".git"))) {
      await writeDiff(workspacePath, path.join(runDir, "run.diff"));
    } else {
      await snapshotOutput(workspacePath, path.join(runDir, "output"));
    }

    const assertions: Record<string, AssertionStatus> = {};

    if (taskSpec.verifier !== undefined) {
      const verifierPath = path.resolve(ROOT, taskSpec.verifier);
      const imported = (await import(pathToFileURL(verifierPath).href)) as { default?: Verifier };

      if (typeof imported.default !== "function") {
        throw new Error(`verifier ${taskSpec.verifier} must default-export a function`);
      }

      Object.assign(assertions, validateVerifierReport(await imported.default(path.resolve(workspacePath))));
    }

    const expectations = taskSpec.expect ?? [];
    const judge = expectations.length > 0 ? judgeExpectations(taskSpec.input, expectations, await buildEvidence(runDir)) : null;

    if (judge?.ok === false) {
      throw new Error(`judge failed: ${judge.error}`);
    }

    const expects = judge?.expects ?? {};
    const pass = [...Object.values(assertions), ...Object.values(expects)].every(status => status === "pass");
    const gradedResult: ResultRecord = {
      ...result,
      assertions,
      expects,
      pass,
    };

    await writeFile(resultPath, yaml.dump(gradedResult, { lineWidth: -1 }));
    summarize(assertions, expects);
    process.exit(pass ? 0 : 2);
  } catch (error) {
    console.error(`verify: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

await main();
