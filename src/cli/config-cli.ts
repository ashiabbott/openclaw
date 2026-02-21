import type { Command } from "commander";
import JSON5 from "json5";
import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import {
  buildModelAliasIndex,
  modelKey,
  parseModelRef,
  resolveModelRefFromString,
} from "../agents/model-selection.js";
import type { OpenClawConfig } from "../config/config.js";
import { readConfigFileSnapshot, writeConfigFile } from "../config/config.js";
import { danger, info } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";

type PathSegment = string;
type ConfigSetParseOpts = {
  strictJson?: boolean;
};

function isIndexSegment(raw: string): boolean {
  return /^[0-9]+$/.test(raw);
}

function parsePath(raw: string): PathSegment[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  const parts: string[] = [];
  let current = "";
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === "\\") {
      const next = trimmed[i + 1];
      if (next) {
        current += next;
      }
      i += 2;
      continue;
    }
    if (ch === ".") {
      if (current) {
        parts.push(current);
      }
      current = "";
      i += 1;
      continue;
    }
    if (ch === "[") {
      if (current) {
        parts.push(current);
      }
      current = "";
      const close = trimmed.indexOf("]", i);
      if (close === -1) {
        throw new Error(`Invalid path (missing "]"): ${raw}`);
      }
      const inside = trimmed.slice(i + 1, close).trim();
      if (!inside) {
        throw new Error(`Invalid path (empty "[]"): ${raw}`);
      }
      parts.push(inside);
      i = close + 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current) {
    parts.push(current);
  }
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseValue(raw: string, opts: ConfigSetParseOpts): unknown {
  const trimmed = raw.trim();
  if (opts.strictJson) {
    try {
      return JSON5.parse(trimmed);
    } catch (err) {
      throw new Error(`Failed to parse JSON5 value: ${String(err)}`, { cause: err });
    }
  }

  try {
    return JSON5.parse(trimmed);
  } catch {
    return raw;
  }
}

function getAtPath(root: unknown, path: PathSegment[]): { found: boolean; value?: unknown } {
  let current: unknown = root;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return { found: false };
    }
    if (Array.isArray(current)) {
      if (!isIndexSegment(segment)) {
        return { found: false };
      }
      const index = Number.parseInt(segment, 10);
      if (!Number.isFinite(index) || index < 0 || index >= current.length) {
        return { found: false };
      }
      current = current[index];
      continue;
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      return { found: false };
    }
    current = record[segment];
  }
  return { found: true, value: current };
}

function setAtPath(root: Record<string, unknown>, path: PathSegment[], value: unknown): void {
  let current: unknown = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i];
    const next = path[i + 1];
    const nextIsIndex = Boolean(next && isIndexSegment(next));
    if (Array.isArray(current)) {
      if (!isIndexSegment(segment)) {
        throw new Error(`Expected numeric index for array segment "${segment}"`);
      }
      const index = Number.parseInt(segment, 10);
      const existing = current[index];
      if (!existing || typeof existing !== "object") {
        current[index] = nextIsIndex ? [] : {};
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") {
      throw new Error(`Cannot traverse into "${segment}" (not an object)`);
    }
    const record = current as Record<string, unknown>;
    const existing = record[segment];
    if (!existing || typeof existing !== "object") {
      record[segment] = nextIsIndex ? [] : {};
    }
    current = record[segment];
  }

  const last = path[path.length - 1];
  if (Array.isArray(current)) {
    if (!isIndexSegment(last)) {
      throw new Error(`Expected numeric index for array segment "${last}"`);
    }
    const index = Number.parseInt(last, 10);
    current[index] = value;
    return;
  }
  if (!current || typeof current !== "object") {
    throw new Error(`Cannot set "${last}" (parent is not an object)`);
  }
  (current as Record<string, unknown>)[last] = value;
}

function unsetAtPath(root: Record<string, unknown>, path: PathSegment[]): boolean {
  let current: unknown = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i];
    if (!current || typeof current !== "object") {
      return false;
    }
    if (Array.isArray(current)) {
      if (!isIndexSegment(segment)) {
        return false;
      }
      const index = Number.parseInt(segment, 10);
      if (!Number.isFinite(index) || index < 0 || index >= current.length) {
        return false;
      }
      current = current[index];
      continue;
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      return false;
    }
    current = record[segment];
  }

  const last = path[path.length - 1];
  if (Array.isArray(current)) {
    if (!isIndexSegment(last)) {
      return false;
    }
    const index = Number.parseInt(last, 10);
    if (!Number.isFinite(index) || index < 0 || index >= current.length) {
      return false;
    }
    current.splice(index, 1);
    return true;
  }
  if (!current || typeof current !== "object") {
    return false;
  }
  const record = current as Record<string, unknown>;
  if (!(last in record)) {
    return false;
  }
  delete record[last];
  return true;
}

