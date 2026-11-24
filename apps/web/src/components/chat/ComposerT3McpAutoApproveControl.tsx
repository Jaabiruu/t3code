import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type OrchestrationV2ThreadT3McpAutoApproveState,
  type T3McpAutoApproveSettings,
  type ThreadId,
} from "@t3tools/contracts";
import {
  normalizeT3McpAutoApproveTools,
  T3_MCP_AUTO_APPROVE_CATEGORIES,
  withToggledT3McpAutoApproveTool,
} from "@t3tools/shared/t3McpAutoApprove";
import { resolveT3McpToolPresentation } from "@t3tools/shared/t3McpToolPresentation";
import { useGT } from "gt-react";
import { useState } from "react";

import { m } from "../../i18n/messages";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

const QUICK_HTML_TOOLS = T3_MCP_AUTO_APPROVE_CATEGORIES[0]?.tools ?? [
  "html_preview",
  "html_render",
  "send_to_user",
];

export function ComposerT3McpAutoApproveControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const [saving, setSaving] = useState(false);
  const [showMoreTools, setShowMoreTools] = useState(false);

  const query = useEnvironmentQuery<OrchestrationV2ThreadT3McpAutoApproveState, unknown>(
    orchestrationEnvironment.threadT3McpAutoApprove({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const setOverride = useAtomCommand(orchestrationEnvironment.setThreadT3McpAutoApprove);
  const permitted = useAtomValue(
    orchestrationEnvironment.setThreadT3McpAutoApprove.permissionAtom(props.environmentId),
  );

  const state = query.data;
  const effective = state?.effective ?? { mode: "off" as const, tools: [] };
  const isDefault = state?.sessionOverride === null || state === null;
  const activeModeKey = isDefault ? "default" : effective.mode;
  const disabled = !permitted || saving || state === null;
  const selectedToolSet = new Set(normalizeT3McpAutoApproveTools(effective.tools));

  const applyOverride = async (override: T3McpAutoApproveSettings | null) => {
    if (!permitted || saving) return;
    setSaving(true);
    const result = await setOverride({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, override },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not update session T3 MCP permissions"),
        description: thrownErrorMessage(error, m) ?? undefined,
      });
      return;
    }
    query.refresh();
  };

  const handleToggleTool = (toolName: string) => {
    if (!state) return;
    const base = state.sessionOverride ?? state.effective;
    const next = withToggledT3McpAutoApproveTool(base, toolName);
    void applyOverride(next);
  };

  const inheritedSummary =
    state?.global.mode === "all"
      ? gt("Default (All)")
      : state?.global.mode === "selected"
        ? gt("Default ({count})", { count: state.global.tools.length })
        : gt("Default (Off)");

  return (
    <div className="mt-1 grid gap-1.5 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-muted-foreground text-xs">
          {gt("T3 MCP tools (this session)")}
        </span>
        {isDefault ? (
          <span className="text-2xs text-muted-foreground">{inheritedSummary}</span>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void applyOverride(null)}
            className="cursor-pointer text-2xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {gt("Reset")}
          </button>
        )}
      </div>

      <div className="flex gap-0.5 rounded-lg bg-input/40 p-0.5">
        {(
          [
            { key: "default", label: gt("Default"), override: null },
            {
              key: "off",
              label: gt("Off"),
              override: { mode: "off", tools: effective.tools },
            },
            {
              key: "selected",
              label: gt("Selected"),
              override: { mode: "selected", tools: effective.tools },
            },
            {
              key: "all",
              label: gt("All"),
              override: { mode: "all", tools: effective.tools },
            },
          ] as const
        ).map((item) => {
          const active = activeModeKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => void applyOverride(item.override)}
              className={
                active
                  ? "flex h-6 flex-1 cursor-pointer items-center justify-center rounded-md bg-input/72 px-1.5 text-2xs font-medium text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  : "flex h-6 flex-1 cursor-pointer items-center justify-center rounded-md px-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {QUICK_HTML_TOOLS.map((toolName) => {
          const active =
            effective.mode === "all" ||
            (effective.mode === "selected" && selectedToolSet.has(toolName));
          const label = resolveT3McpToolPresentation(toolName)?.displayName ?? toolName;
          return (
            <button
              key={toolName}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => handleToggleTool(toolName)}
              className={
                active
                  ? "cursor-pointer rounded border border-primary/50 bg-primary/14 px-1.5 py-0.5 text-2xs font-medium text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  : "cursor-pointer rounded border border-border/60 bg-background/50 px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          aria-expanded={showMoreTools}
          onClick={() => setShowMoreTools((current) => !current)}
          className="cursor-pointer rounded px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showMoreTools ? gt("Hide tools") : gt("More tools")}
        </button>
      </div>

      {showMoreTools ? (
        <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-2">
          {T3_MCP_AUTO_APPROVE_CATEGORIES.slice(1).map((category) => (
            <div key={category.id} className="grid gap-1">
              <span className="text-2xs font-medium text-muted-foreground">{category.label}</span>
              <div className="flex flex-wrap gap-1">
                {category.tools.map((toolName) => {
                  const active =
                    effective.mode === "all" ||
                    (effective.mode === "selected" && selectedToolSet.has(toolName));
                  return (
                    <button
                      key={toolName}
                      type="button"
                      disabled={disabled}
                      aria-pressed={active}
                      onClick={() => handleToggleTool(toolName)}
                      className={
                        active
                          ? "cursor-pointer rounded border border-primary/50 bg-primary/14 px-1.5 py-0.5 font-mono text-2xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          : "cursor-pointer rounded border border-border/50 bg-background/60 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      }
                    >
                      {toolName}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
