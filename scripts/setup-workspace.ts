import { execFileSync, spawnSync } from "node:child_process";
import { constants, existsSync, readFileSync } from "node:fs";
import { access, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import type { Executor, ResultRecord, TaskSpec, Variant } from "../lib/types.js";

const ROOT = process.cwd();
const EXECUTORS = new Set<Executor>(["claude", "codex"]);
const VARIANTS = new Set<Variant>(["no_skill", "with_skill"]);
const SETUP_ARGS = new Set(["task", "executor", "variant", "run"]);
const TASK_FIELDS = new Set(["skill", "input", "template", "verifier", "expect", "runs", "notes"]);
const REMOVED_TASK_FIELDS = new Set(["id", "domain", "workspace", "skill_source", "runs_per_variant"]);

const fail = async (message: string, runDir?: string): Promise<never> => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
  }

  console.error(`setup-workspace: ${message}`);
  process.exit(1);
};

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
    if (!SETUP_ARGS.has(key)) {
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

const loadTaskSpec = (taskPath: string): TaskSpec => {
  const loaded = yaml.load(readFileSync(taskPath, "utf8"));

  if (!isRecord(loaded)) {
    throw new Error("task spec must be a yaml mapping");
  }

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
    throw new Error(`unknown executor: ${value}`);
  }

  return value as Executor;
};

const parseVariant = (value: string): Variant => {
  if (!VARIANTS.has(value as Variant)) {
    throw new Error(`unknown variant: ${value}`);
  }

  return value as Variant;
};

const utcRunTimestamp = (date: Date) =>
  date.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "");

const copyDirContents = async (sourceDir: string, targetDir: string) => {
  await access(sourceDir, constants.R_OK);
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
};

const resolveRootPath = (value: string) => path.resolve(ROOT, value);

const findGitRoot = (dir: string) => {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
};

const getSkillVersion = (sourceDir: string) => {
  const gitRoot = findGitRoot(sourceDir);

  if (!gitRoot) {
    return "unversioned";
  }

  return execFileSync("git", ["-C", sourceDir, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
};

const copySkill = async (sourceDir: string, destination: string) => {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(sourceDir, destination, { recursive: true, force: true });
};

const installSkill = async (sourceDir: string, skillName: string, executor: Executor, workspacePath: string) => {
  const agentsDestination = path.join(workspacePath, ".agents", "skills", skillName);

  await access(sourceDir, constants.R_OK);
  await copySkill(sourceDir, agentsDestination);

  if (executor === "claude") {
    await copySkill(sourceDir, path.join(workspacePath, ".claude", "skills", skillName));
  }
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

const guardAgainstLeaks = async (
  workspacePath: string,
  taskPath: string,
  verifierFile: string | undefined,
  runDir: string,
) => {
  const verifierBasename = verifierFile === undefined ? null : path.basename(verifierFile);
  const taskSpecBytes = readFileSync(taskPath);
  const workspaceFiles = await walkFiles(workspacePath);

  for (const file of workspaceFiles) {
    const relativePath = path.relative(workspacePath, file);
    const segments = relativePath.split(path.sep);

    if (segments.includes("verifiers")) {
      await fail(`leak detected: workspace contains verifiers/ segment at ${relativePath}`, runDir);
    }

    if (verifierBasename !== null && path.basename(file) === verifierBasename) {
      await fail(`leak detected: workspace contains verifier filename ${relativePath}`, runDir);
    }

    const bytes = readFileSync(file);

    if (bytes.length === taskSpecBytes.length && bytes.equals(taskSpecBytes)) {
      await fail(`leak detected: workspace contains a copy of the task spec at ${relativePath}`, runDir);
    }
  }
};

const main = async () => {
  try {
    const args = parseArgs();
    const taskArg = requireString(args.task, "--task");
    const executor = parseExecutor(requireString(args.executor, "--executor"));
    const variant = parseVariant(requireString(args.variant, "--variant"));
    const run = requireString(args.run, "--run");
    const taskPath = resolveRootPath(taskArg);
    const spec = loadTaskSpec(taskPath);
    const timestamp = utcRunTimestamp(new Date());
    const runId = `${timestamp}-${executor}-${variant.replaceAll("_", "-")}-${run}`;
    const runDir = path.join(ROOT, "artifacts", spec.id, runId);
    const workspacePath = path.join(runDir, "workspace");

    if (existsSync(runDir)) {
      await fail(`run dir already exists: ${runDir}`);
    }

    await mkdir(runDir, { recursive: true });

    try {
      if (spec.template !== undefined) {
        await copyDirContents(resolveRootPath(spec.template), workspacePath);
      } else {
        await mkdir(workspacePath, { recursive: true });
      }

      await writeFile(path.join(workspacePath, "TASK.md"), spec.input);

      const skillSource = variant === "with_skill" ? resolveRootPath(spec.skill) : null;
      const skillVersion = skillSource ? getSkillVersion(skillSource) : null;

      if (skillSource) {
        await installSkill(skillSource, path.basename(skillSource), executor, workspacePath);
      }

      await guardAgainstLeaks(workspacePath, taskPath, spec.verifier, runDir);

      const result: ResultRecord = {
        task: spec.id,
        run: runId,
        executor,
        variant,
        skill_version: skillVersion,
        created: new Date().toISOString(),
      };

      await writeFile(path.join(runDir, "result.yaml"), yaml.dump(result, { lineWidth: -1 }));

      console.log(path.resolve(workspacePath));
      console.log("Spawn a fresh executor in this directory and point it only at TASK.md.");
    } catch (error) {
      await fail(error instanceof Error ? error.message : String(error), runDir);
    }
  } catch (error) {
    console.error(`setup-workspace: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

await main();