async function loadValidConfig(runtime: RuntimeEnv = defaultRuntime) {
  const snapshot = await readConfigFileSnapshot();
  if (snapshot.valid) {
    return snapshot;
  }
  runtime.error(`Config invalid at ${shortenHomePath(snapshot.path)}.`);
  for (const issue of snapshot.issues) {
    runtime.error(`- ${issue.path || "<root>"}: ${issue.message}`);
  }
  runtime.error(`Run \`${formatCliCommand("openclaw doctor")}\` to repair, then retry.`);
  runtime.exit(1);
  return snapshot;
}

function parseRequiredPath(path: string): PathSegment[] {
  const parsedPath = parsePath(path);
  if (parsedPath.length === 0) {
    throw new Error("Path is empty.");
  }
  return parsedPath;
}

function shouldValidateConfiguredPrimaryModel(path: PathSegment[]): boolean {
  const joined = path.join(".");
  return joined === "agents.defaults.model.primary" || joined === "agents.defaults.model";
}

async function validateConfiguredPrimaryModelOrThrow(params: {
  next: Record<string, unknown>;
  path: PathSegment[];
}): Promise<void> {
  if (!shouldValidateConfiguredPrimaryModel(params.path)) {
    return;
  }

  const [defaultsMod, selectionMod, catalogMod] = await Promise.all([
    import("../agents/defaults.js"),
    import("../agents/model-selection.js"),
    import("../agents/model-catalog.js"),
  ]);

  const cfg = params.next as OpenClawConfig;
  const resolved = selectionMod.resolveConfiguredModelRef({
    cfg,
    defaultProvider: defaultsMod.DEFAULT_PROVIDER,
    defaultModel: defaultsMod.DEFAULT_MODEL,
  });

  const catalog = await catalogMod.loadModelCatalog({
    config: cfg,
    useCache: false,
  });

  if (catalog.length === 0) {
    return;
  }

  const found = catalog.some(
    (entry) => entry.provider === resolved.provider && entry.id === resolved.model,
  );
  if (!found) {
    throw new Error(
      `Model '${resolved.provider}/${resolved.model}' not found. Run '${formatCliCommand("openclaw models list")}' to see available models.`,
    );
  }
}

function pathStartsWith(path: readonly string[], prefix: readonly string[]): boolean {
  if (path.length < prefix.length) {
    return false;
  }
  return prefix.every((segment, idx) => path[idx] === segment);
}

function isModelValidationPath(path: readonly string[]): boolean {
  const isAgentListModel =
    pathStartsWith(path, ["agents", "list"]) &&
    (path.includes("model") || path.includes("imageModel"));

  return (
    pathStartsWith(path, ["agents", "defaults", "model"]) ||
    pathStartsWith(path, ["agents", "defaults", "imageModel"]) ||
    pathStartsWith(path, ["hooks", "gmail", "model"]) ||
    isAgentListModel
  );
}

function collectCandidateModelRefs(cfg: OpenClawConfig): string[] {
  const out = new Set<string>();

  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) {
      out.add(value.trim());
    }
  };

  const collectPrimaryFallback = (value: unknown) => {
    if (typeof value === "string") {
      push(value);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value as { primary?: unknown; fallbacks?: unknown };
    push(record.primary);
    if (Array.isArray(record.fallbacks)) {
      for (const fallback of record.fallbacks) {
        push(fallback);
      }
    }
  };

  collectPrimaryFallback(cfg.agents?.defaults?.model as unknown);
  collectPrimaryFallback(cfg.agents?.defaults?.imageModel as unknown);
  push(cfg.hooks?.gmail?.model);

  const agentList = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  for (const agent of agentList) {
    if (!agent || typeof agent !== "object") {
      continue;
    }
    const record = agent as { model?: unknown; imageModel?: unknown };
    collectPrimaryFallback(record.model);
    collectPrimaryFallback(record.imageModel);
  }

  return [...out];
}

async function validateModelRefsForConfigSet(params: {
  cfg: OpenClawConfig;
  path: readonly string[];
}): Promise<void> {
  if (!isModelValidationPath(params.path)) {
    return;
  }

  const candidates = collectCandidateModelRefs(params.cfg);
  if (candidates.length === 0) {
    return;
  }

  const catalog = await loadModelCatalog({ config: params.cfg });
  const catalogKeys = new Set(
    catalog.map((entry) => modelKey(String(entry.provider ?? ""), String(entry.id ?? ""))),
  );
  const catalogProviders = new Set(catalog.map((entry) => String(entry.provider ?? "").toLowerCase()));
  const configuredKeys = new Set<string>();
  for (const raw of Object.keys(params.cfg.agents?.defaults?.models ?? {})) {
    const parsed = parseModelRef(String(raw ?? ""), DEFAULT_PROVIDER);
    if (!parsed) {
      continue;
    }
    configuredKeys.add(modelKey(parsed.provider, parsed.model));
  }

  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
  });

  for (const raw of candidates) {
    const resolved = resolveModelRefFromString({
      raw,
      defaultProvider: DEFAULT_PROVIDER,
      aliasIndex,
    });
    if (!resolved) {
      throw new Error(
        `Invalid model reference: ${raw}. Run \`${formatCliCommand("openclaw models list")}\` to see available models.`,
      );
    }

    const key = modelKey(resolved.ref.provider, resolved.ref.model);
    if (catalogKeys.has(key) || configuredKeys.has(key)) {
      continue;
    }

    // If we don't know this provider from the local model catalog, don't hard-fail.
    // Some providers/models may be discoverable only at runtime in specific environments.
    const providerKnown = catalogProviders.has(resolved.ref.provider.toLowerCase());
    if (!providerKnown) {
      continue;
    }

    throw new Error(
      `Model '${key}' not found in provider '${resolved.ref.provider}'. Run \`${formatCliCommand("openclaw models list")}\` to see available models.`,
    );
  }
}

