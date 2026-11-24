// @effect-diagnostics nodeBuiltinImport:off -- Uses direct temp profile paths for swarm disk fixtures.
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
import { EMPTY_ANTIGRAVITY_SWARM_STATE } from "../provider/acp/AntigravitySwarmState.ts";
import * as NativeSwarmQuery from "./NativeSwarmQuery.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const instanceId = ProviderInstanceId.make("antigravity");
const threadId = ThreadId.make("thread-swarm");
const rootSessionId = "root-swarm-session-1";

function runSwarmQuery(recordsValue: unknown) {
  return Effect.gen(function* () {
    const query = yield* NativeSwarmQuery.NativeSwarmQuery;
    return yield* query.getNativeSwarmState({ threadId });
  }).pipe(
    Effect.provide(
      NativeSwarmQuery.layer.pipe(
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
    ServerConfig.layerTest(process.cwd(), { prefix: "native-swarm-query-" }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    ),
  ),
)("NativeSwarmQuery", (it) => {
  it.effect("returns inactive empty state for non-Antigravity threads", () =>
    Effect.gen(function* () {
      const result = yield* runSwarmQuery({
        thread: { id: threadId, activeProviderThreadId: "pt-codex" },
        runs: [],
        attempts: [],
        providerThreads: [
          {
            id: "pt-codex",
            driver: "codex",
            providerInstanceId: "codex-main",
            nativeThreadRef: { nativeId: "codex-1" },
            updatedAt: "2026-11-23T10:00:00.000Z",
          },
        ],
        turnItems: [],
      });
      expect(result).toEqual(EMPTY_ANTIGRAVITY_SWARM_STATE);
    }),
  );

  it.effect("reads swarm disk files and merges recorded turn items for Antigravity threads", () =>
    Effect.gen(function* () {
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const { profile } = yield* resolveAntigravityInstanceDirectories(stateDir, instanceId);
      const swarmDir = NodePath.join(
        profile,
        "antigravity-acp",
        "brain",
        rootSessionId,
        ".system_generated",
        "swarm",
      );
      yield* Effect.promise(() => NodeFSP.mkdir(swarmDir, { recursive: true }));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(swarmDir, "plan.json"),
          JSON.stringify({
            title: "Query Swarm",
            goalTitle: "Verify NativeSwarmQuery",
            goalLine: "Combine disk and turn items",
          }),
        ),
      );

      const result = yield* runSwarmQuery({
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
            id: "ti-1",
            type: "dynamic_tool",
            toolName: "swarm",
            title: "swarm",
            input: { action: "add", name: "alpha", brief: "Check backend" },
            updatedAt: "2026-11-23T10:05:01.000Z",
          },
        ],
      });

      expect(result.active).toBe(true);
      expect(result.title).toBe("Query Swarm");
      expect(result.members.map((m) => m.name)).toEqual(["alpha"]);
      expect(result.posts[0]?.mentions).toEqual(["alpha"]);
    }),
  );
});
