// @effect-diagnostics nodeBuiltinImport:off -- Bounded O_NOFOLLOW reads against the managed profile root.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type {
  OrchestrationV2GetNativeArtifactsResult,
  OrchestrationV2NativeArtifact,
  OrchestrationV2NativeArtifactKind,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";
import { extractAntigravityArtifactWrite } from "./AntigravityProtocol.ts";

const NATIVE_ID = /^[A-Za-z0-9-]{1,64}$/;
const EXCLUDED_BRAIN_ENTRIES = new Set([".system_generated", "scratch"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

const MAX_ARTIFACTS = 64;
const MAX_SIDECAR_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 128 * 1024;
const MAX_ARTIFACT_CHARS = 64_000;

export const EMPTY_ANTIGRAVITY_ARTIFACTS: OrchestrationV2GetNativeArtifactsResult = {
  artifacts: [],
};

export interface RecordedArtifactToolRecord {
  readonly id?: string;
  readonly toolName?: string | null;
  readonly title?: string | null;
  readonly kind?: string | null;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly fileName?: string;
  readonly newStr?: string;
  readonly timestamp?: string | null;
}

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const HTML_IMAGE_PATTERN = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
const SCREENSHOT_IMAGE_PATTERN = /^Screenshot:\s*([^\r\n|]+?)(?:\s*\|\s*[^\r\n]*)?$/gim;

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

function toEpochMs(value: string | null): number {
  if (!value) return 0;
  const dt = DateTime.make(value);
  return Option.isSome(dt) ? DateTime.toEpochMillis(dt.value) : 0;
}

function classifyArtifactKind(
  fileName: string,
  requestFeedback: boolean,
): OrchestrationV2NativeArtifactKind {
  if (/plan/i.test(fileName) || requestFeedback) return "plan";
  if (/walkthrough/i.test(fileName)) return "walkthrough";
  return "other";
}

function deriveArtifactTitle(fileName: string, content: string): string {
  const headingMatch = /^#\s+(.+)$/m.exec(content);
  if (headingMatch?.[1]?.trim()) {
    return headingMatch[1].trim().slice(0, 200);
  }
  const stem = fileName.replace(/\.md$/i, "").replace(/[_-]+/g, " ").trim();
  if (!stem) return fileName;
  return stem.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function normalizeCandidateMediaPath(rawTarget: string, rootSessionId: string): string | null {
  let cleaned = rawTarget.trim();
  if (!cleaned) return null;
  cleaned = cleaned.split(/[?#]/)[0]?.trim() ?? "";
  if (!cleaned || cleaned.includes("\0")) return null;
  if (/^(https?|data|javascript|vbscript):/i.test(cleaned)) return null;
  if (/^file:/i.test(cleaned)) {
    const brainSubpathMatch = new RegExp(
      `/(?:antigravity-acp/)?brain/${rootSessionId}/(.+)$`,
      "i",
    ).exec(cleaned);
    if (!brainSubpathMatch?.[1]) return null;
    cleaned = brainSubpathMatch[1];
  }

  const normalized = cleaned.replace(/\\/g, "/");
  // Convert explicit paths referencing this session's brain root to brain-relative paths; reject other sessions or arbitrary host paths.
  const sameSessionMatch = new RegExp(
    `(?:^|/)(?:antigravity-acp/)?brain/${rootSessionId}/(.+)$`,
    "i",
  ).exec(normalized);
  const relative = sameSessionMatch?.[1] ?? normalized;
  if (/(?:^|\/)brain\/[^/]+\//i.test(relative) && !sameSessionMatch) return null;
  if (/^[A-Za-z]:\//.test(relative) || relative.startsWith("/")) return null;

  const segments = relative.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) return null;
  const ext = NodePath.posix.extname(segments.at(-1) ?? "").toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return null;
  return segments.join("/");
}

async function extractSafeArtifactMediaPaths(
  profileRoot: string,
  rootSessionId: string,
  content: string,
): Promise<ReadonlyArray<string>> {
  const rawTargets: string[] = [];
  for (const pattern of [MARKDOWN_IMAGE_PATTERN, HTML_IMAGE_PATTERN, SCREENSHOT_IMAGE_PATTERN]) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) rawTargets.push(match[1]);
    }
  }
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const rawTarget of rawTargets) {
    const normalized = normalizeCandidateMediaPath(rawTarget, rootSessionId);
    if (!normalized || seen.has(normalized)) continue;
    const segments = normalized.split("/");
    const diskPath = ["antigravity-acp", "brain", rootSessionId, ...segments];
    // If an entry exists on disk at that location, require it to pass managed non-symlink verification.
    const candidateFsPath = NodePath.join(profileRoot, ...diskPath);
    const existsOnDisk = await NodeFSP.lstat(candidateFsPath)
      .then(() => true)
      .catch(() => false);
    if (existsOnDisk) {
      const safe = await antigravityManagedPath(profileRoot, diskPath, "file");
      if (!safe) continue;
    }
    seen.add(normalized);
    resolved.push(normalized);
  }
  return resolved;
}

async function readManagedBoundedFile(
  profileRoot: string,
  segments: ReadonlyArray<string>,
  maxBytes: number,
  maxChars: number,
): Promise<
  { readonly content: string; readonly truncated: boolean; readonly mtimeIso: string } | undefined
> {
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
    const byteTruncated = stat.size > maxBytes;
    const bytesToRead = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const rawText = buffer.toString("utf8", 0, offset);
    const charTruncated = rawText.length > maxChars;
    const content = charTruncated ? rawText.slice(0, maxChars) : rawText;
    return {
      content,
      truncated: byteTruncated || charTruncated,
      mtimeIso: stat.mtime.toISOString(),
    };
  } catch {
    return undefined;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

interface ParsedSidecar {
  readonly summary: string | null;
  readonly userFacing: boolean | null;
  readonly requestFeedback: boolean | null;
  readonly updatedAt: string | null;
}

async function readMetadataSidecar(
  profileRoot: string,
  rootSessionId: string,
  fileName: string,
): Promise<ParsedSidecar | undefined> {
  const stem = fileName.replace(/\.md$/i, "");
  for (const candidateName of [`${fileName}.metadata.json`, `${stem}.metadata.json`]) {
    const file = await readManagedBoundedFile(
      profileRoot,
      ["antigravity-acp", "brain", rootSessionId, candidateName],
      MAX_SIDECAR_BYTES,
      MAX_SIDECAR_BYTES,
    );
    if (!file || file.truncated) continue;
    try {
      const parsed = asRecord(JSON.parse(file.content));
      if (!parsed) continue;
      return {
        summary: asNonEmptyString(parsed.Summary) ?? asNonEmptyString(parsed.summary),
        userFacing:
          typeof parsed.UserFacing === "boolean"
            ? parsed.UserFacing
            : typeof parsed.userFacing === "boolean"
              ? parsed.userFacing
              : typeof parsed.user_facing === "boolean"
                ? parsed.user_facing
                : null,
        requestFeedback:
          typeof parsed.RequestFeedback === "boolean"
            ? parsed.RequestFeedback
            : typeof parsed.requestFeedback === "boolean"
              ? parsed.requestFeedback
              : typeof parsed.request_feedback === "boolean"
                ? parsed.request_feedback
                : null,
        updatedAt: parseIsoTimestamp(parsed.updatedAt ?? parsed.updated_at) ?? file.mtimeIso,
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

interface RecordedArtifactMerge {
  readonly fileName: string;
  readonly summary: string | null;
  readonly userFacing: boolean | null;
  readonly requestFeedback: boolean | null;
  readonly content: string | null;
  readonly updatedAt: string | null;
}

function collectRecordedArtifactMetadata(
  records: ReadonlyArray<RecordedArtifactToolRecord>,
  rootSessionId: string,
): Map<string, RecordedArtifactMerge> {
  const byLowerName = new Map<string, RecordedArtifactMerge>();
  const brainPathForSession = new RegExp(
    `(?:^|/)(?:antigravity-acp/)?brain/${rootSessionId}/([^/]+\\.md)$`,
    "i",
  );
  for (const item of records) {
    const parsed = extractAntigravityArtifactWrite(item);
    if (!parsed || !parsed.fileName) continue;
    if (parsed.path && /(?:^|\/)brain\/([^/]+)\//i.test(parsed.path)) {
      const match = brainPathForSession.exec(parsed.path);
      if (!match) continue;
    }
    if (!/\.md$/i.test(parsed.fileName)) continue;
    const key = parsed.fileName.toLowerCase();
    const prev = byLowerName.get(key);
    byLowerName.set(key, {
      fileName: parsed.fileName,
      summary: parsed.summary ?? prev?.summary ?? null,
      userFacing: parsed.userFacing ?? prev?.userFacing ?? null,
      requestFeedback: parsed.requestFeedback ?? prev?.requestFeedback ?? null,
      content: parsed.content ?? prev?.content ?? null,
      updatedAt: parseIsoTimestamp(item.timestamp) ?? prev?.updatedAt ?? null,
    });
  }
  return byLowerName;
}

/** Hardened native brain artifact reader combining disk `.md` + `.metadata.json` with recorded tool calls. */
export const readAntigravityArtifacts = Effect.fn("readAntigravityArtifacts")(function* (input: {
  readonly profileDirectory: string;
  readonly rootSessionId: string;
  readonly recordedItems?: ReadonlyArray<RecordedArtifactToolRecord>;
}): Effect.fn.Return<OrchestrationV2GetNativeArtifactsResult> {
  if (!NATIVE_ID.test(input.rootSessionId)) {
    return EMPTY_ANTIGRAVITY_ARTIFACTS;
  }

  return yield* Effect.promise(async (): Promise<OrchestrationV2GetNativeArtifactsResult> => {
    const profileRoot = await antigravityProfileRoot(input.profileDirectory);
    if (profileRoot === undefined) {
      return EMPTY_ANTIGRAVITY_ARTIFACTS;
    }

    const recordedByName = collectRecordedArtifactMetadata(
      input.recordedItems ?? [],
      input.rootSessionId,
    );
    const brainSegments = ["antigravity-acp", "brain", input.rootSessionId];
    const brainDir = await antigravityManagedPath(profileRoot, brainSegments, "directory");
    const artifacts: OrchestrationV2NativeArtifact[] = [];
    const seenFiles = new Set<string>();

    if (brainDir) {
      const entries = await NodeFSP.readdir(brainDir.path, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (artifacts.length >= MAX_ARTIFACTS) break;
        if (EXCLUDED_BRAIN_ENTRIES.has(entry.name)) continue;
        if (entry.isSymbolicLink() || !entry.isFile()) continue;
        if (!entry.name.toLowerCase().endsWith(".md")) continue;
        if (entry.name.includes("/") || entry.name.includes("\\")) continue;

        const file = await readManagedBoundedFile(
          profileRoot,
          [...brainSegments, entry.name],
          MAX_ARTIFACT_BYTES,
          MAX_ARTIFACT_CHARS,
        );
        if (!file) continue;

        const sidecar = await readMetadataSidecar(profileRoot, input.rootSessionId, entry.name);
        const recorded = recordedByName.get(entry.name.toLowerCase());
        seenFiles.add(entry.name.toLowerCase());

        const summary = sidecar?.summary ?? recorded?.summary ?? null;
        const userFacing = sidecar?.userFacing ?? recorded?.userFacing ?? false;
        const requestFeedback = sidecar?.requestFeedback ?? recorded?.requestFeedback ?? false;
        const kind = classifyArtifactKind(entry.name, requestFeedback);
        const mediaPaths = await extractSafeArtifactMediaPaths(
          profileRoot,
          input.rootSessionId,
          file.content,
        );

        artifacts.push({
          id: entry.name,
          fileName: entry.name,
          title: deriveArtifactTitle(entry.name, file.content),
          summary,
          userFacing,
          requestFeedback,
          kind,
          content: file.content,
          truncated: file.truncated,
          updatedAt: recorded?.updatedAt ?? sidecar?.updatedAt ?? file.mtimeIso,
          mediaPaths,
        });
      }
    }

    // Surface recorded writes targeting this session's brain root before disk flush if not yet present.
    for (const [lowerName, recorded] of recordedByName) {
      if (artifacts.length >= MAX_ARTIFACTS) break;
      if (seenFiles.has(lowerName) || recorded.content === null) continue;
      const truncated = recorded.content.length > MAX_ARTIFACT_CHARS;
      const content = truncated ? recorded.content.slice(0, MAX_ARTIFACT_CHARS) : recorded.content;
      const requestFeedback = recorded.requestFeedback ?? false;
      const mediaPaths = await extractSafeArtifactMediaPaths(
        profileRoot,
        input.rootSessionId,
        content,
      );
      artifacts.push({
        id: recorded.fileName,
        fileName: recorded.fileName,
        title: deriveArtifactTitle(recorded.fileName, content),
        summary: recorded.summary,
        userFacing: recorded.userFacing ?? false,
        requestFeedback,
        kind: classifyArtifactKind(recorded.fileName, requestFeedback),
        content,
        truncated,
        updatedAt: recorded.updatedAt,
        mediaPaths,
      });
    }

    artifacts.sort((a, b) => {
      const aMs = toEpochMs(a.updatedAt);
      const bMs = toEpochMs(b.updatedAt);
      if (bMs !== aMs) return bMs - aMs;
      return a.fileName.localeCompare(b.fileName);
    });

    return { artifacts };
  });
});