export async function runConfigGet(opts: { path: string; json?: boolean; runtime?: RuntimeEnv }) {
  const runtime = opts.runtime ?? defaultRuntime;
  try {
    const parsedPath = parseRequiredPath(opts.path);
    const snapshot = await loadValidConfig(runtime);
    const res = getAtPath(snapshot.config, parsedPath);
    if (!res.found) {
      runtime.error(danger(`Config path not found: ${opts.path}`));
      runtime.exit(1);
      return;
    }
    if (opts.json) {
      runtime.log(JSON.stringify(res.value ?? null, null, 2));
      return;
    }
    if (
      typeof res.value === "string" ||
      typeof res.value === "number" ||
      typeof res.value === "boolean"
    ) {
      runtime.log(String(res.value));
      return;
    }
    runtime.log(JSON.stringify(res.value ?? null, null, 2));
  } catch (err) {
    runtime.error(danger(String(err)));
    runtime.exit(1);
  }
}

export async function runConfigUnset(opts: { path: string; runtime?: RuntimeEnv }) {
  const runtime = opts.runtime ?? defaultRuntime;
  try {
    const parsedPath = parseRequiredPath(opts.path);
    const snapshot = await loadValidConfig(runtime);
    // Use snapshot.resolved (config after $include and ${ENV} resolution, but BEFORE runtime defaults)
    // instead of snapshot.config (runtime-merged with defaults).
    // This prevents runtime defaults from leaking into the written config file (issue #6070)
    const next = structuredClone(snapshot.resolved) as Record<string, unknown>;
    const removed = unsetAtPath(next, parsedPath);
    if (!removed) {
      runtime.error(danger(`Config path not found: ${opts.path}`));
      runtime.exit(1);
      return;
    }
    await writeConfigFile(next);
    runtime.log(info(`Removed ${opts.path}. Restart the gateway to apply.`));
  } catch (err) {
    runtime.error(danger(String(err)));
    runtime.exit(1);
  }
}

export function registerConfigCli(program: Command) {
  const cmd = program
    .command("config")
    .description(
      "Non-interactive config helpers (get/set/unset). Run without subcommand for the setup wizard.",
    )
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/config", "docs.openclaw.ai/cli/config")}\n`,
    )
    .option(
      "--section <section>",
      "Configure wizard sections (repeatable). Use with no subcommand.",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .action(async (opts) => {
      const { configureCommandFromSectionsArg } = await import("../commands/configure.js");
      await configureCommandFromSectionsArg(opts.section, defaultRuntime);
    });

  cmd
    .command("get")
    .description("Get a config value by dot path")
    .argument("<path>", "Config path (dot or bracket notation)")
    .option("--json", "Output JSON", false)
    .action(async (path: string, opts) => {
      await runConfigGet({ path, json: Boolean(opts.json) });
    });

  cmd
    .command("set")
    .description("Set a config value by dot path")
    .argument("<path>", "Config path (dot or bracket notation)")
    .argument("<value>", "Value (JSON5 or raw string)")
    .option("--strict-json", "Strict JSON5 parsing (error instead of raw string fallback)", false)
    .option("--json", "Legacy alias for --strict-json", false)
    .action(async (path: string, value: string, opts) => {
      try {
        const parsedPath = parsePath(path);
        if (parsedPath.length === 0) {
          throw new Error("Path is empty.");
        }
        const parsedValue = parseValue(value, {
          strictJson: Boolean(opts.strictJson || opts.json),
        });
        const snapshot = await loadValidConfig();
        // Use snapshot.resolved (config after $include and ${ENV} resolution, but BEFORE runtime defaults)
        // instead of snapshot.config (runtime-merged with defaults).
        // This prevents runtime defaults from leaking into the written config file (issue #6070)
        const next = structuredClone(snapshot.resolved) as Record<string, unknown>;
        setAtPath(next, parsedPath, parsedValue);
        await validateModelRefsForConfigSet({
          cfg: next as OpenClawConfig,
          path: parsedPath,
        });
        await writeConfigFile(next as OpenClawConfig);
        defaultRuntime.log(info(`Updated ${path}. Restart the gateway to apply.`));
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  cmd
    .command("unset")
    .description("Remove a config value by dot path")
    .argument("<path>", "Config path (dot or bracket notation)")
    .action(async (path: string) => {
      await runConfigUnset({ path });
    });
}
