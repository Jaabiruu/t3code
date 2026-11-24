// @effect-diagnostics nodeBuiltinImport:off -- Bounded O_NOFOLLOW reads against the managed profile root.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type {
  OrchestrationV2GetNativeSwarmStateResult,
  OrchestrationV2NativeChildStep,
  OrchestrationV2NativeSwarmEdge,
  OrchestrationV2NativeSwarmMember,
  OrchestrationV2NativeSwarmMemberState,
  OrchestrationV2NativeSwarmOverview,
  OrchestrationV2NativeSwarmOverviewThread,
  OrchestrationV2NativeSwarmPost,
  OrchestrationV2NativeSwarmPostKind,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";
import { extractAntigravitySwarmAction } from "./AntigravityProtocol.ts";

const NATIVE_ID = /^[A-Za-z0-9-]{1,64}$/;
const MENTION_PATTERN = /(^|[\s(])@([a-z0-9][a-z0-9_-]{0,23})/gi;
const SCREENSHOT_LINE_PATTERN = /^Screenshot:\s*([^\r\n|]+?)(?:\s*\|\s*([^\r\n]*))?$/im;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_BOARD_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 128 * 1024;
const MAX_SUBAGENT_FILES = 64;
const MAX_MESSAGE_FILES = 256;
const MAX_POSTS = 500;
const STEP_TEXT_CAP = 4_000;
const TOOL_INPUT_CAP = 1_000;
const CONTENT_CAP = 16_000;

export const EMPTY_ANTIGRAVITY_SWARM_STATE: OrchestrationV2GetNativeSwarmStateResult = {
  active: false,
  title: null,
  overview: null,
  members: [],
  posts: [],
  edges: [],
  updatedAt: null,
};

export interface RecordedSwarmToolRecord {
  readonly id?: string;
  readonly toolName?: string | null;
  readonly title?: string | null;
  readonly kind?: string | null;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly timestamp?: string | null;
  readonly sender?: string | null;
}

const TranscriptLine = Schema.Struct({
  step_index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  type: Schema.String,
  status: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  tool_calls: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, args: Schema.optional(Schema.Unknown) })),
  ),
});
const decodeTranscriptLine = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptLine));
const decodeArgument = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const capText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  Predicate.isObject(value) ? value : undefined;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function parseIsoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const dt = DateTime.make(ms);
    return Option.isSome(dt) ? DateTime.formatIso(dt.value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const dt = DateTime.make(trimmed);
  return Option.isSome(dt) ? DateTime.formatIso(dt.value) : null;
}

function toEpochMs(value: string): number {
  const dt = DateTime.make(value);
  return Option.isSome(dt) ? DateTime.toEpochMillis(dt.value) : NaN;
}

function latestTimestamp(values: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const candidate of values) {
    if (!candidate) continue;
    const ms = toEpochMs(candidate);
    if (!Number.isNaN(ms) && ms >= bestMs) {
      bestMs = ms;
      best = parseIsoTimestamp(candidate);
    }
  }
  return best;
}

function normalizeMemberState(value: unknown): OrchestrationV2NativeSwarmMemberState {
  if (typeof value !== "string") return "waiting";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "working" ||
    normalized === "running" ||
    normalized === "active" ||
    normalized === "in_progress" ||
    normalized.endsWith("_running") ||
    normalized.endsWith("_working")
  ) {
    return "working";
  }
  if (
    normalized === "killed" ||
    normalized === "terminated" ||
    normalized === "cancelled" ||
    normalized.endsWith("_killed")
  ) {
    return "killed";
  }
  if (
    normalized === "stopped" ||
    normalized === "completed" ||
    normalized === "done" ||
    normalized === "exited" ||
    normalized === "failed" ||
    normalized.endsWith("_stopped") ||
    normalized.endsWith("_completed")
  ) {
    return "stopped";
  }
  return "waiting";
}

function normalizePostKind(
  explicitKind: unknown,
  sender: string,
  content: string,
): OrchestrationV2NativeSwarmPostKind {
  if (
    explicitKind === "brief" ||
    explicitKind === "update" ||
    explicitKind === "question" ||
    explicitKind === "result" ||
    explicitKind === "system"
  ) {
    return explicitKind;
  }
  if (sender === "system") return "system";
  if (/\[done\]/i.test(content)) return "result";
  if (/\?\s*$/.test(content.trim()) || /\bquestion\b/i.test(content)) return "question";
  return "update";
}

