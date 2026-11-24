import type {
  OrchestrationV2GetNativeSwarmStateResult,
  OrchestrationV2NativeSwarmEdge,
  OrchestrationV2NativeSwarmMember,
  OrchestrationV2NativeSwarmMemberState,
  OrchestrationV2NativeSwarmPost,
} from "@t3tools/contracts";

export type SwarmNodeColorTone = "primary" | "info" | "success" | "warning" | "guest";

const WORKER_TONES: ReadonlyArray<SwarmNodeColorTone> = ["info", "success", "warning", "guest"];

const TONE_CSS_VAR: Record<SwarmNodeColorTone, string> = {
  primary: "var(--primary)",
  info: "var(--info)",
  success: "var(--success)",
  warning: "var(--warning)",
  guest: "var(--guest)",
};

export interface SwarmGraphNodeLayout {
  readonly member: OrchestrationV2NativeSwarmMember;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly isCoordinator: boolean;
  readonly ring: number;
  readonly angleRad: number;
  readonly tone: SwarmNodeColorTone;
  readonly colorVar: string;
}

export interface SwarmGraphEdgeGeometry {
  readonly from: string;
  readonly to: string;
  readonly path: string;
  readonly controlX: number;
  readonly controlY: number;
  readonly labelX: number;
  readonly labelY: number;
}

export type SwarmGraphEdgeLayout = SwarmGraphEdgeGeometry & OrchestrationV2NativeSwarmEdge;

export interface SwarmGraphLayoutResult {
  readonly width: number;
  readonly height: number;
  readonly center: { readonly x: number; readonly y: number };
  readonly ringRadii: ReadonlyArray<number>;
  readonly nodes: ReadonlyArray<SwarmGraphNodeLayout>;
  readonly nodeByName: ReadonlyMap<string, SwarmGraphNodeLayout>;
  readonly edges: ReadonlyArray<SwarmGraphEdgeLayout>;
  readonly edgeGeometry: (fromName: string, toName: string) => SwarmGraphEdgeGeometry | null;
}

export interface SwarmReplaySlice {
  readonly stepIndex: number;
  readonly totalSteps: number;
  readonly isLiveStep: boolean;
  readonly visiblePosts: ReadonlyArray<OrchestrationV2NativeSwarmPost>;
  readonly latestPost: OrchestrationV2NativeSwarmPost | null;
  readonly activeSender: string | null;
  readonly activeTargets: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<OrchestrationV2NativeSwarmEdge>;
  readonly members: ReadonlyArray<OrchestrationV2NativeSwarmMember>;
  readonly appearedMemberNames: ReadonlySet<string>;
}

export interface SwarmMentionSegment {
  readonly type: "text" | "mention";
  readonly value: string;
  readonly start: number;
}

export interface SwarmPostTags {
  readonly isDone: boolean;
  readonly isStall: boolean;
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isCoordinatorMemberName(name: string): boolean {
  return name.trim().toLowerCase() === "coordinator";
}

function computeSwarmEdgeGeometry(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  center: { readonly x: number; readonly y: number },
  fromName = "",
  toName = "",
): SwarmGraphEdgeGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 0.001) {
    const cx = roundCoord(from.x);
    const cy = roundCoord(from.y);
    return {
      from: fromName,
      to: toName,
      path: `M ${cx} ${cy} Q ${cx} ${cy} ${cx} ${cy}`,
      controlX: cx,
      controlY: cy,
      labelX: cx,
      labelY: cy,
    };
  }

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  // Perpendicular normal bends A->B and B->A on opposite sides so bidirectional traffic stays readable.
  const nx = -dy / distance;
  const ny = dx / distance;
  const fromIsCenter = Math.hypot(from.x - center.x, from.y - center.y) < 4;
  const toIsCenter = Math.hypot(to.x - center.x, to.y - center.y) < 4;

  let qx: number;
  let qy: number;
  if (fromIsCenter || toIsCenter) {
    const bend = Math.min(28, Math.max(14, distance * 0.16));
    qx = midX + nx * bend;
    qy = midY + ny * bend;
  } else {
    const centerPull = 0.24;
    const pulledX = midX * (1 - centerPull) + center.x * centerPull;
    const pulledY = midY * (1 - centerPull) + center.y * centerPull;
    const bend = Math.min(24, Math.max(12, distance * 0.1));
    qx = pulledX + nx * bend;
    qy = pulledY + ny * bend;
  }

  const x1 = roundCoord(from.x);
  const y1 = roundCoord(from.y);
  const x2 = roundCoord(to.x);
  const y2 = roundCoord(to.y);
  const controlX = roundCoord(qx);
  const controlY = roundCoord(qy);
  const labelX = roundCoord(0.25 * x1 + 0.5 * controlX + 0.25 * x2);
  const labelY = roundCoord(0.25 * y1 + 0.5 * controlY + 0.25 * y2);

  return {
    from: fromName,
    to: toName,
    path: `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`,
    controlX,
    controlY,
    labelX,
    labelY,
  };
}

