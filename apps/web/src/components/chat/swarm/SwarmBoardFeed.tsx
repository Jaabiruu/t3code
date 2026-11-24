import type {
  OrchestrationV2NativeSwarmMember,
  OrchestrationV2NativeSwarmPost,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { CameraIcon, CheckCheckIcon, MessageSquareTextIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "../../../hooks/useSettings";
import { cn } from "../../../lib/utils";
import { formatDayAwareTimestamp } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { ScrollArea } from "../../ui/scroll-area";
import {
  extractSwarmPostTags,
  isCoordinatorMemberName,
  tokenizeMentionSegments,
} from "./swarmLayout";

function postKindBadge(kind: OrchestrationV2NativeSwarmPost["kind"]): string | null {
  switch (kind) {
    case "brief":
    case "question":
    case "result":
    case "system":
      return kind;
    case "update":
      return null;
  }
}

export function SwarmBoardFeed(props: {
  readonly posts: ReadonlyArray<OrchestrationV2NativeSwarmPost>;
  readonly members: ReadonlyArray<OrchestrationV2NativeSwarmMember>;
  readonly lastSeenSeq: number;
  readonly onMarkAllRead: () => void;
}) {
  const gt = useGT();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  const sortedPosts = [...props.posts].toSorted((left, right) => left.seq - right.seq);

  const filterNames: Array<string> = [];
  const seenNames = new Set<string>();
  for (const member of props.members) {
    if (!seenNames.has(member.name)) {
      seenNames.add(member.name);
      filterNames.push(member.name);
    }
  }
  for (const post of sortedPosts) {
    if (!seenNames.has(post.sender)) {
      seenNames.add(post.sender);
      filterNames.push(post.sender);
    }
  }

  const filteredPosts =
    selectedMember === null
      ? sortedPosts
      : sortedPosts.filter(
          (post) =>
            post.sender === selectedMember ||
            post.mentions.some(
              (mention) => mention === selectedMember || mention.toLowerCase() === "all",
            ),
        );

  const unreadCount = sortedPosts.filter((post) => post.seq > props.lastSeenSeq).length;
  const firstUnreadSeq = filteredPosts.find((post) => post.seq > props.lastSeenSeq)?.seq ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div
          role="group"
          aria-label={gt("Filter board by member")}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
        >
          <button
            type="button"
            aria-pressed={selectedMember === null}
            onClick={() => setSelectedMember(null)}
            className={cn(
              "cursor-pointer rounded-full border px-2 py-0.5 text-2xs font-medium transition-colors",
              selectedMember === null
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <T>
              All (<Var>{sortedPosts.length}</Var>)
            </T>
          </button>
          {filterNames.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={selectedMember === name}
              onClick={() => setSelectedMember((current) => (current === name ? null : name))}
              className={cn(
                "cursor-pointer rounded-full border px-2 py-0.5 text-2xs font-medium transition-colors",
                selectedMember === name
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {unreadCount > 0 ? (
          <Button size="micro" variant="ghost" onClick={props.onMarkAllRead}>
            <CheckCheckIcon />
            <span>
              <T>Mark read</T>
            </span>
          </Button>
        ) : null}
      </div>

      {filteredPosts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          <MessageSquareTextIcon aria-hidden className="size-4 opacity-70" />
          <span>
            <T>No board posts match this filter yet.</T>
          </span>
        </div>
      ) : (
        <ScrollArea scrollFade>
          <ol className="m-0 flex list-none flex-col gap-2 pe-1 pb-2 p-0">
            {filteredPosts.map((post) => {
              const tags = extractSwarmPostTags(post.content);
              const kindLabel = postKindBadge(post.kind);
              const segments = tokenizeMentionSegments(post.content);
              const showNewDivider = firstUnreadSeq !== null && post.seq === firstUnreadSeq;
              const isCoordinator = isCoordinatorMemberName(post.sender);

              return (
                <li key={post.id} id={`swarm-seq-${post.seq}`} className="flex flex-col gap-2">
                  {showNewDivider ? (
                    <div
                      role="separator"
                      aria-label={gt("Unread messages")}
                      className="flex items-center gap-2 py-0.5"
                    >
                      <span className="h-px flex-1 bg-info/50" />
                      <span className="text-3xs font-semibold uppercase tracking-wider text-info-foreground">
                        <T>New</T>
                      </span>
                      <span className="h-px flex-1 bg-info/50" />
                    </div>
                  ) : null}

                  <article
                    className={cn(
                      "flex flex-col gap-1.5 rounded-lg border bg-card p-2.5",
                      tags.isStall
                        ? "border-warning/50 bg-warning-surface"
                        : tags.isDone
                          ? "border-success/40"
                          : "border-border",
                    )}
                  >
                    <header className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={`#swarm-seq-${post.seq}`}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-3xs font-medium text-muted-foreground hover:text-foreground"
                        >
                          #{post.seq}
                        </a>
                        <Badge size="sm" variant={isCoordinator ? "info" : "outline"}>
                          {post.sender}
                        </Badge>
                        {kindLabel ? (
                          <Badge size="sm" variant="secondary">
                            {kindLabel}
                          </Badge>
                        ) : null}
                        {tags.isDone ? (
                          <Badge size="sm" variant="success">
                            done
                          </Badge>
                        ) : null}
                        {tags.isStall ? (
                          <Badge size="sm" variant="warning">
                            stall
                          </Badge>
                        ) : null}
                      </div>

                      {post.timestamp ? (
                        <time
                          dateTime={post.timestamp}
                          className="text-3xs text-muted-foreground tabular-nums"
                        >
                          {formatDayAwareTimestamp(post.timestamp, timestampFormat)}
                        </time>
                      ) : null}
                    </header>

                    <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                      {segments.map((segment) =>
                        segment.type === "mention" ? (
                          <span
                            key={`${post.id}-${segment.type}-${segment.start}`}
                            className="inline-block rounded bg-info/12 px-1 font-medium text-info-foreground"
                          >
                            {segment.value}
                          </span>
                        ) : (
                          <span key={`${post.id}-${segment.type}-${segment.start}`}>
                            {segment.value}
                          </span>
                        ),
                      )}
                    </div>

                    {post.screenshotPath ? (
                      <div className="flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-2xs text-muted-foreground">
                        <CameraIcon aria-hidden className="size-3 shrink-0" />
                        <span className="truncate font-medium text-foreground">
                          {post.screenshotCaption ?? post.screenshotPath}
                        </span>
                      </div>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      )}
    </div>
  );
}
