import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import { judgeExpectations } from "../lib/judge.js";
import { isRecord, loadTaskSpec, loadYamlFile, parseArgs, requireString } from "../lib/task.js";
import type { Executor, ExpectStatus, JudgeSpec, ResultRecord, Variant } from "../lib/types.js";

const ROOT = process.cwd();
// Where setup installs the skill. Evidence that reaches the judge must exclude these, or the
// judge reads the skill itself and learns which variant produced the run. Both evidence paths
// (snapshot and diff) derive their exclusions from this list, so adding an executor's bridge
// dir here covers both; a dir listed in one path and missed in the other silently corrupts a
// benchmark, which is how the skill first leaked into run.diff.
const SKILL_INSTALL_DIRS = [".agents", ".claude"];
// Generated/vendored dirs a scaffolded repo (e.g. create-eth) leaves behind. The snapshot
// captures source the run produced, not gigabytes of node_modules or build output. Unlike
// SKILL_INSTALL_DIRS, missing one of these makes evidence noisy, never wrong.
const GENERATED_DIRS = [
  "node_modules", "lib", ".git", ".next", ".yarn", "dist", "build",
  "out", "cache", "broadcast", "coverage", ".turbo", ".husky", ".vscode",
];
const SKIP_DIRS = new Set([...SKILL_INSTALL_DIRS, ...GENERATED_DIRS]);
const MAX_SNAPSHOT_FILE_BYTES = 256 * 1024;
const EXECUTORS = new Set<Executor>(["claude", "codex"]);
const VARIANTS = new Set<Variant>(["no_skill", "with_skill"]);
const VERIFY_ARGS = new Set(["run", "judge-agent", "judge-model"]);

// The judge is a fresh, blind process, never the orchestrator's own contaminated
// context. Point it at the model you want doing the grading: pass --judge-agent
// and --judge-model to grade with the orchestrator's model. With neither, it falls
// back to the agent that performed the run, and the record marks that self_judged.
const resolveJudge = (args: Record<string, string | boolean>, executor: Executor): JudgeSpec => {
  const agent = args["judge-agent"] === undefined ? executor : parseAgent(requireString(args["judge-agent"], "--judge-agent"));
  const model = args["judge-model"] === undefined ? null : requireString(args["judge-model"], "--judge-model");

  return { agent, model };
};

const parseExecutor = (value: string): Executor => {
  if (!EXECUTORS.has(value as Executor)) {
    throw new Error(`unknown executor in result.yaml: ${value}`);
  }

  return value as Executor;
};

const parseAgent = (value: string): Executor => {
  if (!EXECUTORS.has(value as Executor)) {
    throw new Error(`unknown --judge-agent: ${value} (expected claude or codex)`);
  }

  return value as Executor;
};

const parseVariant = (value: string): Variant => {
  if (!VARIANTS.has(value as Variant)) {
    throw new Error(`unknown variant in result.yaml: ${value}`);
  }

  return value as Variant;
};

const readExpects = (value: unknown) => {
  if (!isRecord(value)) {
    throw new Error("expects must be a mapping");
  }

  const expects: Record<string, ExpectStatus> = {};

  for (const [name, status] of Object.entries(value)) {
    if (status !== "pass" && status !== "fail") {
      throw new Error(`expect ${name} must be pass or fail`);
    }

    expects[name] = status;
  }

  return expects;
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
    expects: loaded.expects === undefined ? undefined : readExpects(loaded.expects),
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
        if (!SKIP_DIRS.has(child.name)) {
          pending.push(fullPath);
        }
      } else if (child.isFile()) {
        entries.push(fullPath);
      }
    }
  }

  return entries;
};

const writeDiff = async (workspacePath: string, diffPath: string) => {
  const pathspec = [".", ...SKILL_INSTALL_DIRS.map(dir => `:(exclude)${dir}`)];

  // Intent-to-add so new (untracked) files show their content in the diff, not just a
  // filename in status — the judge needs to see files the run created. Honors .gitignore,
  // so node_modules and build output stay out. The installed skill is untracked and not
  // gitignored, so only the pathspec keeps it out of the judge's evidence.
  execFileSync("git", ["-C", workspacePath, "add", "-N", "--", ...pathspec], { encoding: "utf8" });
  const diff = execFileSync("git", ["-C", workspacePath, "diff", "--", ...pathspec], { encoding: "utf8" });
  const status = execFileSync("git", ["-C", workspacePath, "status", "--porcelain", "--", ...pathspec], { encoding: "utf8" });
  const content = `${diff}${diff.endsWith("\n") || diff.length === 0 ? "" : "\n"}\n# Untracked files and status\n${status}`;

  await writeFile(diffPath, content);
};

const snapshotOutput = async (workspacePath: string, outputPath: string) => {
  await rm(outputPath, { recursive: true, force: true });

  for (const file of await walkFiles(workspacePath)) {
    const relativePath = path.relative(workspacePath, file);
    const segments = relativePath.split(path.sep);

    if (relativePath === "TASK.md" || segments.some(segment => SKIP_DIRS.has(segment))) {
      continue;
    }

    // Backstop: a scaffold leaves big generated source too (lockfiles, bundled releases).
    // Grading reads answer/source files; anything this large is not that.
    if ((await stat(file)).size > MAX_SNAPSHOT_FILE_BYTES) {
      continue;
    }

    // Skip binary assets (favicons, fonts, images). The judge reads evidence as text, and a
    // NUL byte breaks the prompt arg; nothing gradeable lives in a binary anyway.
    if (readFileSync(file).includes(0)) {
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

const summarize = (expects: Record<string, ExpectStatus>) => {
  const rows = Object.entries(expects);
  const nameWidth = Math.max("check".length, ...rows.map(([name]) => name.length));

  console.log(`${"check".padEnd(nameWidth)}  status`);
  console.log(`${"-".repeat(nameWidth)}  ------`);

  for (const [name, status] of rows) {
    console.log(`${name.padEnd(nameWidth)}  ${status}`);
  }
};

const main = async () => {
  try {
    const args = parseArgs(VERIFY_ARGS);
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

    const judgeSpec = resolveJudge(args, result.executor);
    const verdict = judgeExpectations(taskSpec.input, taskSpec.expect, await buildEvidence(runDir), judgeSpec);

    if (!verdict.ok) {
      throw new Error(`judge failed: ${verdict.error}`);
    }

    const pass = Object.values(verdict.expects).every(status => status === "pass");
    // Rebuilt field by field rather than spread: loadResultRecord leaves `expects` and
    // `pass` as undefined keys, so spreading would strand `judge` below them in the yaml.
    const gradedResult: ResultRecord = {
      task: result.task,
      run: result.run,
      executor: result.executor,
      variant: result.variant,
      skill_version: result.skill_version,
      created: result.created,
      judge: { ...judgeSpec, self_judged: judgeSpec.agent === result.executor },
      expects: verdict.expects,
      pass,
    };

    await writeFile(resultPath, yaml.dump(gradedResult, { lineWidth: -1 }));
    summarize(verdict.expects);
    process.exit(pass ? 0 : 2);
  } catch (error) {
    console.error(`verify: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

await main();
