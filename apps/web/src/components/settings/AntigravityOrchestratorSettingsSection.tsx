import { useId } from "react";
import {
  ANTIGRAVITY_ORCHESTRATOR_EFFORTS,
  type AntigravityOrchestratorEffort,
  type ProviderInstanceConfig,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const EFFORT_LABELS: Record<AntigravityOrchestratorEffort, string> = {
  "": msg("Default"),
  low: msg("Low"),
  medium: msg("Medium"),
  high: msg("High"),
  xhigh: msg("Extra High"),
  max: msg("Max"),
};

function readConfigString(config: unknown, key: string): string {
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function readEffortValue(config: unknown, key: string): AntigravityOrchestratorEffort {
  const raw = readConfigString(config, key);
  return (ANTIGRAVITY_ORCHESTRATOR_EFFORTS as readonly string[]).includes(raw)
    ? (raw as AntigravityOrchestratorEffort)
    : "";
}

function nextConfigWithField(
  config: unknown,
  key: string,
  value: string,
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    delete base[key];
  } else {
    base[key] = trimmed;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

function uniqueModels(
  models: ReadonlyArray<ServerProviderModel> | undefined,
): ServerProviderModel[] {
  const seen = new Set<string>();
  const result: ServerProviderModel[] = [];
  for (const model of models ?? []) {
    if (seen.has(model.slug)) continue;
    seen.add(model.slug);
    result.push(model);
  }
  return result;
}

export interface AntigravityOrchestratorSettingsSectionProps {
  readonly instance: ProviderInstanceConfig;
  readonly liveProvider: ServerProvider | undefined;
  readonly readOnly: boolean;
  readonly onUpdateConfig: (
    nextConfig: Record<string, unknown> | undefined,
  ) => Promise<boolean> | void;
}

function AntigravityModelSelect(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly readOnly: boolean;
  readonly onChange: (value: string) => void;
}) {
  const gt = useGT();
  const hasSavedFallback =
    props.value.length > 0 && !props.models.some((model) => model.slug === props.value);
  const selectedModel = props.models.find((model) => model.slug === props.value);
  const displayLabel =
    props.value.length === 0 ? gt("Antigravity default") : (selectedModel?.name ?? props.value);

  return (
    <div className="w-full min-w-0 @min-[32rem]/settings-row:w-64">
      <Select
        value={props.value}
        disabled={props.readOnly}
        onValueChange={(next) => {
          if (typeof next === "string") props.onChange(next);
        }}
      >
        <SelectTrigger id={props.id} size="sm" aria-label={props.label}>
          <SelectValue>{displayLabel}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          <SelectItem value="">{gt("Antigravity default")}</SelectItem>
          {props.models.map((model) => (
            <SelectItem key={model.slug} value={model.slug}>
              {model.name}
            </SelectItem>
          ))}
          {hasSavedFallback ? <SelectItem value={props.value}>{props.value}</SelectItem> : null}
        </SelectPopup>
      </Select>
    </div>
  );
}

function AntigravityEffortSelect(props: {
  readonly id: string;
  readonly label: string;
  readonly value: AntigravityOrchestratorEffort;
  readonly readOnly: boolean;
  readonly onChange: (value: AntigravityOrchestratorEffort) => void;
}) {
  const messages = useMessages();
  return (
    <div className="w-full min-w-0 @min-[32rem]/settings-row:w-64">
      <Select
        value={props.value}
        disabled={props.readOnly}
        onValueChange={(next) => {
          if (typeof next === "string") {
            props.onChange(next as AntigravityOrchestratorEffort);
          }
        }}
      >
        <SelectTrigger id={props.id} size="sm" aria-label={props.label}>
          <SelectValue>{messages(EFFORT_LABELS[props.value])}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {ANTIGRAVITY_ORCHESTRATOR_EFFORTS.map((effort) => (
            <SelectItem key={effort || "default"} value={effort}>
              {messages(EFFORT_LABELS[effort])}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

export function AntigravityOrchestratorSettingsSection(
  props: AntigravityOrchestratorSettingsSectionProps,
) {
  const gt = useGT();
  const baseId = useId();
  const orchestratorModelId = `${baseId}-orchestrator-model`;
  const orchestratorEffortId = `${baseId}-orchestrator-effort`;
  const executorModelId = `${baseId}-executor-model`;
  const executorEffortId = `${baseId}-executor-effort`;

  const config = props.instance.config;
  const models = uniqueModels(props.liveProvider?.models);
  const orchestratorModel = readConfigString(config, "defaultOrchestratorModel");
  const orchestratorEffort = readEffortValue(config, "defaultOrchestratorEffort");
  const executorModel = readConfigString(config, "defaultExecutorModel");
  const executorEffort = readEffortValue(config, "defaultExecutorEffort");

  const updateField = (key: string, value: string) => {
    void props.onUpdateConfig(nextConfigWithField(config, key, value));
  };

  return (
    <SettingsSection
      title={gt("Orchestrator & Executor")}
      inert={props.readOnly}
      aria-disabled={props.readOnly || undefined}
      className={props.readOnly ? "opacity-50 select-none" : undefined}
    >
      <SettingsRow
        title={
          <label htmlFor={orchestratorModelId}>{gt("Default Orchestrator (Planner) Model")}</label>
        }
        description={gt(
          "Default model used by Antigravity when planning and coordinating multi-step tasks.",
        )}
        control={
          <AntigravityModelSelect
            id={orchestratorModelId}
            label={gt("Default Orchestrator (Planner) Model")}
            value={orchestratorModel}
            models={models}
            readOnly={props.readOnly}
            onChange={(value) => updateField("defaultOrchestratorModel", value)}
          />
        }
      />
      <SettingsRow
        title={<label htmlFor={orchestratorEffortId}>{gt("Orchestrator Thinking Effort")}</label>}
        description={gt(
          "Default reasoning effort applied to the Antigravity orchestrator when supported.",
        )}
        control={
          <AntigravityEffortSelect
            id={orchestratorEffortId}
            label={gt("Orchestrator Thinking Effort")}
            value={orchestratorEffort}
            readOnly={props.readOnly}
            onChange={(value) => updateField("defaultOrchestratorEffort", value)}
          />
        }
      />
      <SettingsRow
        title={<label htmlFor={executorModelId}>{gt("Default Executor Model")}</label>}
        description={gt(
          "Default model used by Antigravity when executing delegated implementation steps.",
        )}
        control={
          <AntigravityModelSelect
            id={executorModelId}
            label={gt("Default Executor Model")}
            value={executorModel}
            models={models}
            readOnly={props.readOnly}
            onChange={(value) => updateField("defaultExecutorModel", value)}
          />
        }
      />
      <SettingsRow
        title={<label htmlFor={executorEffortId}>{gt("Executor Thinking Effort")}</label>}
        description={gt(
          "Default reasoning effort applied to the Antigravity executor when supported.",
        )}
        control={
          <AntigravityEffortSelect
            id={executorEffortId}
            label={gt("Executor Thinking Effort")}
            value={executorEffort}
            readOnly={props.readOnly}
            onChange={(value) => updateField("defaultExecutorEffort", value)}
          />
        }
      />
      <SettingsRow
        title={gt("OAuth sign-in modes")}
        description={gt(
          "Local browser OAuth signs in via a localhost callback. One-time code uses the official Antigravity ACP code flow for remote or SSH sessions.",
        )}
      />
    </SettingsSection>
  );
}
