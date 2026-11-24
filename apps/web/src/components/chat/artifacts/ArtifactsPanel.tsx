import { useEffect, useEffectEvent, useState } from "react";
import type {
  EnvironmentId,
  OrchestrationV2GetNativeArtifactsResult,
  OrchestrationV2NativeArtifact,
  OrchestrationV2NativeArtifactKind,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";
import { CheckIcon, CopyIcon, DownloadIcon, FileTextIcon } from "lucide-react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Spinner } from "~/components/ui/spinner";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { downloadPlanAsTextFile, normalizePlanMarkdownForExport } from "~/proposedPlan";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { ArtifactReviewBar } from "./ArtifactReviewBar";

const ARTIFACT_POLL_INTERVAL_MS = 2_000;

const ARTIFACT_KIND_LABELS: Record<OrchestrationV2NativeArtifactKind, string> = {
  plan: msg("Plan", { $context: "badge, noun" }),
  walkthrough: msg("Walkthrough", { $context: "badge, noun" }),
  other: msg("Artifact", { $context: "badge, noun" }),
};

const ARTIFACT_KIND_BADGE_VARIANT: Record<
  OrchestrationV2NativeArtifactKind,
  "info" | "success" | "secondary"
> = {
  plan: "info",
  walkthrough: "success",
  other: "secondary",
};

function artifactDisplayTitle(artifact: OrchestrationV2NativeArtifact): string {
  const title = artifact.title.trim();
  return title.length > 0 ? title : artifact.fileName;
}

function artifactDownloadFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (trimmed.length === 0) return "artifact.md";
  return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
}

export interface ArtifactsPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | undefined;
  readonly visible: boolean;
  readonly threadIsActive: boolean;
  readonly onSendFeedback: (text: string) => void;
  readonly onInsertDraft: (text: string) => void;
}

