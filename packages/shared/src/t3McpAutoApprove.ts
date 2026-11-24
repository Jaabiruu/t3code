import type { T3McpAutoApproveSettings } from "@t3tools/contracts";
import { resolveT3McpToolId, T3_MCP_TOOL_NAMES } from "./t3McpToolPresentation.ts";

export interface T3McpAutoApproveCategory {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly tools: ReadonlyArray<string>;
}

/** Grouped T3 MCP tools ordered with HTML and visual tools first for quick discovery. */
export const T3_MCP_AUTO_APPROVE_CATEGORIES: ReadonlyArray<T3McpAutoApproveCategory> = [
  {
    id: "html",
    label: "HTML & Visuals",
    description: "Render inline HTML diagrams and preview interactive pages in the thread.",
    tools: ["html_preview", "html_render", "send_to_user"],
  },
  {
    id: "preview",
    label: "Preview Browser",
    description: "Inspect and interact with pages inside T3's built-in preview browser.",
    tools: [
      "preview_status",
      "preview_open",
      "preview_navigate",
      "preview_dialog",
      "preview_snapshot",
      "preview_act",
      "preview_click",
      "preview_press",
      "preview_type",
      "preview_hover",
      "preview_select",
      "preview_drag",
      "preview_upload",
      "preview_scroll",
      "preview_resize",
      "preview_evaluate",
      "preview_wait_for",
      "preview_set_appearance",
      "preview_recording_start",
      "preview_recording_stop",
      "t3_preview_list",
      "t3_preview_close",
    ],
  },
  {
    id: "devices",
    label: "Mobile Devices",
    description: "Open, control, and capture screenshots from linked iOS and Android devices.",
    tools: ["device_list", "device_open", "device_screenshot", "device_close"],
  },
  {
    id: "orchestration",
    label: "Threads, Subagents & Workflows",
    description: "Launch, delegate, inspect, and coordinate threads, queues, and workflows.",
    tools: [
      "orchestrator_capabilities",
      "delegate_task",
      "task_status",
      "task_cancel",
      "create_threads",
      "t3_thread_start",
      "t3_thread_launch",
      "t3_thread_list",
      "t3_thread_read",
      "t3_thread_send",
      "t3_thread_wait",
      "t3_thread_interrupt",
      "t3_workflow",
      "t3_workflow_stop",
      "t3_background_wait",
      "t3_submit_output",
      "t3_thread_configuration",
      "t3_thread_configure",
      "t3_thread_transfer",
      "t3_thread_fork",
      "t3_thread_merge_back",
      "t3_thread_search",
      "t3_thread_transfers",
      "t3_thread_organize",
      "t3_thread_update",
      "t3_queue",
      "t3_queue_list",
      "t3_queue_read",
      "t3_queue_edit",
      "t3_queue_cancel",
      "t3_queue_reorder",
      "t3_queue_promote_to_steer",
      "t3_pending_request",
      "t3_pending_request_list",
      "t3_pending_request_read",
      "t3_pending_request_respond",
    ],
  },
  {
    id: "pull-requests",
    label: "Pull Requests & CI",
    description: "Read, create, review, watch, link, and merge pull requests or inspect CI logs.",
    tools: [
      "pull_request_read",
      "pull_request_list",
      "pull_request_create",
      "pull_request_update",
      "pull_request_respond",
      "pull_request_review",
      "pull_request_merge",
      "ci_logs",
      "ci_rerun",
      "link_pull_request",
      "link_pull_requests",
      "unlink_pull_request",
      "unlink_pull_requests",
      "list_thread_pull_requests",
      "watch_pull_request",
      "unwatch_pull_request",
      "write_pull_request_guides",
      "read_pull_request_guide",
    ],
  },
  {
    id: "issues",
    label: "Issues",
    description: "Search, read, create, update, comment on, and link tracked issues.",
    tools: [
      "list_issues",
      "read_issue",
      "create_issue",
      "comment_on_issue",
      "set_issue_state",
      "link_issue",
      "unlink_issue",
      "list_thread_issues",
    ],
  },
  {
    id: "automation",
    label: "Schedules & Secrets",
    description: "Manage scheduled prompts and request secrets through T3 secret prompts.",
    tools: [
      "schedule_task",
      "list_scheduled_tasks",
      "update_scheduled_task",
      "delete_scheduled_task",
      "run_scheduled_task_now",
      "request_secret",
    ],
  },
  {
    id: "workspace",
    label: "Workspace, Projects & Settings",
    description: "Manage projects, worktrees, attachments, environments, and app themes.",
    tools: [
      "t3_worktree_handoff",
      "t3_worktree_status",
      "t3_worktree_list",
      "t3_project_list",
      "t3_project_read",
      "t3_project_create",
      "t3_project_update",
      "t3_project_delete",
      "t3_project_clone",
      "t3_attachment_prepare_upload",
      "t3_attachment_discard",
      "t3_thread_send_attachments",
      "t3_environment_read",
      "t3_environment_links",
      "t3_environment_link",
      "t3_environment_unlink",
      "t3_environment_preferences_update",
      "t3_theme_read",
      "t3_theme_set",
    ],
  },
];

