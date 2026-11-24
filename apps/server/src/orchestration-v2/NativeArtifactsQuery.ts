import type {
  OrchestrationV2GetNativeArtifactsInput,
  OrchestrationV2GetNativeArtifactsResult,
} from "@t3tools/contracts";
import { OrchestrationV2GetNativeArtifactsError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Digest from "effect/crypto/Digest";

import * as ServerConfig from "../config.ts";
import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import {
  EMPTY_ANTIGRAVITY_ARTIFACTS,
  readAntigravityArtifacts,
  type RecordedArtifactToolRecord,
} from "../provider/acp/AntigravityArtifacts.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

export interface NativeArtifactsQueryShape {
  readonly getNativeArtifacts: (
    input: OrchestrationV2GetNativeArtifactsInput,
  ) => Effect.Effect<
    OrchestrationV2GetNativeArtifactsResult,
    OrchestrationV2GetNativeArtifactsError
  >;
}

export class NativeArtifactsQuery extends Context.Service<
  NativeArtifactsQuery,
  NativeArtifactsQueryShape
>()("t3/orchestration-v2/NativeArtifactsQuery") {}

function toIsoString(value: unknown): string | null {
  if (DateTime.isDateTime(value)) return DateTime.formatIso(value);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toEpochMs(value: unknown): number {
  if (DateTime.isDateTime(value)) return DateTime.toEpochMillis(value);
  if (typeof value === "string" && value.length > 0) {
    const parsed = DateTime.make(value);
    return parsed._tag === "Some" ? DateTime.toEpochMillis(parsed.value) : 0;
  }
  return 0;
}

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const digest = yield* Digest.Digest;
  const path = yield* Path.Path;

  const getNativeArtifacts = Effect.fn("NativeArtifactsQuery.getNativeArtifacts")(
    function* (input: OrchestrationV2GetNativeArtifactsInput) {
      const records = yield* threads.getThreadRecords(input.threadId, [
        "runs",
        "attempts",
        "providerThreads",
        "turnItems",
      ]);

      const activeProviderThread =
        records.thread.activeProviderThreadId !== null
          ? records.providerThreads.find(
              (candidate) => candidate.id === records.thread.activeProviderThreadId,
            )
          : undefined;

      if (activeProviderThread !== undefined && activeProviderThread.driver !== "antigravity") {
        return EMPTY_ANTIGRAVITY_ARTIFACTS;
      }

      const antigravityProviderThread =
        activeProviderThread ??
        records.providerThreads
          .filter((candidate) => candidate.driver === "antigravity")
          .toSorted((a, b) => toEpochMs(b.updatedAt) - toEpochMs(a.updatedAt))[0];

      if (antigravityProviderThread === undefined) {
        return EMPTY_ANTIGRAVITY_ARTIFACTS;
      }

      const antigravityRun = records.runs
        .filter((run) => run.providerThreadId === antigravityProviderThread.id)
        .at(-1);

      const activeAttempt =
        antigravityRun?.activeAttemptId !== null && antigravityRun?.activeAttemptId !== undefined
          ? records.attempts.find((attempt) => attempt.id === antigravityRun.activeAttemptId)
          : antigravityRun !== undefined
            ? records.attempts.filter((attempt) => attempt.runId === antigravityRun.id).at(-1)
            : undefined;

      const providerInstanceId = antigravityProviderThread.providerInstanceId;
      const rootSessionId =
        activeAttempt?.nativeThreadId ?? antigravityProviderThread.nativeThreadRef?.nativeId;

      if (!providerInstanceId || !rootSessionId) {
        return EMPTY_ANTIGRAVITY_ARTIFACTS;
      }

      const directories = yield* resolveAntigravityInstanceDirectories(
        stateDir,
        providerInstanceId,
      ).pipe(Effect.provideService(Digest.Digest, digest), Effect.provideService(Path.Path, path));

      const recordedItems: ReadonlyArray<RecordedArtifactToolRecord> = records.turnItems.flatMap(
        (item): ReadonlyArray<RecordedArtifactToolRecord> => {
          if (item.type === "dynamic_tool") {
            return [
              {
                id: item.id,
                toolName: item.toolName,
                title: item.title,
                input: item.input,
                output: item.output,
                timestamp: toIsoString(item.completedAt ?? item.updatedAt ?? item.startedAt),
              },
            ];
          }
          if (item.type === "file_change") {
            return [
              {
                id: item.id,
                toolName: "file_change",
                title: item.title,
                fileName: item.fileName,
                ...(item.newStr !== undefined ? { newStr: item.newStr } : {}),
                timestamp: toIsoString(item.completedAt ?? item.updatedAt ?? item.startedAt),
              },
            ];
          }
          return [];
        },
      );

      return yield* readAntigravityArtifacts({
        profileDirectory: directories.profile,
        rootSessionId,
        recordedItems,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetNativeArtifactsError({ threadId: input.threadId, cause }),
        ),
      ),
  );

  return NativeArtifactsQuery.of({ getNativeArtifacts });
});

export const layer = Layer.effect(NativeArtifactsQuery, make);
