import { execFileSync, spawnSync } from "node:child_process";
import { constants, existsSync, readFileSync } from "node:fs";
import { access, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import { loadTaskSpec, parseArgs, requireString } from "../lib/task.js";
import type { Executor, ResultRecord, Variant } from "../lib/types.js";

const ROOT = process.cwd();
const EXECUTORS = new Set<Executor>(["claude", "codex"]);
const VARIANTS = new Set<Variant>(["no_skill", "with_skill"]);
const SETUP_ARGS = new Set(["task", "executor", "variant", "run"]);

const fail = async (message: string, runDir?: string): Promise<never> => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
  }

  console.error(`setup-workspace: ${message}`);
  process.exit(1);
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

// The task yaml carries the expect lines, i.e. the grading. It must never
// reach the executor's workspace in any form.
const guardAgainstLeaks = async (workspacePath: string, taskPath: string, runDir: string) => {
  const taskSpecBytes = readFileSync(taskPath);

  for (const file of await walkFiles(workspacePath)) {
    const bytes = readFileSync(file);

    if (bytes.length === taskSpecBytes.length && bytes.equals(taskSpecBytes)) {
      const relativePath = path.relative(workspacePath, file);

      await fail(`leak detected: workspace contains a copy of the task spec at ${relativePath}`, runDir);
    }
  }
};

const main = async () => {
  try {
    const args = parseArgs(SETUP_ARGS);
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

      await guardAgainstLeaks(workspacePath, taskPath, runDir);

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
