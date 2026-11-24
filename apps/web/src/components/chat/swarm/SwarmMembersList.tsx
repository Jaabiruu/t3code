import type {
  OrchestrationV2NativeChildStep,
  OrchestrationV2NativeSwarmMember,
} from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import { T, useGT, Var } from "gt-react";
import { ChevronRightIcon, WrenchIcon } from "lucide-react";
import { useState } from "react";

import { useNowMinute } from "../../../hooks/useNowMinute";
import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { ScrollArea } from "../../ui/scroll-area";

function formatStepLabel(type: string): string {
  const words = type.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function memberStateBadge(
  state: OrchestrationV2NativeSwarmMember["state"],
  gt: ReturnType<typeof useGT>,
): { readonly label: string; readonly variant: "info" | "secondary" | "warning" | "outline" } {
  switch (state) {
    case "working":
      return { label: gt("working"), variant: "info" };
    case "waiting":
      return { label: gt("waiting"), variant: "secondary" };
    case "stopped":
      return { label: gt("stopped"), variant: "warning" };
    case "killed":
      return { label: gt("retired"), variant: "outline" };
  }
}

function MemberStepRow(props: { readonly step: OrchestrationV2NativeChildStep }) {
  const { step } = props;
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <span className="text-2xs font-medium text-muted-foreground">
        {formatStepLabel(step.type)}
        {step.status !== null && step.status !== "DONE" ? ` · ${formatStepLabel(step.status)}` : ""}
      </span>
      {step.toolCalls.length > 0 ? (
        <code className="whitespace-pre-wrap break-all rounded bg-muted/60 px-1.5 py-1 font-mono text-2xs text-foreground">
          {step.toolCalls.map((call) => `${call.name} ${call.input}`.trim()).join("\n")}
        </code>
      ) : null}
      {step.text !== null && step.text.length > 0 ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-1.5 py-1 font-mono text-2xs text-foreground">
          {step.text}
        </pre>
      ) : null}
    </li>
  );
}

function MemberCard(props: {
  readonly member: OrchestrationV2NativeSwarmMember;
  readonly nowMs: number;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  const { member } = props;
  const steps = member.steps;
  const stepCount = steps?.length ?? 0;
  const badge = memberStateBadge(member.state, gt);

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-foreground">{member.name}</span>
          <Badge size="sm" variant={badge.variant}>
            {badge.label}
          </Badge>
          {member.role ? (
            <span className="truncate text-2xs text-muted-foreground">{member.role}</span>
          ) : null}
        </div>
        {member.updatedAt ? (
          <span className="shrink-0 text-3xs text-muted-foreground tabular-nums">
            {formatRelativeTimeLabel(member.updatedAt, props.nowMs)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        {member.model ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-3xs text-foreground">
            {formatModelSlugName(member.model)}
          </span>
        ) : null}
        {member.latestToolCall ? (
          <span className="inline-flex min-w-0 items-center gap-1 rounded bg-info/10 px-1.5 py-0.5 font-mono text-3xs text-info-foreground">
            <WrenchIcon aria-hidden className="size-2.5 shrink-0" />
            <span className="truncate">{member.latestToolCall}</span>
          </span>
        ) : null}
      </div>

      {steps !== null && stepCount > 0 ? (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-left text-2xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
            />
            <span>
              <T>
                Live transcript (<Var>{stepCount}</Var> steps)
              </T>
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <ol className="m-0 mt-2 flex max-h-64 list-none flex-col gap-2 overflow-auto border-s border-border ps-3 pe-1 pt-0.5 pb-1">
              {steps.map((step) => (
                <MemberStepRow key={step.index} step={step} />
              ))}
            </ol>
          </CollapsiblePanel>
        </Collapsible>
      ) : (
        <span className="text-3xs text-muted-foreground">
          <T>No transcript steps recorded yet.</T>
        </span>
      )}
    </article>
  );
}

export function SwarmMembersList(props: {
  readonly members: ReadonlyArray<OrchestrationV2NativeSwarmMember>;
}) {
  const gt = useGT();
  const nowMs = Date.parse(`${useNowMinute()}:00.000Z`);

  const activeMembers = props.members.filter((member) => member.state === "working");
  const waitingMembers = props.members.filter((member) => member.state === "waiting");
  const retiredMembers = props.members.filter(
    (member) => member.state === "stopped" || member.state === "killed",
  );

  const groups: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly members: ReadonlyArray<OrchestrationV2NativeSwarmMember>;
  }> = [
    { key: "active", title: gt("Active"), members: activeMembers },
    { key: "waiting", title: gt("Waiting"), members: waitingMembers },
    { key: "retired", title: gt("Retired"), members: retiredMembers },
  ];

  return (
    <ScrollArea scrollFade>
      <div className="flex flex-col gap-4 pe-1 pb-2">
        {groups
          .filter((group) => group.members.length > 0)
          .map((group) => (
            <section key={group.key} aria-label={group.title} className="flex flex-col gap-2">
              <header className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground">{group.title}</h3>
                <Badge size="sm" variant="secondary">
                  {group.members.length}
                </Badge>
              </header>
              <div className="flex flex-col gap-2">
                {group.members.map((member) => (
                  <MemberCard key={member.name} member={member} nowMs={nowMs} />
                ))}
              </div>
            </section>
          ))}
      </div>
    </ScrollArea>
  );
}
