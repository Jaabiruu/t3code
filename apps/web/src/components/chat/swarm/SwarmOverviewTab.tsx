import type {
  OrchestrationV2NativeSwarmMember,
  OrchestrationV2NativeSwarmOverview,
  OrchestrationV2NativeSwarmPost,
} from "@t3tools/contracts";
import { T } from "gt-react";
import { CameraIcon, LayersIcon, ListChecksIcon, TargetIcon } from "lucide-react";

import { useClientSettings } from "../../../hooks/useSettings";
import { formatShortTimestamp } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { ScrollArea } from "../../ui/scroll-area";

export function SwarmOverviewTab(props: {
  readonly overview: OrchestrationV2NativeSwarmOverview | null;
  readonly posts: ReadonlyArray<OrchestrationV2NativeSwarmPost>;
  readonly members: ReadonlyArray<OrchestrationV2NativeSwarmMember>;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { overview } = props;
  const memberByName = new Map(props.members.map((member) => [member.name, member]));
  const taskEntries = overview ? Object.entries(overview.tasks) : [];
  const screenshotPosts = props.posts.filter((post) => post.screenshotPath !== null);

  return (
    <ScrollArea scrollFade>
      <div className="flex flex-col gap-3 pe-1 pb-2">
        {overview !== null ? (
          <>
            {overview.goalTitle || overview.goalLine ? (
              <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <TargetIcon aria-hidden className="size-3.5 text-primary" />
                  <span>
                    <T>Swarm Goal</T>
                  </span>
                </div>
                {overview.goalTitle ? (
                  <h3 className="text-sm font-semibold text-foreground">{overview.goalTitle}</h3>
                ) : null}
                {overview.goalLine ? (
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                    {overview.goalLine}
                  </p>
                ) : null}
              </section>
            ) : null}

            {overview.threads.length > 0 ? (
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <LayersIcon aria-hidden className="size-3.5" />
                    <span>
                      <T>Outcome Threads</T>
                    </span>
                  </div>
                  <Badge size="sm" variant="secondary">
                    {overview.threads.length}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {overview.threads.map((thread) => (
                    <article
                      key={thread.id}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-semibold text-foreground">{thread.title}</h4>
                        <span className="shrink-0 font-mono text-3xs text-muted-foreground">
                          {thread.id}
                        </span>
                      </div>
                      {thread.goal ? (
                        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                          {thread.goal}
                        </p>
                      ) : null}
                      {thread.tasks.length > 0 ? (
                        <ul className="m-0 flex list-none flex-col gap-1 border-t border-border/60 pt-2 p-0">
                          {thread.tasks.map((taskKey) => {
                            const taskSummary = overview.tasks[taskKey];
                            const member = memberByName.get(taskKey);
                            return (
                              <li
                                key={taskKey}
                                className="flex items-baseline gap-2 text-xs text-foreground"
                              >
                                <Badge
                                  size="sm"
                                  variant={member?.state === "working" ? "info" : "outline"}
                                >
                                  {taskKey}
                                </Badge>
                                {taskSummary ? (
                                  <span className="min-w-0 flex-1 break-words text-muted-foreground">
                                    {taskSummary}
                                  </span>
                                ) : member?.role ? (
                                  <span className="min-w-0 flex-1 break-words text-muted-foreground">
                                    {member.role}
                                  </span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {taskEntries.length > 0 && overview.threads.length === 0 ? (
              <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ListChecksIcon aria-hidden className="size-3.5" />
                  <span>
                    <T>Worker Tasks</T>
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {taskEntries.map(([workerName, description]) => (
                    <li key={workerName} className="flex items-baseline gap-2 text-xs">
                      <Badge size="sm" variant="outline">
                        {workerName}
                      </Badge>
                      <span className="min-w-0 flex-1 break-words text-muted-foreground">
                        {description}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <section className="rounded-lg border border-dashed border-border bg-card/60 p-3 text-xs text-muted-foreground">
            <T>
              No structured plan overview recorded yet. Worker briefs and board posts appear as the
              coordinator spawns tasks.
            </T>
          </section>
        )}

        {screenshotPosts.length > 0 ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CameraIcon aria-hidden className="size-3.5" />
                <span>
                  <T>Screenshot Timeline</T>
                </span>
              </div>
              <Badge size="sm" variant="secondary">
                {screenshotPosts.length}
              </Badge>
            </div>

            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {screenshotPosts.map((post) => (
                <li
                  key={post.id}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-2xs font-medium text-muted-foreground">
                        #{post.seq}
                      </span>
                      <Badge size="sm" variant="outline">
                        {post.sender}
                      </Badge>
                    </div>
                    {post.timestamp ? (
                      <span className="text-3xs text-muted-foreground">
                        {formatShortTimestamp(post.timestamp, timestampFormat)}
                      </span>
                    ) : null}
                  </div>
                  {post.screenshotCaption ? (
                    <p className="font-medium text-foreground">{post.screenshotCaption}</p>
                  ) : null}
                  <code className="break-all rounded bg-muted/60 px-1.5 py-1 font-mono text-2xs text-muted-foreground">
                    {post.screenshotPath}
                  </code>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </ScrollArea>
  );
}