export function extractSwarmMentions(content: string): ReadonlyArray<string> {
  const mentions: string[] = [];
  const seen = new Set<string>();
  const regex = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const handle = match[2]?.toLowerCase();
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    mentions.push(handle);
  }
  return mentions;
}

function sanitizeScreenshotPath(rawPath: string | null): string | null {
  if (!rawPath) return null;
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.includes("\0")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) return null;
  const ext = NodePath.posix.extname(segments.at(-1) ?? "").toLowerCase();
  if (ext.length > 0 && !IMAGE_EXTENSIONS.has(ext)) return null;
  return segments.join("/");
}

export function extractSwarmScreenshot(content: string): {
  readonly screenshotPath: string | null;
  readonly screenshotCaption: string | null;
} {
  const match = SCREENSHOT_LINE_PATTERN.exec(content);
  if (!match?.[1]) {
    return { screenshotPath: null, screenshotCaption: null };
  }
  const screenshotPath = sanitizeScreenshotPath(match[1]);
  const caption = match[2]?.trim() || null;
  return {
    screenshotPath,
    screenshotCaption: screenshotPath ? caption : null,
  };
}

async function readManagedNoFollowText(
  profileRoot: string,
  segments: ReadonlyArray<string>,
  maxBytes: number,
): Promise<{ readonly text: string; readonly mtimeIso: string } | undefined> {
  const target = await antigravityManagedPath(profileRoot, segments, "file");
  if (!target) return undefined;
  const handle = await NodeFSP.open(
    target.path,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  ).catch(() => undefined);
  if (!handle) return undefined;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) return undefined;
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return {
      text: buffer.toString("utf8", 0, offset),
      mtimeIso: stat.mtime.toISOString(),
    };
  } catch {
    return undefined;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readManagedNoFollowTail(
  profileRoot: string,
  segments: ReadonlyArray<string>,
  byteCap: number,
): Promise<{ readonly text: string; readonly mtimeIso: string } | undefined> {
  const target = await antigravityManagedPath(profileRoot, segments, "file");
  if (!target) return undefined;
  const handle = await NodeFSP.open(
    target.path,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  ).catch(() => undefined);
  if (!handle) return undefined;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return undefined;
    const tailStart = Math.max(0, stat.size - byteCap);
    const readStart = Math.max(0, tailStart - 1);
    const buffer = Buffer.alloc(stat.size - readStart);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, readStart);
    const bytes = buffer.subarray(0, bytesRead);
    let lineStart = 0;
    if (tailStart > 0) {
      const newline = bytes.indexOf(0x0a);
      if (newline === -1) return { text: "", mtimeIso: stat.mtime.toISOString() };
      lineStart = newline + 1;
    }
    return {
      text: bytes.toString("utf8", lineStart),
      mtimeIso: stat.mtime.toISOString(),
    };
  } catch {
    return undefined;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function parseJsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseTranscriptSteps(contents: string): ReadonlyArray<OrchestrationV2NativeChildStep> {
  const toolArguments = (args: unknown) =>
    Predicate.isObject(args)
      ? Object.fromEntries(
          Object.entries(args).map(([key, value]) => [
            key,
            typeof value === "string"
              ? Option.getOrElse(decodeArgument(value), () => value)
              : value,
          ]),
        )
      : (args ?? {});

  return contents.split("\n").flatMap((line) =>
    Option.match(decodeTranscriptLine(line), {
      onNone: () => [],
      onSome: (step) => [
        {
          index: step.step_index,
          type: step.type,
          status: step.status ?? null,
          text:
            step.content !== undefined || step.error !== undefined
              ? capText(step.content ?? step.error ?? "", STEP_TEXT_CAP)
              : null,
          toolCalls: (step.tool_calls ?? []).map((call) => ({
            name: call.name,
            input: capText(JSON.stringify(toolArguments(call.args)), TOOL_INPUT_CAP),
          })),
        },
      ],
    }),
  );
}

function parseOverview(raw: unknown): {
  readonly title: string | null;
  readonly overview: OrchestrationV2NativeSwarmOverview | null;
} {
  const root = asRecord(raw);
  if (!root) return { title: null, overview: null };
  const nested = asRecord(root.overview) ?? root;
  const goalRecord = asRecord(nested.goal);

  const title =
    asNonEmptyString(root.title) ??
    asNonEmptyString(root.swarmTitle) ??
    asNonEmptyString(root.swarm_title) ??
    asNonEmptyString(root.name);
  const goalTitle =
    asNonEmptyString(nested.goalTitle) ??
    asNonEmptyString(nested.goal_title) ??
    asNonEmptyString(goalRecord?.title) ??
    asNonEmptyString(typeof nested.goal === "string" ? nested.goal : undefined) ??
    title;
  const goalLine =
    asNonEmptyString(nested.goalLine) ??
    asNonEmptyString(nested.goal_line) ??
    asNonEmptyString(goalRecord?.line) ??
    asNonEmptyString(goalRecord?.description) ??
    asNonEmptyString(nested.goalSummary) ??
    asNonEmptyString(nested.summary);

  const tasks: Record<string, string> = {};
  if (Array.isArray(nested.tasks)) {
    for (let i = 0; i < nested.tasks.length; i += 1) {
      const entry = nested.tasks[i];
      if (typeof entry === "string" && entry.trim()) {
        tasks[`task-${i + 1}`] = entry.trim();
        continue;
      }
      const obj = asRecord(entry);
      if (!obj) continue;
      const key = asNonEmptyString(obj.id) ?? asNonEmptyString(obj.key) ?? `task-${i + 1}`;
      const label =
        asNonEmptyString(obj.title) ??
        asNonEmptyString(obj.description) ??
        asNonEmptyString(obj.label) ??
        asNonEmptyString(obj.status) ??
        key;
      tasks[key] = label;
    }
  } else {
    const taskRecord = asRecord(nested.tasks);
    if (taskRecord) {
      for (const [key, value] of Object.entries(taskRecord)) {
        if (typeof value === "string" && value.trim()) {
          tasks[key] = value.trim();
        } else {
          const obj = asRecord(value);
          const desc =
            asNonEmptyString(obj?.title) ??
            asNonEmptyString(obj?.description) ??
            asNonEmptyString(obj?.status);
          if (desc) tasks[key] = desc;
        }
      }
    }
  }

  const rawThreads = nested.threads ?? nested.outcomeThreads ?? nested.outcome_threads;
  const threads: OrchestrationV2NativeSwarmOverviewThread[] = [];
  if (Array.isArray(rawThreads)) {
    for (let i = 0; i < rawThreads.length; i += 1) {
      const obj = asRecord(rawThreads[i]);
      if (!obj) continue;
      const id = asNonEmptyString(obj.id) ?? `thread-${i + 1}`;
      const threadTitle = asNonEmptyString(obj.title) ?? id;
      const goal = asNonEmptyString(obj.goal) ?? asNonEmptyString(obj.description) ?? "";
      const threadTasks = Array.isArray(obj.tasks)
        ? obj.tasks.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0,
          )
        : [];
      threads.push({ id, title: threadTitle, goal, tasks: threadTasks });
    }
  }

  const hasOverviewData =
    goalTitle !== null || goalLine !== null || Object.keys(tasks).length > 0 || threads.length > 0;
  return {
    title,
    overview: hasOverviewData ? { goalTitle, goalLine, tasks, threads } : null,
  };
}