export function ArtifactsPanel(props: ArtifactsPanelProps) {
  const gt = useGT();
  const messages = useMessages();
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  const query = useEnvironmentQuery<OrchestrationV2GetNativeArtifactsResult, unknown>(
    orchestrationEnvironment.nativeArtifacts({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
    messages,
  );

  const pollArtifacts = useEffectEvent(() => {
    query.refresh();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls native artifacts every 2s while the panel is visible and the thread is active
  useEffect(() => {
    if (!props.visible || !props.threadIsActive) return;
    const timer = window.setInterval(() => {
      pollArtifacts();
    }, ARTIFACT_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [props.visible, props.threadIsActive]);

  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "artifact",
      unavailableMessage: msg("Clipboard API is unavailable while copying artifact."),
      failureMessage: msg("Failed to copy artifact to the clipboard."),
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not copy artifact"),
          description:
            error instanceof Error ? error.message : gt("An error occurred while copying."),
        }),
      );
    },
  });

  const artifacts = query.data?.artifacts ?? [];
  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === selectedArtifactId) ??
    artifacts.find((artifact) => artifact.requestFeedback) ??
    artifacts[0] ??
    null;

  if (query.data === null && query.error !== null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              <T>Could not load artifacts</T>
            </EmptyTitle>
            <EmptyDescription>{query.error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" disabled={query.isPending} onClick={query.refresh}>
              <RefreshIcon refreshing={query.isPending} />
              <T>Retry</T>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (query.data === null && query.isPending) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner tone="muted" />
        <span>
          <T>Loading artifacts…</T>
        </span>
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              <T>No artifacts yet</T>
            </EmptyTitle>
            <EmptyDescription>
              <T>
                Antigravity plans, walkthroughs, and markdown artifacts created in this thread will
                appear here for review.
              </T>
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" disabled={query.isPending} onClick={query.refresh}>
              <RefreshIcon refreshing={query.isPending} />
              <T>Refresh</T>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const handleCopyArtifact = () => {
    if (!selectedArtifact) return;
    copyToClipboard(normalizePlanMarkdownForExport(selectedArtifact.content), undefined);
  };

  const handleDownloadArtifact = () => {
    if (!selectedArtifact) return;
    downloadPlanAsTextFile(
      artifactDownloadFileName(selectedArtifact.fileName),
      normalizePlanMarkdownForExport(selectedArtifact.content),
    );
  };

  return (
    <div className="@container/artifacts flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="truncate text-sm font-medium text-foreground">
            <T>Artifacts</T>
          </h2>
          <Badge size="sm" variant="secondary">
            {artifacts.length}
          </Badge>
        </div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={query.isPending}
          onClick={query.refresh}
        >
          <RefreshIcon refreshing={query.isPending} />
          <T>Refresh</T>
        </Button>
      </div>

      {query.error !== null ? (
        <div
          role="alert"
          className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive-foreground sm:px-4"
        >
          {query.error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col @min-[44rem]/artifacts:grid @min-[44rem]/artifacts:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="max-h-48 shrink-0 overflow-y-auto border-b border-border/60 bg-muted/10 @min-[44rem]/artifacts:max-h-none @min-[44rem]/artifacts:border-r @min-[44rem]/artifacts:border-b-0">
          <div className="divide-y divide-border/50">
            {artifacts.map((artifact) => {
              const isSelected = selectedArtifact?.id === artifact.id;
              const title = artifactDisplayTitle(artifact);
              return (
                <button
                  key={artifact.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedArtifactId(artifact.id)}
                  className={cn(
                    "flex w-full cursor-pointer flex-col gap-1.5 px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    isSelected ? "bg-foreground/[0.06]" : "hover:bg-muted/25",
                  )}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-medium text-foreground">
                      {title}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge size="sm" variant={ARTIFACT_KIND_BADGE_VARIANT[artifact.kind]}>
                      {messages(ARTIFACT_KIND_LABELS[artifact.kind])}
                    </Badge>
                    {artifact.requestFeedback ? (
                      <Badge size="sm" variant="warning">
                        <T>Needs review</T>
                      </Badge>
                    ) : null}
                  </div>
                  {artifact.summary ? (
                    <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {artifact.summary}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {selectedArtifact ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <h3 className="truncate text-sm font-medium text-foreground">
                    {artifactDisplayTitle(selectedArtifact)}
                  </h3>
                  <Badge size="sm" variant={ARTIFACT_KIND_BADGE_VARIANT[selectedArtifact.kind]}>
                    {messages(ARTIFACT_KIND_LABELS[selectedArtifact.kind])}
                  </Badge>
                  {selectedArtifact.requestFeedback ? (
                    <Badge size="sm" variant="warning">
                      <T>Needs review</T>
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
                  {selectedArtifact.fileName}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button type="button" size="xs" variant="outline" onClick={handleCopyArtifact}>
                  {isCopied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
                  {isCopied ? gt("Copied!") : gt("Copy")}
                </Button>
                <Button type="button" size="xs" variant="outline" onClick={handleDownloadArtifact}>
                  <DownloadIcon aria-hidden="true" />
                  <T>Download .md</T>
                </Button>
              </div>
            </div>

            {selectedArtifact.truncated ? (
              <div
                role="note"
                className="shrink-0 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning-foreground"
              >
                <T>
                  This artifact was truncated for display because it exceeds the preview size limit.
                </T>
              </div>
            ) : null}

            <ScrollArea scrollFade className="min-h-0 flex-1">
              <div className="p-4">
                {selectedArtifact.content.trim().length > 0 ? (
                  <ChatMarkdown
                    text={selectedArtifact.content}
                    cwd={props.cwd}
                    environmentId={props.environmentId}
                    threadRef={props.threadRef}
                    isStreaming={false}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    <T>This artifact has no content yet.</T>
                  </p>
                )}
              </div>
            </ScrollArea>

            <ArtifactReviewBar
              key={`${props.threadId}:${selectedArtifact.id}`}
              artifact={selectedArtifact}
              onSendFeedback={props.onSendFeedback}
              onInsertDraft={props.onInsertDraft}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
