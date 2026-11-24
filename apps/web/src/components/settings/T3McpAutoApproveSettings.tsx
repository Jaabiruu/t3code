import {
  DEFAULT_T3_MCP_AUTO_APPROVE_SETTINGS,
  T3_MCP_AUTO_APPROVE_MODES,
  type T3McpAutoApproveMode,
} from "@t3tools/contracts";
import {
  normalizeT3McpAutoApproveTools,
  T3_MCP_AUTO_APPROVE_CATEGORIES,
  withToggledT3McpAutoApproveTool,
} from "@t3tools/shared/t3McpAutoApprove";
import { resolveT3McpToolPresentation } from "@t3tools/shared/t3McpToolPresentation";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useSearchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function isT3McpAutoApproveMode(value: string | null): value is T3McpAutoApproveMode {
  return value !== null && (T3_MCP_AUTO_APPROVE_MODES as readonly string[]).includes(value);
}

export function T3McpAutoApproveSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["t3McpAutoApprove"]);
  const [filter, setFilter] = useState("");

  const current = settings.t3McpAutoApprove;
  const selectedSet = new Set(normalizeT3McpAutoApproveTools(current.tools));
  const query = filter.trim().toLowerCase();

  const modeLabel = (mode: T3McpAutoApproveMode): string => {
    switch (mode) {
      case "off":
        return gt("Follow permission mode");
      case "selected":
        return gt("Selected tools");
      case "all":
        return gt("All T3 MCP tools");
    }
  };

  const modeDescription = (mode: T3McpAutoApproveMode): string => {
    switch (mode) {
      case "off":
        return gt("Prompt according to each thread's runtime permission mode.");
      case "selected":
        return gt(
          "Automatically approve only the T3 MCP tools toggled below in non-read-only sessions.",
        );
      case "all":
        return gt(
          "Automatically approve all authenticated t3-code MCP tool calls in non-read-only sessions.",
        );
    }
  };

  const toggleCategoryTools = (tools: ReadonlyArray<string>, enableAll: boolean) => {
    const next = enableAll
      ? normalizeT3McpAutoApproveTools([...current.tools, ...tools])
      : normalizeT3McpAutoApproveTools(current.tools.filter((tool) => !tools.includes(tool)));
    updateSettings({
      t3McpAutoApprove: {
        mode: "selected",
        tools: next,
      },
    });
  };

  return (
    <div className="grid">
      <SettingsRow
        serverScoped
        settingKeys={["t3McpAutoApprove"]}
        mixed={mixed}
        {...searchableSetting("t3-mcp-auto-approve")}
        title={gt("T3 MCP auto-approve")}
        description={gt(
          "Bypass repeated approval prompts for authenticated t3-code MCP tools such as HTML preview, browser inspection, and thread helpers. Individual threads can override this from Composer Permissions.",
        )}
        resetAction={
          current.mode !== DEFAULT_T3_MCP_AUTO_APPROVE_SETTINGS.mode || current.tools.length > 0 ? (
            <SettingResetButton
              ariaLabel={gt("Reset T3 MCP auto-approve to default")}
              onClick={() =>
                updateSettings({ t3McpAutoApprove: DEFAULT_T3_MCP_AUTO_APPROVE_SETTINGS })
              }
            />
          ) : null
        }
        control={
          <Select
            value={mixed ? null : current.mode}
            onValueChange={(value) => {
              if (!isT3McpAutoApproveMode(value)) return;
              updateSettings({
                t3McpAutoApprove: {
                  mode: value,
                  tools: current.tools,
                },
              });
            }}
          >
            <SelectTrigger size="sm" aria-label={gt("T3 MCP auto-approve")}>
              <SelectValue>
                {(value: string | null) =>
                  isT3McpAutoApproveMode(value)
                    ? modeLabel(value)
                    : gt("Mixed", { $context: "values differ across targets" })
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {T3_MCP_AUTO_APPROVE_MODES.map((mode) => (
                <SelectItem key={mode} value={mode} className="min-w-64">
                  <div className="grid gap-0.5">
                    <span className="font-medium">{modeLabel(mode)}</span>
                    <span className="text-xs leading-4 text-muted-foreground">
                      {modeDescription(mode)}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {!mixed && current.mode === "selected" ? (
        <div className="mx-4 mb-3 grid gap-3 rounded-lg border border-border/70 bg-muted/25 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Input
              size="compact"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={gt("Filter T3 MCP tools...")}
              aria-label={gt("Filter T3 MCP tools")}
              className="max-w-64"
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{gt("{count} selected", { count: selectedSet.size })}</span>
              {selectedSet.size > 0 ? (
                <Button
                  type="button"
                  size="micro"
                  variant="ghost"
                  onClick={() =>
                    updateSettings({
                      t3McpAutoApprove: { mode: "selected", tools: [] },
                    })
                  }
                >
                  <T>Clear all</T>
                </Button>
              ) : null}
            </div>
          </div>
          <div className="grid gap-3">
            {T3_MCP_AUTO_APPROVE_CATEGORIES.map((category) => {
              const visibleTools =
                query.length === 0
                  ? category.tools
                  : category.tools.filter((toolName) => {
                      const display =
                        resolveT3McpToolPresentation(toolName)?.displayName ?? toolName;
                      return (
                        toolName.toLowerCase().includes(query) ||
                        display.toLowerCase().includes(query) ||
                        category.label.toLowerCase().includes(query)
                      );
                    });
              if (visibleTools.length === 0) return null;
              const allCategorySelected = visibleTools.every((toolName) =>
                selectedSet.has(toolName),
              );
              return (
                <div key={category.id} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="grid">
                      <span className="text-xs font-medium text-foreground">{category.label}</span>
                      <span className="text-2xs text-muted-foreground">{category.description}</span>
                    </div>
                    <Button
                      type="button"
                      size="micro"
                      variant="ghost"
                      onClick={() => toggleCategoryTools(visibleTools, !allCategorySelected)}
                    >
                      {allCategorySelected ? gt("Clear") : gt("Select all")}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {visibleTools.map((toolName) => {
                      const enabled = selectedSet.has(toolName);
                      const display =
                        resolveT3McpToolPresentation(toolName)?.displayName ?? toolName;
                      return (
                        <button
                          key={toolName}
                          type="button"
                          aria-pressed={enabled}
                          onClick={() => {
                            const updated = withToggledT3McpAutoApproveTool(current, toolName);
                            updateSettings({
                              t3McpAutoApprove: {
                                mode: "selected",
                                tools: updated.tools,
                              },
                            });
                          }}
                          className={
                            enabled
                              ? "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-primary/50 bg-primary/12 px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-primary/18"
                              : "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                          }
                        >
                          <span className="font-medium">{display}</span>
                          <span className="font-mono text-2xs opacity-70">{toolName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