interface MutableMember {
  name: string;
  conversationId: string | null;
  role: string | null;
  model: string | null;
  state: OrchestrationV2NativeSwarmMemberState;
  latestToolCall: string | null;
  updatedAt: string | null;
  steps: ReadonlyArray<OrchestrationV2NativeChildStep> | null;
}

interface MutablePost {
  id: string;
  seq: number | null;
  sender: string;
  content: string;
  timestamp: string | null;
  kind: OrchestrationV2NativeSwarmPostKind;
  mentions: ReadonlyArray<string>;
  screenshotPath: string | null;
  screenshotCaption: string | null;
}

function mergeMemberRecord(
  membersByName: Map<string, MutableMember>,
  raw: unknown,
  fallbackName?: string,
  fallbackUpdatedAt?: string | null,
) {
  const obj = asRecord(raw);
  if (!obj) return;
  const name =
    asNonEmptyString(obj.name) ??
    asNonEmptyString(obj.memberName) ??
    asNonEmptyString(obj.swarmName) ??
    fallbackName;
  if (!name) return;

  const conversationIdRaw =
    asNonEmptyString(obj.conversationId) ??
    asNonEmptyString(obj.conversation_id) ??
    asNonEmptyString(obj.sessionId);
  const conversationId =
    conversationIdRaw && NATIVE_ID.test(conversationIdRaw) ? conversationIdRaw : null;
  const role =
    asNonEmptyString(obj.role) ?? asNonEmptyString(asRecord(obj.subagentDescriptor)?.role);
  const model = asNonEmptyString(obj.model);
  const stateValue = obj.state ?? obj.status;
  const state = stateValue !== undefined ? normalizeMemberState(stateValue) : undefined;
  const latestToolCall =
    asNonEmptyString(obj.latestToolCall) ?? asNonEmptyString(obj.latest_tool_call);
  const updatedAt = parseIsoTimestamp(obj.updatedAt ?? obj.updated_at) ?? fallbackUpdatedAt ?? null;

  const existing = membersByName.get(name);
  if (!existing) {
    membersByName.set(name, {
      name,
      conversationId,
      role,
      model,
      state: state ?? "waiting",
      latestToolCall,
      updatedAt,
      steps: null,
    });
    return;
  }
  if (conversationId) existing.conversationId = conversationId;
  if (role) existing.role = role;
  if (model) existing.model = model;
  if (state !== undefined) existing.state = state;
  if (latestToolCall) existing.latestToolCall = latestToolCall;
  existing.updatedAt = latestTimestamp([existing.updatedAt, updatedAt]);
}