export function computeSwarmGraphLayout(
  members: ReadonlyArray<OrchestrationV2NativeSwarmMember>,
  width: number,
  height: number,
  edges: ReadonlyArray<OrchestrationV2NativeSwarmEdge> = [],
): SwarmGraphLayoutResult {
  const cx = roundCoord(width / 2);
  const cy = roundCoord(height / 2);
  const center = { x: cx, y: cy };
  const minDimension = Math.max(120, Math.min(width, height));

  const coordinator = members.find((member) => isCoordinatorMemberName(member.name)) ?? null;
  const outerMembers = members.filter((member) => member !== coordinator);

  const nodes: Array<SwarmGraphNodeLayout> = [];
  const ringRadii: Array<number> = [];

  if (coordinator !== null) {
    nodes.push({
      member: coordinator,
      name: coordinator.name,
      x: cx,
      y: cy,
      radius: 26,
      isCoordinator: true,
      ring: 0,
      angleRad: 0,
      tone: "primary",
      colorVar: TONE_CSS_VAR.primary,
    });
  }

  if (outerMembers.length > 0) {
    const twoRings = outerMembers.length > 8;
    const innerCount = twoRings
      ? Math.min(8, Math.ceil(outerMembers.length / 2))
      : outerMembers.length;
    const innerRadius = roundCoord(minDimension * (twoRings ? 0.24 : 0.34));
    const outerRadius = roundCoord(minDimension * 0.4);
    ringRadii.push(innerRadius);
    if (twoRings) {
      ringRadii.push(outerRadius);
    }

    const innerMembers = outerMembers.slice(0, innerCount);
    const secondRingMembers = outerMembers.slice(innerCount);

    innerMembers.forEach((member, index) => {
      const angleRad = -Math.PI / 2 + (index / innerMembers.length) * Math.PI * 2;
      const tone = WORKER_TONES[index % WORKER_TONES.length] ?? "info";
      nodes.push({
        member,
        name: member.name,
        x: roundCoord(cx + Math.cos(angleRad) * innerRadius),
        y: roundCoord(cy + Math.sin(angleRad) * innerRadius),
        radius: 20,
        isCoordinator: false,
        ring: 1,
        angleRad,
        tone,
        colorVar: TONE_CSS_VAR[tone],
      });
    });

    secondRingMembers.forEach((member, index) => {
      const angleOffset = Math.PI / Math.max(1, secondRingMembers.length);
      const angleRad =
        -Math.PI / 2 + angleOffset + (index / secondRingMembers.length) * Math.PI * 2;
      const tone = WORKER_TONES[(innerCount + index) % WORKER_TONES.length] ?? "info";
      nodes.push({
        member,
        name: member.name,
        x: roundCoord(cx + Math.cos(angleRad) * outerRadius),
        y: roundCoord(cy + Math.sin(angleRad) * outerRadius),
        radius: 18,
        isCoordinator: false,
        ring: 2,
        angleRad,
        tone,
        colorVar: TONE_CSS_VAR[tone],
      });
    });
  }

  const nodeByName = new Map<string, SwarmGraphNodeLayout>();
  for (const node of nodes) {
    nodeByName.set(node.name, node);
  }

  const edgeGeometry = (fromName: string, toName: string): SwarmGraphEdgeGeometry | null => {
    const fromNode = nodeByName.get(fromName);
    const toNode = nodeByName.get(toName);
    if (!fromNode || !toNode || fromName === toName) return null;
    return computeSwarmEdgeGeometry(fromNode, toNode, center, fromName, toName);
  };

  const laidOutEdges: Array<SwarmGraphEdgeLayout> = [];
  for (const edge of edges) {
    const geometry = edgeGeometry(edge.from, edge.to);
    if (geometry === null) continue;
    laidOutEdges.push({
      ...geometry,
      ...edge,
    });
  }

  return {
    width,
    height,
    center,
    ringRadii,
    nodes,
    nodeByName,
    edges: laidOutEdges,
    edgeGeometry,
  };
}

