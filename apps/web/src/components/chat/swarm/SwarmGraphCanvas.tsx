import type {
  OrchestrationV2GetNativeSwarmStateResult,
  OrchestrationV2NativeSwarmMember,
  OrchestrationV2NativeSwarmPost,
} from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import { T, useGT, Var } from "gt-react";
import { PauseIcon, PlayIcon, RadioIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  computeSwarmGraphLayout,
  sliceSwarmReplayState,
  type SwarmGraphNodeLayout,
} from "./swarmLayout";

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 420;
const PLAYBACK_SPEEDS = [0.5, 1, 2] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

function memberInitials(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function truncatePill(value: string, max = 20): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function stateBadgeVariant(
  state: OrchestrationV2NativeSwarmMember["state"],
): "info" | "secondary" | "warning" | "outline" {
  switch (state) {
    case "working":
      return "info";
    case "waiting":
      return "secondary";
    case "stopped":
      return "warning";
    case "killed":
      return "outline";
  }
}

function edgeStrokeWidth(count: number): number {
  return Math.min(4.5, 1.5 + Math.max(0, count - 1) * 0.6);
}

function latestPostForMember(
  posts: ReadonlyArray<OrchestrationV2NativeSwarmPost>,
  memberName: string,
): OrchestrationV2NativeSwarmPost | null {
  for (let idx = posts.length - 1; idx >= 0; idx--) {
    const post = posts[idx]!;
    if (post.sender === memberName) return post;
  }
  return null;
}

export function SwarmGraphCanvas(props: {
  readonly state: OrchestrationV2GetNativeSwarmStateResult;
}) {
  const gt = useGT();
  const markerBaseId = useId().replaceAll(":", "");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const postsCount = props.state.posts.length;
  const maxStep = Math.max(0, postsCount - 1);

  const [followLive, setFollowLive] = useState(true);
  const [manualStep, setManualStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);

  const activeStep = followLive ? maxStep : Math.min(manualStep, maxStep);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- advances replay step on an interval timer while playback is active
  useEffect(() => {
    if (!isPlaying || postsCount <= 1) return;
    const intervalMs = Math.round(1200 / speed);
    const timer = setInterval(() => {
      setManualStep((prev) => {
        const next = prev + 1;
        if (next >= postsCount - 1) {
          setIsPlaying(false);
          setFollowLive(true);
          return postsCount - 1;
        }
        return next;
      });
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [isPlaying, postsCount, speed]);

  const replay = sliceSwarmReplayState(props.state, activeStep);
  const layout = computeSwarmGraphLayout(replay.members, CANVAS_WIDTH, CANVAS_HEIGHT, replay.edges);

  const selectedNode: SwarmGraphNodeLayout | null =
    selectedNodeName === null ? null : (layout.nodeByName.get(selectedNodeName) ?? null);
  const selectedLatestPost =
    selectedNode === null ? null : latestPostForMember(replay.visiblePosts, selectedNode.name);

  const idleArrowId = `swarm-arrow-idle-${markerBaseId}`;
  const activeArrowId = `swarm-arrow-active-${markerBaseId}`;

  const togglePlay = () => {
    if (postsCount <= 1) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const startStep = activeStep >= maxStep ? 0 : activeStep;
    setFollowLive(false);
    setManualStep(startStep);
    setIsPlaying(true);
  };

  const snapToLive = () => {
    setIsPlaying(false);
    setFollowLive(true);
    setManualStep(maxStep);
  };

  const handleScrub = (nextStep: number) => {
    setIsPlaying(false);
    const clamped = Math.max(0, Math.min(nextStep, maxStep));
    if (clamped >= maxStep) {
      setFollowLive(true);
      setManualStep(maxStep);
      return;
    }
    setFollowLive(false);
    setManualStep(clamped);
  };

  const stateBadgeLabel = (state: OrchestrationV2NativeSwarmMember["state"]) => {
    switch (state) {
      case "working":
        return gt("working");
      case "waiting":
        return gt("sleeping");
      case "stopped":
        return gt("stopped");
      case "killed":
        return gt("done");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="relative overflow-hidden rounded-lg border border-border bg-card">
        <svg
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          role="img"
          aria-label={gt("Swarm agent topology graph")}
          className="block h-auto max-h-[26rem] w-full select-none"
        >
          <defs>
            <marker
              id={idleArrowId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--muted-foreground)" opacity="0.7" />
            </marker>
            <marker
              id={activeArrowId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5.5"
              markerHeight="5.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--primary)" />
            </marker>
            <radialGradient id={`swarm-glow-${markerBaseId}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--info)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--info)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {layout.ringRadii.map((radius) => (
            <circle
              key={radius}
              cx={layout.center.x}
              cy={layout.center.y}
              r={radius}
              fill="none"
              stroke="var(--border)"
              strokeDasharray="4 6"
              strokeWidth={1}
              opacity={0.7}
            />
          ))}

          <g aria-hidden>
            {layout.edges.map((edge) => {
              const isLatestEdge =
                edge.from === replay.activeSender && replay.activeTargets.includes(edge.to);
              const isSelectedEdge =
                selectedNodeName !== null &&
                (edge.from === selectedNodeName || edge.to === selectedNodeName);
              const isActive = isLatestEdge || isSelectedEdge;
              const width = edgeStrokeWidth(edge.count);
              const showCountPill = edge.count > 1 || isLatestEdge;

              return (
                <g key={`${edge.from}->${edge.to}:${edge.path}`}>
                  {isLatestEdge ? (
                    <path
                      d={edge.path}
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth={width + 4}
                      strokeOpacity={0.14}
                      strokeLinecap="round"
                    />
                  ) : null}
                  <path
                    d={edge.path}
                    fill="none"
                    className={isLatestEdge ? "swarm-edge-flow" : undefined}
                    stroke={
                      isLatestEdge
                        ? "var(--primary)"
                        : isSelectedEdge
                          ? "var(--info)"
                          : "var(--muted-foreground)"
                    }
                    strokeWidth={width}
                    strokeOpacity={isActive ? 0.9 : 0.38}
                    strokeLinecap="round"
                    strokeDasharray={isLatestEdge ? "6 4" : undefined}
                    markerEnd={`url(#${isLatestEdge ? activeArrowId : idleArrowId})`}
                  />
                  {isLatestEdge && !reducedMotion ? (
                    <>
                      <circle r={4.2} fill="var(--primary)" stroke="var(--card)" strokeWidth={1.2}>
                        <animateMotion dur="1.4s" repeatCount="indefinite" path={edge.path} />
                      </circle>
                      {edge.count > 1 ? (
                        <circle r={2.8} fill="var(--info)" opacity={0.85}>
                          <animateMotion
                            dur="1.4s"
                            begin="0.7s"
                            repeatCount="indefinite"
                            path={edge.path}
                          />
                        </circle>
                      ) : null}
                    </>
                  ) : null}
                  {showCountPill ? (
                    <g transform={`translate(${edge.labelX}, ${edge.labelY})`}>
                      <rect
                        x={-10}
                        y={-8}
                        width={20}
                        height={16}
                        rx={8}
                        fill="var(--card)"
                        stroke={isLatestEdge ? "var(--primary)" : "var(--border)"}
                        strokeWidth={1}
                      />
                      <text
                        x={0}
                        y={3.5}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight={600}
                        fill={isLatestEdge ? "var(--primary)" : "var(--muted-foreground)"}
                      >
                        {edge.count}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g>
            {layout.nodes.map((node) => {
              const appeared = replay.appearedMemberNames.has(node.name);
              const state = node.member.state;
              const isWorking = appeared && state === "working";
              const isWaiting = appeared && state === "waiting";
              const isRetired = appeared && (state === "killed" || state === "stopped");
              const isSelected = selectedNodeName === node.name;
              const isSpeaker = replay.activeSender === node.name;
              const opacity = !appeared ? 0.3 : isRetired ? 0.45 : 1;

              const subPillText =
                isWorking && node.member.latestToolCall
                  ? truncatePill(node.member.latestToolCall, 22)
                  : isWaiting
                    ? gt("sleeping")
                    : state === "killed"
                      ? gt("done")
                      : state === "stopped"
                        ? gt("stopped")
                        : node.member.role
                          ? truncatePill(node.member.role, 22)
                          : null;

              const toggleSelect = () => {
                setSelectedNodeName((current) => (current === node.name ? null : node.name));
              };

              return (
                <g
                  key={node.name}
                  role="button"
                  tabIndex={0}
                  aria-label={gt("Inspect swarm member {name}", { name: node.name })}
                  aria-pressed={isSelected}
                  opacity={opacity}
                  className="cursor-pointer outline-none"
                  onClick={toggleSelect}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleSelect();
                    }
                  }}
                >
                  {isWorking ? (
                    <>
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.radius + 14}
                        fill={`url(#swarm-glow-${markerBaseId})`}
                        className="swarm-node-pulse"
                        style={{ transformBox: "fill-box", transformOrigin: "center" }}
                      />
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.radius + 7}
                        fill="none"
                        stroke={node.colorVar}
                        strokeWidth={1.6}
                        strokeDasharray="5 4"
                        strokeOpacity={0.85}
                        className="swarm-orbit-spin"
                        style={{ transformBox: "fill-box", transformOrigin: "center" }}
                      />
                    </>
                  ) : null}

                  {isSelected || isSpeaker ? (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius + 3.5}
                      fill="none"
                      stroke={isSelected ? "var(--ring)" : "var(--primary)"}
                      strokeWidth={isSelected ? 2 : 1.25}
                      strokeOpacity={isSelected ? 0.95 : 0.55}
                    />
                  ) : null}

                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill="var(--card)"
                    stroke={
                      isWorking
                        ? node.colorVar
                        : isWaiting
                          ? "var(--muted-foreground)"
                          : "var(--border)"
                    }
                    strokeWidth={node.isCoordinator ? 2.5 : 2}
                    strokeOpacity={isWaiting ? 0.65 : 1}
                  />

                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius - 4}
                    fill={isWorking ? node.colorVar : "var(--muted)"}
                    fillOpacity={isWorking ? 0.16 : 0.75}
                  />

                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    fontSize={node.isCoordinator ? 11 : 10}
                    fontWeight={600}
                    fill="var(--foreground)"
                  >
                    {memberInitials(node.name)}
                  </text>

                  <text
                    x={node.x}
                    y={node.y + node.radius + 15}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="var(--foreground)"
                  >
                    {truncatePill(node.name, 18)}
                  </text>

                  {subPillText !== null ? (
                    <text
                      x={node.x}
                      y={node.y + node.radius + 28}
                      textAnchor="middle"
                      fontSize={9.5}
                      fill={
                        isWorking && node.member.latestToolCall
                          ? "var(--info-foreground)"
                          : "var(--muted-foreground)"
                      }
                    >
                      {subPillText}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {postsCount > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={postsCount <= 1}
              aria-label={isPlaying ? gt("Pause replay") : gt("Play replay")}
              onClick={togglePlay}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
              <span>{isPlaying ? <T>Pause</T> : <T>Play</T>}</span>
            </Button>

            <div
              role="group"
              aria-label={gt("Replay speed")}
              className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5"
            >
              {PLAYBACK_SPEEDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={speed === option}
                  onClick={() => setSpeed(option)}
                  className={cn(
                    "cursor-pointer rounded-sm px-1.5 py-0.5 text-2xs font-medium transition-colors",
                    speed === option
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option}x
                </button>
              ))}
            </div>

            <input
              type="range"
              min={1}
              max={postsCount}
              value={activeStep + 1}
              aria-label={gt("Replay step scrubber")}
              onChange={(event) => handleScrub(Number(event.currentTarget.value) - 1)}
              className="h-1.5 min-w-24 flex-1 cursor-pointer accent-primary"
            />

            <span className="font-mono text-2xs text-muted-foreground tabular-nums">
              {activeStep + 1} / {postsCount}
            </span>

            <Button size="xs" variant={followLive ? "default" : "outline"} onClick={snapToLive}>
              <RadioIcon />
              <span>
                <T>Live</T>
              </span>
            </Button>
          </div>

          {replay.latestPost !== null ? (
            <div className="flex items-baseline gap-2 border-t border-border/60 pt-1.5 text-xs">
              <span className="shrink-0 font-mono text-2xs font-medium text-muted-foreground">
                #{replay.latestPost.seq}
              </span>
              <span className="shrink-0 font-medium text-foreground">
                {replay.latestPost.sender}
              </span>
              {replay.activeTargets.length > 0 ? (
                <span className="shrink-0 text-2xs text-info-foreground">
                  {`-> ${replay.activeTargets.map((target) => `@${target}`).join(", ")}`}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {replay.latestPost.content.replace(/\s+/g, " ").trim()}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedNode !== null ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold text-foreground">{selectedNode.name}</span>
              <Badge size="sm" variant={stateBadgeVariant(selectedNode.member.state)}>
                {stateBadgeLabel(selectedNode.member.state)}
              </Badge>
              {selectedNode.member.role ? (
                <span className="truncate text-muted-foreground">{selectedNode.member.role}</span>
              ) : null}
            </div>
            <Button
              size="icon-tiny"
              variant="ghost"
              aria-label={gt("Close member inspector")}
              onClick={() => setSelectedNodeName(null)}
            >
              <XIcon />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
            {selectedNode.member.model ? (
              <span>
                <T>
                  Model: <Var>{formatModelSlugName(selectedNode.member.model)}</Var>
                </T>
              </span>
            ) : null}
            {selectedNode.member.latestToolCall ? (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
                {selectedNode.member.latestToolCall}
              </code>
            ) : null}
          </div>

          {selectedLatestPost !== null ? (
            <p className="line-clamp-3 whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2 py-1.5 text-xs text-foreground">
              <span className="me-1.5 font-mono text-2xs text-muted-foreground">
                #{selectedLatestPost.seq}
              </span>
              {selectedLatestPost.content}
            </p>
          ) : (
            <p className="text-2xs text-muted-foreground">
              <T>No board posts from this member at this step.</T>
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
