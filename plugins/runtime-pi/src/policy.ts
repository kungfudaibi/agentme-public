export const piWorktreePolicySource = `
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";

const root = await realpath(resolve(process.env.AGENTME_PI_WORKTREE_ROOT ?? ""));
const pathTools = new Set(["read", "edit", "write", "grep", "find", "ls"]);
const requiredPathTools = new Set(["read", "edit", "write"]);

function isInside(candidate) {
  const child = relative(root, candidate);
  return child === "" || (child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child));
}

async function isContained(rawPath) {
  if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.length > 4096) return false;
  const absolute = resolve(root, rawPath);
  if (!isInside(absolute)) return false;
  let existing = absolute;
  const missing = [];
  for (;;) {
    try {
      const canonical = resolve(await realpath(existing), ...missing);
      return isInside(canonical);
    } catch (error) {
      if (error?.code !== "ENOENT" || existing === root) return false;
      missing.unshift(basename(existing));
      existing = dirname(existing);
      if (!isInside(existing)) return false;
    }
  }
}

export default function registerAgentMeWorktreePolicy(pi) {
  pi.on("tool_call", async (event) => {
    if (!pathTools.has(event.toolName)) return;
    const candidate = event.input?.path ?? event.input?.file_path;
    if (candidate === undefined && !requiredPathTools.has(event.toolName)) return;
    if (await isContained(candidate)) return;
    return {
      block: true,
      terminate: true,
      reason: "AgentMe worktree policy blocked a path outside the assigned worktree",
    };
  });
}
`;