function stripKnownT3McpPrefix(rawName: string): string {
  const trimmed = rawName.trim();
  if (trimmed.startsWith("mcp__t3-code__")) {
    return trimmed.slice("mcp__t3-code__".length);
  }
  if (trimmed.startsWith("mcp_t3-code_")) {
    return trimmed.slice("mcp_t3-code_".length);
  }
  return trimmed;
}

export function canonicalizeT3McpToolName(rawName: string): string | undefined {
  const stripped = stripKnownT3McpPrefix(rawName);
  if (stripped.length === 0) return undefined;
  const resolved = resolveT3McpToolId(stripped);
  if (resolved !== null) return resolved;
  return T3_MCP_TOOL_NAMES.has(stripped) ? stripped : undefined;
}

export function normalizeT3McpAutoApproveTools(tools: ReadonlyArray<string>): Array<string> {
  const unique = new Set<string>();
  for (const entry of tools) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    unique.add(canonicalizeT3McpToolName(trimmed) ?? trimmed);
  }
  return [...unique].sort((left, right) => left.localeCompare(right));
}

export function resolveEffectiveT3McpAutoApprove(
  global: T3McpAutoApproveSettings,
  sessionOverride: T3McpAutoApproveSettings | null,
): T3McpAutoApproveSettings {
  const active = sessionOverride ?? global;
  return {
    mode: active.mode,
    tools: normalizeT3McpAutoApproveTools(active.tools),
  };
}

export function shouldAutoApproveT3McpTool(
  policy: T3McpAutoApproveSettings | null | undefined,
  toolName: string,
): boolean {
  if (!policy || policy.mode === "off") return false;
  const canonical = canonicalizeT3McpToolName(toolName);
  if (!canonical) return false;
  if (policy.mode === "all") return true;
  return policy.tools.some((entry) => canonicalizeT3McpToolName(entry) === canonical);
}

export function withAddedT3McpAutoApproveTool(
  current: T3McpAutoApproveSettings,
  toolName: string,
): T3McpAutoApproveSettings {
  const canonical = canonicalizeT3McpToolName(toolName);
  if (!canonical) return current;
  if (current.mode === "all") {
    return {
      mode: "all",
      tools: normalizeT3McpAutoApproveTools([...current.tools, canonical]),
    };
  }
  return {
    mode: "selected",
    tools: normalizeT3McpAutoApproveTools([...current.tools, canonical]),
  };
}

export function withToggledT3McpAutoApproveTool(
  current: T3McpAutoApproveSettings,
  toolName: string,
): T3McpAutoApproveSettings {
  const canonical = canonicalizeT3McpToolName(toolName) ?? toolName.trim();
  if (canonical.length === 0) return current;
  const normalized = normalizeT3McpAutoApproveTools(current.tools);
  const nextTools = normalized.includes(canonical)
    ? normalized.filter((entry) => entry !== canonical)
    : normalizeT3McpAutoApproveTools([...normalized, canonical]);
  return {
    mode: nextTools.length > 0 ? "selected" : current.mode === "selected" ? "off" : current.mode,
    tools: nextTools,
  };
}