function parsePostRecord(
  raw: unknown,
  fallbackId: string,
  fallbackUpdatedAt?: string | null,
): MutablePost | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;
  const contentRaw =
    typeof obj.content === "string"
      ? obj.content
      : typeof obj.text === "string"
        ? obj.text
        : typeof obj.body === "string"
          ? obj.body
          : typeof obj.message === "string"
            ? obj.message
            : undefined;
  if (contentRaw === undefined) return undefined;
  const content = capText(contentRaw, CONTENT_CAP);
  const sender =
    asNonEmptyString(obj.sender) ??
    asNonEmptyString(obj.from) ??
    asNonEmptyString(obj.author) ??
    "coordinator";
  const seqRaw = obj.seq ?? obj.sequence;
  const seq = typeof seqRaw === "number" && Number.isInteger(seqRaw) && seqRaw >= 0 ? seqRaw : null;
  const timestamp =
    parseIsoTimestamp(obj.timestamp ?? obj.createdAt ?? obj.created_at) ??
    fallbackUpdatedAt ??
    null;
  const id = asNonEmptyString(obj.id) ?? (seq !== null ? `post-${seq}` : fallbackId);
  const explicitMentions = Array.isArray(obj.mentions)
    ? obj.mentions
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim().toLowerCase())
    : [];
  const extractedMentions = extractSwarmMentions(content);
  const mentions = [...new Set([...extractedMentions, ...explicitMentions])];
  const explicitScreenshot = sanitizeScreenshotPath(
    asNonEmptyString(obj.screenshotPath) ?? asNonEmptyString(obj.screenshot_path),
  );
  const extractedScreenshot = extractSwarmScreenshot(content);
  const screenshotPath = explicitScreenshot ?? extractedScreenshot.screenshotPath;
  const screenshotCaption =
    asNonEmptyString(obj.screenshotCaption) ??
    asNonEmptyString(obj.screenshot_caption) ??
    extractedScreenshot.screenshotCaption;

  return {
    id,
    seq,
    sender,
    content,
    timestamp,
    kind: normalizePostKind(obj.kind, sender, content),
    mentions,
    screenshotPath,
    screenshotCaption,
  };
}

function expandAddMemberNames(
  baseName: string,
  tasks?: ReadonlyArray<string>,
  count?: number,
): ReadonlyArray<string> {
  if (tasks && tasks.length > 0) {
    return tasks.map((_, index) => `${baseName}-${index + 1}`);
  }
  if (count && count > 1) {
    return Array.from({ length: count }, (_, index) => `${baseName}-${index + 1}`);
  }
  return [baseName];
}

function makePostFingerprint(sender: string, content: string): string {
  return `${sender.toLowerCase()}::${content.trim()}`;
}