function resolveMentionTargets(
  post: OrchestrationV2NativeSwarmPost,
  knownMemberNames: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const canonicalByLower = new Map<string, string>();
  for (const name of knownMemberNames) {
    canonicalByLower.set(name.toLowerCase(), name);
  }

  const targets: Array<string> = [];
  const seen = new Set<string>();
  const senderLower = post.sender.toLowerCase();

  for (const rawMention of post.mentions) {
    const normalized = rawMention.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === "all") {
      for (const memberName of knownMemberNames) {
        if (memberName.toLowerCase() === senderLower) continue;
        if (seen.has(memberName)) continue;
        seen.add(memberName);
        targets.push(memberName);
      }
      continue;
    }
    if (normalized === senderLower) continue;
    const resolved = canonicalByLower.get(normalized) ?? rawMention.trim();
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    targets.push(resolved);
  }

  return targets;
}

export function extractSwarmPostTags(content: string): SwarmPostTags {
  const isDone = /(?:^|\s)\[done\](?=$|\s|[.,:;!?])/i.test(content);
  const isStall = /(?:^|\s)\[stall\](?=$|\s|[.,:;!?])/i.test(content);
  return { isDone, isStall };
}

export function tokenizeMentionSegments(content: string): ReadonlyArray<SwarmMentionSegment> {
  const pattern = /(^|[\s(])(@[a-z0-9][a-z0-9_-]{0,23})/gi;
  const segments: Array<SwarmMentionSegment> = [];
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    const prefix = match[1] ?? "";
    const mention = match[2] ?? "";
    const mentionStart = matchIndex + prefix.length;

    if (mentionStart > cursor) {
      segments.push({ type: "text", value: content.slice(cursor, mentionStart), start: cursor });
    }
    if (mention.length > 0) {
      segments.push({ type: "mention", value: mention, start: mentionStart });
    }
    cursor = mentionStart + mention.length;
  }

  if (cursor < content.length) {
    segments.push({ type: "text", value: content.slice(cursor), start: cursor });
  }

  return segments;
}

