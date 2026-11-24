// @effect-diagnostics nodeBuiltinImport:off -- Uses direct temp profile paths for artifact disk fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import { EMPTY_ANTIGRAVITY_ARTIFACTS } from "../provider/acp/AntigravityArtifacts.ts";
import * as NativeArtifactsQuery from "./NativeArtifactsQuery.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const instanceId = ProviderInstanceId.make("antigravity");
const threadId = ThreadId.make("thread-artifacts");
const rootSessionId = "root-artifacts-session-1";

function runArtifactsQuery(recordsValue: unknown) {
  return Effect.gen(function* () {
    const query = yield* NativeArtifactsQuery.NativeArtifactsQuery;
    return yield* query.getNativeArtifacts({ threadId });
  }).pipe(
    Effect.provide(
      NativeArtifactsQuery.layer.pipe(
        Layer.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadRecords: () => Effect.succeed(recordsValue as never),
          }),
        ),
      ),
    ),
  );
}

it.layer(
  Layer.mergeAll(
    NodeServices.layer,
    NodeCrypto.layer,
    ServerConfig.layerTest(process.cwd(), { prefix: "native-artifacts-query-" }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    ),
  ),
)("NativeArtifactsQuery", (it) => {
  it.effect("returns empty artifacts for non-Antigravity threads", () =>
    Effect.gen(function* () {
      const result = yield* runArtifactsQuery({
        thread: { id: threadId, activeProviderThreadId: "pt-claude" },
        runs: [],
        attempts: [],
        providerThreads: [
          {
            id: "pt-claude",
            driver: "claudeAgent",
            providerInstanceId: "claude-main",
            nativeThreadRef: { nativeId: "claude-1" },
            updatedAt: "2026-11-23T10:00:00.000Z",
          },
        ],
        turnItems: [],
      });
      expect(result).toEqual(EMPTY_ANTIGRAVITY_ARTIFACTS);
    }),
  );

  it.effect("reads brain markdown artifacts and merges recorded write_file ArtifactMetadata", () =>
    Effect.gen(function* () {
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const { profile } = yield* resolveAntigravityInstanceDirectories(stateDir, instanceId);
      const brainDir = NodePath.join(profile, "antigravity-acp", "brain", rootSessionId);
      yield* Effect.promise(() => NodeFSP.mkdir(brainDir, { recursive: true }));
      const planPath = NodePath.join(brainDir, "implementation_plan.md");
      yield* Effect.promise(() =>
        NodeFSP.writeFile(planPath, "# Implementation Plan\n\nStep 1: Implement RPCs."),
      );

      const result = yield* runArtifactsQuery({
        thread: { id: threadId, activeProviderThreadId: "pt-ag" },
        runs: [
          {
            id: "run-1",
            driver: "antigravity",
            providerThreadId: "pt-ag",
            activeAttemptId: "att-1",
          },
        ],
        attempts: [
          {
            id: "att-1",
            driver: "antigravity",
            providerInstanceId: instanceId,
            nativeThreadId: rootSessionId,
          },
        ],
        providerThreads: [
          {
            id: "pt-ag",
            driver: "antigravity",
            providerInstanceId: instanceId,
            nativeThreadRef: { nativeId: rootSessionId },
            updatedAt: "2026-11-23T10:05:00.000Z",
          },
        ],
        turnItems: [
          {
            id: "ti-plan",
            type: "dynamic_tool",
            toolName: "write_file",
            title: "write_file",
            input: {
              Path: planPath,
              ArtifactMetadata: {
                Summary: "Backend plan",
                UserFacing: true,
                RequestFeedback: true,
              },
            },
            updatedAt: "2026-11-23T10:05:05.000Z",
          },
        ],
      });

      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]).toMatchObject({
        fileName: "implementation_plan.md",
        title: "Implementation Plan",
        summary: "Backend plan",
        userFacing: true,
        requestFeedback: true,
        kind: "plan",
        truncated: false,
      });
    }),
  );
});
