import type {
  OrchestrationV2GetNativeSwarmStateResult,
  OrchestrationV2NativeSwarmMember,
  OrchestrationV2NativeSwarmPost,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  computeSwarmGraphLayout,
  extractSwarmPostTags,
  sliceSwarmReplayState,
  tokenizeMentionSegments,
} from "./swarmLayout";

function makeMember(
  name: string,
  state: OrchestrationV2NativeSwarmMember["state"] = "working",
): OrchestrationV2NativeSwarmMember {
  return {
    name,
    conversationId: null,
    role: name === "coordinator" ? "Coordinator" : `Worker ${name}`,
    model: "claude-sonnet-4-6",
    state,
    latestToolCall: null,
    updatedAt: null,
    steps: null,
  };
}

function makePost(
  seq: number,
  sender: string,
  mentions: ReadonlyArray<string>,
  content: string,
  kind: OrchestrationV2NativeSwarmPost["kind"] = "update",
): OrchestrationV2NativeSwarmPost {
  return {
    id: `post-${seq}`,
    seq,
    sender,
    mentions: [...mentions],
    content,
    timestamp: `2026-11-24T00:00:0${seq}Z`,
    kind,
    screenshotPath: null,
    screenshotCaption: null,
  };
}

describe("computeSwarmGraphLayout", () => {
  it("places coordinator at center and distributes outer members evenly on a single orbital ring", () => {
    const members = [
      makeMember("coordinator"),
      makeMember("contracts"),
      makeMember("backend"),
      makeMember("frontend"),
      makeMember("verifier"),
    ];

    const layout = computeSwarmGraphLayout(members, 640, 420);
    expect(layout.center).toEqual({ x: 320, y: 210 });
    expect(layout.ringRadii).toHaveLength(1);

    const coordinator = layout.nodeByName.get("coordinator");
    expect(coordinator).toBeDefined();
    expect(coordinator?.x).toBe(320);
    expect(coordinator?.y).toBe(210);
    expect(coordinator?.isCoordinator).toBe(true);

    const outer = layout.nodes.filter((node) => !node.isCoordinator);
    expect(outer).toHaveLength(4);

    // Every outer node stays at the exact orbital radius around (320, 210).
    const radius = layout.ringRadii[0]!;
    for (const node of outer) {
      const dist = Math.hypot(node.x - 320, node.y - 210);
      expect(Math.abs(dist - radius)).toBeLessThan(0.05);
    }

    // First outer node sits at 12 o'clock (-90deg).
    expect(outer[0]!.x).toBeCloseTo(320, 1);
    expect(outer[0]!.y).toBeCloseTo(210 - radius, 1);
  });

  it("uses two concentric orbital rings when more than 8 outer members exist", () => {
    const members = [
      makeMember("coordinator"),
      ...Array.from({ length: 10 }, (_, idx) => makeMember(`worker-${idx + 1}`)),
    ];

    const layout = computeSwarmGraphLayout(members, 640, 420);
    expect(layout.ringRadii).toHaveLength(2);
    expect(layout.nodes.filter((node) => node.ring === 1)).toHaveLength(5);
    expect(layout.nodes.filter((node) => node.ring === 2)).toHaveLength(5);
  });

  it("generates curved quadratic Bezier SVG paths with distinct opposite-direction curves and midpoints", () => {
    const members = [makeMember("coordinator"), makeMember("alpha"), makeMember("beta")];
    const layout = computeSwarmGraphLayout(members, 640, 420, [
      { from: "coordinator", to: "alpha", count: 2, lastSeq: 1, lastActivityAt: null },
      { from: "alpha", to: "coordinator", count: 1, lastSeq: 2, lastActivityAt: null },
      { from: "alpha", to: "beta", count: 1, lastSeq: 3, lastActivityAt: null },
    ]);

    expect(layout.edges).toHaveLength(3);
    const forward = layout.edges[0]!;
    const reverse = layout.edges[1]!;

    expect(forward.path).toMatch(/^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
    expect(reverse.path).toMatch(/^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
    // Opposite directions bow on opposite sides so they do not overlap.
    expect(forward.controlX).not.toBe(reverse.controlX);
    expect(Number.isFinite(forward.labelX)).toBe(true);
    expect(Number.isFinite(forward.labelY)).toBe(true);
  });
});

describe("sliceSwarmReplayState", () => {
  const sampleData: OrchestrationV2GetNativeSwarmStateResult = {
    active: false,
    title: "UI Build Swarm",
    overview: null,
    members: [
      makeMember("coordinator", "waiting"),
      makeMember("contracts", "killed"),
      makeMember("web-swarm", "working"),
    ],
    posts: [
      makePost(1, "coordinator", ["contracts"], "Start Stage 1 contracts.", "brief"),
      makePost(2, "contracts", ["coordinator"], "[done] Contracts finished.", "result"),
      makePost(3, "coordinator", ["all"], "Stage 2 update for everyone.", "update"),
    ],
    edges: [
      { from: "coordinator", to: "contracts", count: 2, lastSeq: 3, lastActivityAt: null },
      { from: "contracts", to: "coordinator", count: 1, lastSeq: 2, lastActivityAt: null },
      { from: "coordinator", to: "web-swarm", count: 1, lastSeq: 3, lastActivityAt: null },
    ],
    updatedAt: "2026-11-24T00:00:03Z",
  };

  it("reconstructs step-by-step edges, active sender/targets, and member states", () => {
    const step0 = sliceSwarmReplayState(sampleData, 0);
    expect(step0.stepIndex).toBe(0);
    expect(step0.isLiveStep).toBe(false);
    expect(step0.activeSender).toBe("coordinator");
    expect(step0.activeTargets).toEqual(["contracts"]);
    expect(step0.edges).toHaveLength(1);
    expect(step0.edges[0]?.count).toBe(1);
    expect(step0.appearedMemberNames.has("web-swarm")).toBe(false);
    expect(step0.members.find((m) => m.name === "contracts")?.state).toBe("working");

    const step1 = sliceSwarmReplayState(sampleData, 1);
    expect(step1.activeSender).toBe("contracts");
    expect(step1.activeTargets).toEqual(["coordinator"]);
    expect(step1.edges).toHaveLength(2);
    expect(step1.members.find((m) => m.name === "contracts")?.state).toBe("killed");

    const step2 = sliceSwarmReplayState(sampleData, 2);
    expect(step2.isLiveStep).toBe(true);
    expect(step2.activeSender).toBe("coordinator");
    // @all expands to non-self members.
    expect(step2.activeTargets).toEqual(["contracts", "web-swarm"]);
    expect(step2.edges.find((e) => e.from === "coordinator" && e.to === "contracts")?.count).toBe(
      2,
    );
    expect(step2.members).toEqual(sampleData.members);
  });

  it("handles empty posts cleanly", () => {
    const empty: OrchestrationV2GetNativeSwarmStateResult = {
      active: false,
      title: null,
      overview: null,
      members: [makeMember("coordinator")],
      posts: [],
      edges: [],
      updatedAt: null,
    };
    const slice = sliceSwarmReplayState(empty, 0);
    expect(slice.stepIndex).toBe(-1);
    expect(slice.totalSteps).toBe(0);
    expect(slice.isLiveStep).toBe(true);
    expect(slice.visiblePosts).toEqual([]);
  });
});

describe("mention and tag parsing helpers", () => {
  it("tokenizes @mention chips and detects [done]/[stall] tags", () => {
    expect(extractSwarmPostTags("@coordinator [done] Finished Stage 2.")).toEqual({
      isDone: true,
      isStall: false,
    });
    expect(extractSwarmPostTags("@web-swarm [stall] Waiting on response.")).toEqual({
      isDone: false,
      isStall: true,
    });

    expect(tokenizeMentionSegments("@coordinator check with @web-swarm and @all.")).toEqual([
      { type: "mention", value: "@coordinator", start: 0 },
      { type: "text", value: " check with ", start: 12 },
      { type: "mention", value: "@web-swarm", start: 24 },
      { type: "text", value: " and ", start: 34 },
      { type: "mention", value: "@all", start: 39 },
      { type: "text", value: ".", start: 43 },
    ]);
  });
});
