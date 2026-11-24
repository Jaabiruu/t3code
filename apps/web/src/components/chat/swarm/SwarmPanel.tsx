import type {
  EnvironmentId,
  OrchestrationV2GetNativeSwarmStateResult,
  ThreadId,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { NetworkIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useStableCallback } from "../../../hooks/useStableCallback";
import { cn } from "../../../lib/utils";
import { orchestrationEnvironment } from "../../../state/orchestration";
import { useEnvironmentQuery } from "../../../state/query";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../ui/empty";
import { RefreshIcon } from "../../ui/refresh-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { SwarmBoardFeed } from "./SwarmBoardFeed";
import { SwarmGraphCanvas } from "./SwarmGraphCanvas";
import { SwarmMembersList } from "./SwarmMembersList";
import { SwarmOverviewTab } from "./SwarmOverviewTab";

type SwarmTab = "graph" | "overview" | "board" | "members";

const SWARM_POLL_INTERVAL_MS = 1500;

export function SwarmPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly visible: boolean;
  readonly threadIsActive: boolean;
}) {
  const gt = useGT();
  const [activeTab, setActiveTab] = useState<SwarmTab>("graph");
  const [lastSeenSeq, setLastSeenSeq] = useState(0);

  const query = useEnvironmentQuery<OrchestrationV2GetNativeSwarmStateResult, unknown>(
    orchestrationEnvironment.nativeSwarmState({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );

  const data = query.data;
  const shouldPoll = props.visible && (Boolean(data?.active) || props.threadIsActive);
  const refreshStable = useStableCallback(query.refresh);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls native swarm state every 1500ms while panel is visible and swarm or thread is active
  useEffect(() => {
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      refreshStable();
    }, SWARM_POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [shouldPoll, refreshStable]);

  const members = data?.members ?? [];
  const posts = data?.posts ?? [];
  const activeMembersCount = members.filter((member) => member.state === "working").length;
  const latestPostSeq = posts.reduce((max, post) => Math.max(max, post.seq), 0);
  const unreadCount = posts.filter((post) => post.seq > lastSeenSeq).length;

  const markAllRead = () => {
    setLastSeenSeq((current) => Math.max(current, latestPostSeq));
  };

  const selectTab = (nextTab: SwarmTab) => {
    if (activeTab === "board" && nextTab !== "board") {
      markAllRead();
    }
    setActiveTab(nextTab);
  };

  const tabs: ReadonlyArray<{
    readonly id: SwarmTab;
    readonly label: string;
    readonly count?: number;
  }> = [
    { id: "graph", label: gt("Graph") },
    { id: "overview", label: gt("Overview") },
    {
      id: "board",
      label: gt("Board"),
      ...(activeTab !== "board" && unreadCount > 0 ? { count: unreadCount } : {}),
    },
    {
      id: "members",
      label: gt("Members"),
      ...(members.length > 0 ? { count: members.length } : {}),
    },
  ];

  const isEmpty =
    !query.isPending && query.error === null && members.length === 0 && posts.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border pb-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {data?.title || <T>Agent Swarm</T>}
            </h2>
            <Badge size="sm" variant={data?.active ? "info" : "secondary"}>
              {data?.active ? <T>Active</T> : <T>Idle</T>}
            </Badge>
            {members.length > 0 ? (
              <Badge size="sm" variant="outline">
                <T>
                  <Var>{activeMembersCount}</Var> active
                </T>
              </Badge>
            ) : null}
          </div>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={query.isPending}
                  aria-label={gt("Refresh swarm state")}
                  onClick={query.refresh}
                />
              }
            >
              <RefreshIcon size="xs" refreshing={query.isPending} />
            </TooltipTrigger>
            <TooltipPopup>
              <T>Refresh swarm state</T>
            </TooltipPopup>
          </Tooltip>
        </div>

        <nav
          role="tablist"
          aria-label={gt("Swarm views")}
          className="grid grid-cols-4 gap-1 rounded-lg bg-muted/50 p-1"
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectTab(tab.id)}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  selected
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="truncate">{tab.label}</span>
                {tab.count !== undefined ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-px font-mono text-3xs leading-none tabular-nums",
                      tab.id === "board"
                        ? "bg-info/15 text-info-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      {query.error !== null && data === null ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-xs text-destructive-foreground">
          {query.error}
        </div>
      ) : data === null && query.isPending ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <T>Loading swarm state…</T>
        </div>
      ) : isEmpty ? (
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <NetworkIcon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              <T>No swarm active yet</T>
            </EmptyTitle>
            <EmptyDescription>
              <T>
                Run <code>/swarm &lt;task&gt;</code> in this Antigravity thread to open the live
                agent topology, shared message board, overview, and replay animations.
              </T>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
          {activeTab === "graph" && data !== null ? <SwarmGraphCanvas state={data} /> : null}
          {activeTab === "overview" && data !== null ? (
            <SwarmOverviewTab overview={data.overview} posts={posts} members={members} />
          ) : null}
          {activeTab === "board" ? (
            <SwarmBoardFeed
              posts={posts}
              members={members}
              lastSeenSeq={lastSeenSeq}
              onMarkAllRead={markAllRead}
            />
          ) : null}
          {activeTab === "members" ? <SwarmMembersList members={members} /> : null}
        </div>
      )}
    </div>
  );
}
