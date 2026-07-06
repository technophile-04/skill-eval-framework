import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { TaskSpec } from "./types.js";

const TASK_FIELDS = new Set(["skill", "input", "template", "expect", "runs", "notes"]);
const REMOVED_TASK_FIELDS = new Set([
  "id",
  "domain",
  "workspace",
  "skill_source",
  "runs_per_variant",
  "verifier",
]);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const requireString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing required field: ${name}`);
  }

  return value;
};

export const requireNumber = (value: unknown, name: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`missing required numeric field: ${name}`);
  }

  return value;
};

export const loadYamlFile = (filePath: string) => {
  const loaded = yaml.load(readFileSync(filePath, "utf8"));

  if (!isRecord(loaded)) {
    throw new Error(`${filePath} must be a yaml mapping`);
  }

  return loaded;
};

export const parseArgs = (allowed: Set<string>) => {
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
    if (!allowed.has(key)) {
      throw new Error(`unknown argument: --${key}`);
    }
  }

  return parsed;
};

export const loadTaskSpec = (taskPath: string): TaskSpec => {
  const loaded = loadYamlFile(taskPath);

  for (const field of Object.keys(loaded)) {
    if (REMOVED_TASK_FIELDS.has(field)) {
      throw new Error(`${field} was removed from the task spec`);
    }

    if (!TASK_FIELDS.has(field)) {
      throw new Error(`unknown task spec field: ${field}`);
    }
  }

  const expect = loaded.expect;

  if (!Array.isArray(expect) || expect.length === 0 || expect.some(item => typeof item !== "string")) {
    throw new Error("task spec must define at least one expect line");
  }

  const spec: TaskSpec = {
    id: path.basename(taskPath, ".yaml"),
    skill: requireString(loaded.skill, "skill"),
    input: requireString(loaded.input, "input"),
    expect,
    runs: requireNumber(loaded.runs, "runs"),
  };

  if (loaded.template !== undefined) {
    spec.template = requireString(loaded.template, "template");
  }

  if (loaded.notes !== undefined) {
    spec.notes = requireString(loaded.notes, "notes");
  }

  return spec;
};