/** Hardened native swarm reader combining Antigravity disk files with recorded T3 turn tool items. */
export const readAntigravitySwarmState = Effect.fn("readAntigravitySwarmState")(function* (input: {
  readonly profileDirectory: string;
  readonly rootSessionId: string;
  readonly recordedItems?: ReadonlyArray<RecordedSwarmToolRecord>;
  readonly providerUpdatedAt?: string | null;
}): Effect.fn.Return<OrchestrationV2GetNativeSwarmStateResult> {
  if (!NATIVE_ID.test(input.rootSessionId)) {
    return EMPTY_ANTIGRAVITY_SWARM_STATE;
  }

  return yield* Effect.promise(async (): Promise<OrchestrationV2GetNativeSwarmStateResult> => {
    const profileRoot = await antigravityProfileRoot(input.profileDirectory);
    if (profileRoot === undefined) {
      return EMPTY_ANTIGRAVITY_SWARM_STATE;
    }

    const swarmDirSegments = [
      "antigravity-acp",
      "brain",
      input.rootSessionId,
      ".system_generated",
      "swarm",
    ];
    const fileMtimes: Array<string | null> = [];
    let title: string | null = null;
    let overview: OrchestrationV2NativeSwarmOverview | null = null;
    const membersByName = new Map<string, MutableMember>();
    const posts: MutablePost[] = [];
    const seenPostKeys = new Set<string>();
    const seenSeqs = new Set<number>();

    const pushPost = (post: MutablePost) => {
      if (posts.length >= MAX_POSTS) return;
      if (post.seq !== null && seenSeqs.has(post.seq)) return;
      const fingerprint = makePostFingerprint(post.sender, post.content);
      if (seenPostKeys.has(fingerprint)) return;
      if (post.seq !== null) seenSeqs.add(post.seq);
      seenPostKeys.add(fingerprint);
      posts.push(post);
    };

    const planFile = await readManagedNoFollowText(
      profileRoot,
      [...swarmDirSegments, "plan.json"],
      MAX_JSON_BYTES,
    );
    if (planFile) {
      fileMtimes.push(planFile.mtimeIso);
      const parsed = parseJsonSafe(planFile.text);
      const extracted = parseOverview(parsed);
      if (extracted.title) title = extracted.title;
      if (extracted.overview) overview = extracted.overview;
      const parsedObj = asRecord(parsed);
      if (Array.isArray(parsedObj?.members)) {
        for (const entry of parsedObj.members) {
          mergeMemberRecord(membersByName, entry, undefined, planFile.mtimeIso);
        }
      }
    }

    for (const rosterFileName of ["roster.json", "members.json"] as const) {
      const rosterFile = await readManagedNoFollowText(
        profileRoot,
        [...swarmDirSegments, rosterFileName],
        MAX_JSON_BYTES,
      );
      if (!rosterFile) continue;
      fileMtimes.push(rosterFile.mtimeIso);
      const parsed = parseJsonSafe(rosterFile.text);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          mergeMemberRecord(membersByName, entry, undefined, rosterFile.mtimeIso);
        }
        continue;
      }
      const obj = asRecord(parsed);
      if (!obj) continue;
      if (!title) title = asNonEmptyString(obj.title) ?? asNonEmptyString(obj.swarmTitle);
      const collection = obj.members ?? obj.roster ?? obj.workers ?? obj.agents;
      if (Array.isArray(collection)) {
        for (const entry of collection) {
          mergeMemberRecord(membersByName, entry, undefined, rosterFile.mtimeIso);
        }
      } else if (Predicate.isObject(collection)) {
        for (const [name, entry] of Object.entries(collection)) {
          mergeMemberRecord(membersByName, entry, name, rosterFile.mtimeIso);
        }
      }
    }

    const boardJson = await readManagedNoFollowText(
      profileRoot,
      [...swarmDirSegments, "board.json"],
      MAX_BOARD_BYTES,
    );
    if (boardJson) {
      fileMtimes.push(boardJson.mtimeIso);
      const parsed = parseJsonSafe(boardJson.text);
      if (Array.isArray(parsed)) {
        parsed.forEach((entry, idx) => {
          const post = parsePostRecord(entry, `board-json-${idx + 1}`, boardJson.mtimeIso);
          if (post) pushPost(post);
        });
      } else {
        const obj = asRecord(parsed);
        if (obj) {
          if (!title) title = asNonEmptyString(obj.title) ?? asNonEmptyString(obj.swarmTitle);
          const rosterEntries = obj.members ?? obj.roster;
          if (Array.isArray(rosterEntries)) {
            for (const entry of rosterEntries) {
              mergeMemberRecord(membersByName, entry, undefined, boardJson.mtimeIso);
            }
          }
          const entries = obj.posts ?? obj.messages ?? obj.entries;
          if (Array.isArray(entries)) {
            entries.forEach((entry, idx) => {
              const post = parsePostRecord(entry, `board-json-${idx + 1}`, boardJson.mtimeIso);
              if (post) pushPost(post);
            });
          }
        }
      }
    }

    const boardJsonl = await readManagedNoFollowText(
      profileRoot,
      [...swarmDirSegments, "board.jsonl"],
      MAX_BOARD_BYTES,
    );
    if (boardJsonl) {
      fileMtimes.push(boardJsonl.mtimeIso);
      const lines = boardJsonl.text.split("\n");
      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx]?.trim();
        if (!line) continue;
        const parsed = parseJsonSafe(line);
        const post = parsePostRecord(parsed, `board-jsonl-${idx + 1}`, boardJsonl.mtimeIso);
        if (post) pushPost(post);
      }
    }

    // Track whether recorded turn tool items indicate swarm usage on this thread.
    const parsedActions = (input.recordedItems ?? []).flatMap((item) => {
      const action = extractAntigravitySwarmAction(item);
      return action ? [{ action, item }] : [];
    });

    const hasSwarmEvidence =
      planFile !== undefined ||
      boardJson !== undefined ||
      boardJsonl !== undefined ||
      membersByName.size > 0 ||
      posts.length > 0 ||
      parsedActions.length > 0;

    // Replay recorded tool calls first/together so newly added members are present before subagent enrichment.
    for (const { action, item } of parsedActions) {
      if (action.kind === "post_message") {
        if (action.text.trim().length > 0) {
          const sender = action.sender ?? item.sender ?? "coordinator";
          const content = capText(action.text, CONTENT_CAP);
          const screenshot = extractSwarmScreenshot(content);
          pushPost({
            id:
              item.id ??
              (action.seq !== undefined
                ? `post-${action.seq}`
                : `recorded-post-${posts.length + 1}`),
            seq: action.seq ?? null,
            sender,
            content,
            timestamp: item.timestamp ?? null,
            kind: normalizePostKind(undefined, sender, content),
            mentions: extractSwarmMentions(content),
            screenshotPath: screenshot.screenshotPath,
            screenshotCaption: screenshot.screenshotCaption,
          });
        }
        continue;
      }

      if (action.action === "title" && action.title) {
        title = action.title;
        continue;
      }
      if (action.action === "model") {
        const target = action.name ?? "coordinator";
        const existing = membersByName.get(target);
        if (existing) {
          existing.model = action.model ?? existing.model;
          existing.updatedAt = latestTimestamp([existing.updatedAt, item.timestamp]);
        }
        continue;
      }
      if (action.action === "kill" && action.name) {
        const existing = membersByName.get(action.name);
        if (existing) {
          existing.state = "killed";
          existing.updatedAt = latestTimestamp([existing.updatedAt, item.timestamp]);
        } else {
          membersByName.set(action.name, {
            name: action.name,
            conversationId: null,
            role: null,
            model: null,
            state: "killed",
            latestToolCall: null,
            updatedAt: item.timestamp ?? null,
            steps: null,
          });
        }
        continue;
      }
      if (action.action === "status" && action.rawOutput !== undefined) {
        const outObj = asRecord(action.rawOutput);
        const rawList = Array.isArray(action.rawOutput)
          ? action.rawOutput
          : Array.isArray(outObj?.members)
            ? outObj.members
            : Array.isArray(outObj?.roster)
              ? outObj.roster
              : undefined;
        if (rawList) {
          for (const entry of rawList) {
            mergeMemberRecord(membersByName, entry, undefined, item.timestamp ?? null);
          }
        }
        continue;
      }
      if (action.action === "add" && action.name) {
        const memberNames = expandAddMemberNames(action.name, action.tasks, action.n);
        memberNames.forEach((memberName, index) => {
          const existing = membersByName.get(memberName);
          if (!existing) {
            membersByName.set(memberName, {
              name: memberName,
              conversationId: null,
              role: action.workspace ? `workspace:${action.workspace}` : null,
              model: action.model ?? null,
              state: "working",
              latestToolCall: null,
              updatedAt: item.timestamp ?? null,
              steps: null,
            });
          } else {
            if (action.model) existing.model = action.model;
            existing.updatedAt = latestTimestamp([existing.updatedAt, item.timestamp]);
          }
          const taskDetail = action.tasks?.[index];
          const briefText = [action.brief, taskDetail ? `Task: ${taskDetail}` : undefined]
            .filter((part): part is string => Boolean(part && part.trim().length > 0))
            .join("\n\n");
          if (briefText) {
            const formatted = extractSwarmMentions(briefText).includes(memberName.toLowerCase())
              ? briefText
              : `@${memberName} ${briefText}`;
            const sender = item.sender ?? "coordinator";
            const screenshot = extractSwarmScreenshot(formatted);
            pushPost({
              id: item.id ? `${item.id}-${memberName}` : `recorded-brief-${posts.length + 1}`,
              seq: null,
              sender,
              content: capText(formatted, CONTENT_CAP),
              timestamp: item.timestamp ?? null,
              kind: "brief",
              mentions: extractSwarmMentions(formatted),
              screenshotPath: screenshot.screenshotPath,
              screenshotCaption: screenshot.screenshotCaption,
            });
          }
        });
      }
    }

    // Read .system_generated/subagents/*.json only if swarm evidence exists or subagent JSON carries swarm identity.
    const subagentsSegments = [
      "antigravity-acp",
      "brain",
      input.rootSessionId,
      ".system_generated",
      "subagents",
    ];
    const subagentsDir = await antigravityManagedPath(profileRoot, subagentsSegments, "directory");
    if (subagentsDir) {
      const entries = (await NodeFSP.readdir(subagentsDir.path).catch(() => []))
        .filter((name) => name.endsWith(".json") && NATIVE_ID.test(name.slice(0, -5)))
        .slice(0, MAX_SUBAGENT_FILES);
      for (const fileName of entries) {
        const childId = fileName.slice(0, -5);
        const file = await readManagedNoFollowText(
          profileRoot,
          [...subagentsSegments, fileName],
          MAX_JSON_BYTES,
        );
        if (!file) continue;
        const parsed = parseJsonSafe(file.text);
        const obj = asRecord(parsed);
        if (!obj) continue;
        if (obj.conversationId !== undefined && obj.conversationId !== childId) continue;
        const explicitSwarmName =
          asNonEmptyString(obj.memberName) ??
          asNonEmptyString(obj.swarmName) ??
          asNonEmptyString(obj.name);
        const roleName =
          asNonEmptyString(obj.role) ?? asNonEmptyString(asRecord(obj.subagentDescriptor)?.role);
        const matchedExisting =
          (explicitSwarmName && membersByName.get(explicitSwarmName)) ||
          (roleName && membersByName.get(roleName)) ||
          Array.from(membersByName.values()).find(
            (candidate) => candidate.conversationId === childId,
          );
        const isSwarmMemberRecord =
          matchedExisting !== undefined ||
          explicitSwarmName !== null ||
          obj.swarm === true ||
          (hasSwarmEvidence && roleName !== null);
        if (!isSwarmMemberRecord) continue;

        fileMtimes.push(file.mtimeIso);
        const memberName = matchedExisting?.name ?? explicitSwarmName ?? roleName ?? childId;
        mergeMemberRecord(
          membersByName,
          { ...obj, conversationId: childId, name: memberName },
          memberName,
          file.mtimeIso,
        );
      }
    }

    // Read .system_generated/messages/*.json (skip read.json and invoke_subagent envelopes).
    const messagesSegments = [
      "antigravity-acp",
      "brain",
      input.rootSessionId,
      ".system_generated",
      "messages",
    ];
    const messagesDir = await antigravityManagedPath(profileRoot, messagesSegments, "directory");
    if (messagesDir) {
      const entries = (await NodeFSP.readdir(messagesDir.path).catch(() => []))
        .filter((name) => name.endsWith(".json") && name !== "read.json")
        .slice(0, MAX_MESSAGE_FILES);
      for (const fileName of entries) {
        const file = await readManagedNoFollowText(
          profileRoot,
          [...messagesSegments, fileName],
          MAX_JSON_BYTES,
        );
        if (!file) continue;
        const parsed = parseJsonSafe(file.text);
        const obj = asRecord(parsed);
        if (!obj) continue;
        const launchTool = asRecord(asRecord(asRecord(obj.sourceMetadata)?.tool)?.toolCall);
        if (launchTool?.name === "invoke_subagent") continue;
        const looksLikeSwarmMessage =
          obj.channel === "swarm" ||
          obj.type === "swarm_post" ||
          obj.board === true ||
          typeof obj.seq === "number" ||
          hasSwarmEvidence;
        if (!looksLikeSwarmMessage) continue;
        const post = parsePostRecord(obj, `msg-${fileName.slice(0, -5)}`, file.mtimeIso);
        if (post) {
          fileMtimes.push(file.mtimeIso);
          pushPost(post);
        }
      }
    }

    // Enrich members with child transcript tails when conversationId is valid.
    for (const member of membersByName.values()) {
      if (!member.conversationId || !NATIVE_ID.test(member.conversationId)) continue;
      const tail = await readManagedNoFollowTail(
        profileRoot,
        [
          "antigravity-acp",
          "brain",
          member.conversationId,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        ],
        MAX_TRANSCRIPT_BYTES,
      );
      if (!tail) continue;
      fileMtimes.push(tail.mtimeIso);
      const steps = parseTranscriptSteps(tail.text);
      member.steps = steps;
      if (!member.latestToolCall) {
        for (let i = steps.length - 1; i >= 0; i -= 1) {
          const toolCalls = steps[i]?.toolCalls;
          if (toolCalls && toolCalls.length > 0) {
            member.latestToolCall = toolCalls.at(-1)?.name ?? null;
            break;
          }
        }
      }
      member.updatedAt = latestTimestamp([member.updatedAt, tail.mtimeIso]);
    }

    const active =
      title !== null || overview !== null || membersByName.size > 0 || posts.length > 0;
    if (!active) {
      return EMPTY_ANTIGRAVITY_SWARM_STATE;
    }

    // Normalize post seq values cleanly and sort chronologically.
    let nextSeq =
      posts.reduce((max, post) => (post.seq !== null && post.seq > max ? post.seq : max), 0) + 1;
    const finalizedPosts: OrchestrationV2NativeSwarmPost[] = posts
      .map((post) => {
        const seq = post.seq ?? nextSeq++;
        return {
          id: post.id,
          seq,
          sender: post.sender,
          mentions: post.mentions,
          content: post.content,
          timestamp: post.timestamp,
          kind: post.kind,
          screenshotPath: post.screenshotPath,
          screenshotCaption: post.screenshotCaption,
        };
      })
      .sort((a, b) => a.seq - b.seq);

    const finalizedMembers: OrchestrationV2NativeSwarmMember[] = Array.from(
      membersByName.values(),
    ).map((member) => ({
      name: member.name,
      conversationId: member.conversationId,
      role: member.role,
      model: member.model,
      state: member.state,
      latestToolCall: member.latestToolCall,
      updatedAt: member.updatedAt,
      steps: member.steps,
    }));

    const activeMemberNames = finalizedMembers
      .filter((member) => member.state !== "killed")
      .map((member) => member.name);

    const edgeMap = new Map<
      string,
      {
        readonly from: string;
        readonly to: string;
        count: number;
        lastSeq: number;
        lastActivityAt: string | null;
      }
    >();

    for (const post of finalizedPosts) {
      const targets = new Set<string>();
      for (const mention of post.mentions) {
        if (mention === "all") {
          for (const activeName of activeMemberNames) {
            if (activeName.toLowerCase() !== post.sender.toLowerCase()) {
              targets.add(activeName);
            }
          }
        } else if (mention.toLowerCase() !== post.sender.toLowerCase()) {
          // Match exact casing from member roster when available.
          const matchedMember = finalizedMembers.find(
            (candidate) => candidate.name.toLowerCase() === mention.toLowerCase(),
          );
          targets.add(matchedMember ? matchedMember.name : mention);
        }
      }
      for (const target of targets) {
        const edgeKey = `${post.sender}\u0000${target}`;
        const existing = edgeMap.get(edgeKey);
        if (!existing) {
          edgeMap.set(edgeKey, {
            from: post.sender,
            to: target,
            count: 1,
            lastSeq: post.seq,
            lastActivityAt: post.timestamp,
          });
        } else {
          existing.count += 1;
          existing.lastSeq = Math.max(existing.lastSeq, post.seq);
          existing.lastActivityAt = latestTimestamp([existing.lastActivityAt, post.timestamp]);
        }
      }
    }

    const edges: OrchestrationV2NativeSwarmEdge[] = Array.from(edgeMap.values());
    const updatedAt = latestTimestamp([
      ...finalizedPosts.map((post) => post.timestamp),
      ...finalizedMembers.map((member) => member.updatedAt),
      ...fileMtimes,
      input.providerUpdatedAt,
    ]);

    return {
      active,
      title,
      overview,
      members: finalizedMembers,
      posts: finalizedPosts,
      edges,
      updatedAt,
    };
  });
});