export function sliceSwarmReplayState(
  data: OrchestrationV2GetNativeSwarmStateResult,
  stepIndex: number,
): SwarmReplaySlice {
  const sortedPosts = [...data.posts].toSorted((left, right) => left.seq - right.seq);
  const knownNames = data.members.map((member) => member.name);

  if (sortedPosts.length === 0) {
    return {
      stepIndex: -1,
      totalSteps: 0,
      isLiveStep: true,
      visiblePosts: [],
      latestPost: null,
      activeSender: null,
      activeTargets: [],
      edges: data.edges,
      members: data.members,
      appearedMemberNames: new Set(knownNames),
    };
  }

  const clampedIndex = Math.max(0, Math.min(stepIndex, sortedPosts.length - 1));
  const isLiveStep = clampedIndex === sortedPosts.length - 1;
  const visiblePosts = sortedPosts.slice(0, clampedIndex + 1);
  const latestPost = visiblePosts.at(-1) ?? null;

  const edgeByKey = new Map<string, OrchestrationV2NativeSwarmEdge>();
  const appearedMemberNames = new Set<string>();
  const lastPostBySender = new Map<string, OrchestrationV2NativeSwarmPost>();
  const lastMentionSeqByMember = new Map<string, number>();

  for (const member of data.members) {
    if (isCoordinatorMemberName(member.name)) {
      appearedMemberNames.add(member.name);
    }
  }

  for (const post of visiblePosts) {
    appearedMemberNames.add(post.sender);
    lastPostBySender.set(post.sender, post);
    const targets = resolveMentionTargets(post, knownNames);
    for (const target of targets) {
      appearedMemberNames.add(target);
      lastMentionSeqByMember.set(target, post.seq);
      const edgeKey = `${post.sender}\0${target}`;
      const existing = edgeByKey.get(edgeKey);
      edgeByKey.set(edgeKey, {
        from: post.sender,
        to: target,
        count: (existing?.count ?? 0) + 1,
        lastSeq: post.seq,
        lastActivityAt: post.timestamp,
      });
    }
  }

  if (isLiveStep) {
    for (const edge of data.edges) {
      if (edge.from === edge.to) continue;
      const edgeKey = `${edge.from}\0${edge.to}`;
      if (!edgeByKey.has(edgeKey)) {
        edgeByKey.set(edgeKey, edge);
      }
    }
  }

  const activeSender = latestPost?.sender ?? null;
  const activeTargets = latestPost ? resolveMentionTargets(latestPost, knownNames) : [];

  if (isLiveStep) {
    return {
      stepIndex: clampedIndex,
      totalSteps: sortedPosts.length,
      isLiveStep: true,
      visiblePosts,
      latestPost,
      activeSender,
      activeTargets,
      edges: [...edgeByKey.values()],
      members: data.members,
      appearedMemberNames: new Set(knownNames),
    };
  }

  const latestOverallSeqBySender = new Map<string, number>();
  for (const post of sortedPosts) {
    latestOverallSeqBySender.set(post.sender, post.seq);
  }

  const members: Array<OrchestrationV2NativeSwarmMember> = data.members.map((member) => {
    const appeared = appearedMemberNames.has(member.name);
    if (!appeared) {
      return { ...member, state: "waiting" as OrchestrationV2NativeSwarmMemberState };
    }

    const lastSent = lastPostBySender.get(member.name);
    const lastMentionSeq = lastMentionSeqByMember.get(member.name) ?? -1;
    const isActiveNow = member.name === activeSender || activeTargets.includes(member.name);

    let state: OrchestrationV2NativeSwarmMemberState;
    if (lastSent !== undefined) {
      const tags = extractSwarmPostTags(lastSent.content);
      const finishedInPost = tags.isDone || lastSent.kind === "result";
      if (finishedInPost && lastMentionSeq <= lastSent.seq) {
        const isFinalPostForMember = latestOverallSeqBySender.get(member.name) === lastSent.seq;
        state =
          isFinalPostForMember && (member.state === "killed" || member.state === "stopped")
            ? member.state
            : "waiting";
      } else {
        state = "working";
      }
    } else if (isActiveNow || isCoordinatorMemberName(member.name)) {
      state = "working";
    } else {
      state = "working";
    }

    return {
      ...member,
      state,
    };
  });

  return {
    stepIndex: clampedIndex,
    totalSteps: sortedPosts.length,
    isLiveStep: false,
    visiblePosts,
    latestPost,
    activeSender,
    activeTargets,
    edges: [...edgeByKey.values()],
    members,
    appearedMemberNames,
  };
}
