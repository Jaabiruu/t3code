import type {
  OrchestrationV2GetNativeSwarmStateInput,
  OrchestrationV2GetNativeSwarmStateResult,
} from "@t3tools/contracts";
import { OrchestrationV2GetNativeSwarmStateError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Digest from "effect/crypto/Digest";

import * as ServerConfig from "../config.ts";
import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import {
  EMPTY_ANTIGRAVITY_SWARM_STATE,
  readAntigravitySwarmState,
  type RecordedSwarmToolRecord,
} from "../provider/acp/AntigravitySwarmState.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

export interface NativeSwarmQueryShape {
  readonly getNativeSwarmState: (
    input: OrchestrationV2GetNativeSwarmStateInput,
  ) => Effect.Effect<
    OrchestrationV2GetNativeSwarmStateResult,
    OrchestrationV2GetNativeSwarmStateError
  >;
}

export class NativeSwarmQuery extends Context.Service<NativeSwarmQuery, NativeSwarmQueryShape>()(
  "t3/orchestration-v2/NativeSwarmQuery",
) {}

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

  const getNativeSwarmState = Effect.fn("NativeSwarmQuery.getNativeSwarmState")(
    function* (input: OrchestrationV2GetNativeSwarmStateInput) {
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
        return EMPTY_ANTIGRAVITY_SWARM_STATE;
      }

      const antigravityProviderThread =
        activeProviderThread ??
        records.providerThreads
          .filter((candidate) => candidate.driver === "antigravity")
          .toSorted((a, b) => toEpochMs(b.updatedAt) - toEpochMs(a.updatedAt))[0];

      if (antigravityProviderThread === undefined) {
        return EMPTY_ANTIGRAVITY_SWARM_STATE;
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
        return EMPTY_ANTIGRAVITY_SWARM_STATE;
      }

      const directories = yield* resolveAntigravityInstanceDirectories(
        stateDir,
        providerInstanceId,
      ).pipe(Effect.provideService(Digest.Digest, digest), Effect.provideService(Path.Path, path));

      const recordedItems: ReadonlyArray<RecordedSwarmToolRecord> = records.turnItems.flatMap(
        (item): ReadonlyArray<RecordedSwarmToolRecord> => {
          if (item.type !== "dynamic_tool") return [];
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
        },
      );

      return yield* readAntigravitySwarmState({
        profileDirectory: directories.profile,
        rootSessionId,
        recordedItems,
        providerUpdatedAt: toIsoString(antigravityProviderThread.updatedAt),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetNativeSwarmStateError({ threadId: input.threadId, cause }),
        ),
      ),
  );

  return NativeSwarmQuery.of({ getNativeSwarmState });
});

export const layer = Layer.effect(NativeSwarmQuery, make);
