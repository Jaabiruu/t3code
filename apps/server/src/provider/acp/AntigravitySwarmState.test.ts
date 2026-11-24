// @effect-diagnostics nodeBuiltinImport:off -- Uses direct temp profile paths and symlinks to test traversal/link rejection.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  EMPTY_ANTIGRAVITY_SWARM_STATE,
  extractSwarmMentions,
  extractSwarmScreenshot,
  readAntigravitySwarmState,
} from "./AntigravitySwarmState.ts";

async function createManagedProfile(root: string, sessionId: string) {
  const swarmDir = NodePath.join(
    root,
    "antigravity-acp",
    "brain",
    sessionId,
    ".system_generated",
    "swarm",
  );
  const subagentsDir = NodePath.join(
    root,
    "antigravity-acp",
    "brain",
    sessionId,
    ".system_generated",
    "subagents",
  );
  const messagesDir = NodePath.join(
    root,
    "antigravity-acp",
    "brain",
    sessionId,
    ".system_generated",
    "messages",
  );
  await NodeFSP.mkdir(swarmDir, { recursive: true });
  await NodeFSP.mkdir(subagentsDir, { recursive: true });
  await NodeFSP.mkdir(messagesDir, { recursive: true });
  return { swarmDir, subagentsDir, messagesDir };
}

it("extractSwarmMentions and extractSwarmScreenshot handle mentions and captions", () => {
  expect(
    extractSwarmMentions("@coordinator [done] (@worker_1) notify @all and @worker_1."),
  ).toEqual(["coordinator", "worker_1", "all"]);
  expect(
    extractSwarmScreenshot("Done.\nScreenshot: screenshots/verify.png | Verified login card"),
  ).toEqual({
    screenshotPath: "screenshots/verify.png",
    screenshotCaption: "Verified login card",
  });
  expect(extractSwarmScreenshot("Screenshot: ../escape.png | bad")).toEqual({
    screenshotPath: null,
    screenshotCaption: null,
  });
});

it.effect(
  "reads swarm plan, board, roster, child transcripts, mentions, screenshots, and edges",
  () =>
    Effect.gen(function* () {
      const profileDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-ag-swarm-")),
      );
      try {
        const rootSessionId = "session-root-1";
        const childSessionId = "child-parser-1";
        const { swarmDir, subagentsDir, messagesDir } = yield* Effect.promise(() =>
          createManagedProfile(profileDir, rootSessionId),
        );
        const childLogsDir = NodePath.join(
          profileDir,
          "antigravity-acp",
          "brain",
          childSessionId,
          ".system_generated",
          "logs",
        );
        yield* Effect.promise(() => NodeFSP.mkdir(childLogsDir, { recursive: true }));

        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(swarmDir, "plan.json"),
            JSON.stringify({
              title: "Harness Build Swarm",
              goalTitle: "Ship Antigravity Swarm",
              goalLine: "Implement readers and RPCs",
              tasks: { parser: "Build protocol parser", verifier: "Verify endpoints" },
              threads: [{ id: "t-1", title: "Backend", goal: "Swarm reader", tasks: ["parser"] }],
            }),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(swarmDir, "roster.json"),
            JSON.stringify({
              members: [
                {
                  name: "parser",
                  conversationId: childSessionId,
                  model: "gemini-3",
                  state: "working",
                },
                { name: "verifier", model: "claude-4", state: "waiting" },
                { name: "retired", state: "killed" },
              ],
            }),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(swarmDir, "board.jsonl"),
            [
              JSON.stringify({
                seq: 1,
                sender: "coordinator",
                kind: "brief",
                content: "@parser Start backend protocol.",
                timestamp: "2026-11-23T10:00:00.000Z",
              }),
              JSON.stringify({
                seq: 2,
                sender: "parser",
                content:
                  "@coordinator @all [done] Finished!\nScreenshot: shots/ui.png | Board view",
                timestamp: "2026-11-23T10:05:00.000Z",
              }),
            ].join("\n"),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(subagentsDir, `${childSessionId}.json`),
            JSON.stringify({
              conversationId: childSessionId,
              memberName: "parser",
              state: "SUBAGENT_STATE_RUNNING",
            }),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(messagesDir, "msg-3.json"),
            JSON.stringify({
              seq: 3,
              sender: "verifier",
              content: "@parser Looks clean, are tests passing?",
              timestamp: "2026-11-23T10:06:00.000Z",
            }),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(messagesDir, "read.json"),
            JSON.stringify({ ignore: true }),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(childLogsDir, "transcript.jsonl"),
            JSON.stringify({
              step_index: 0,
              type: "PLANNER_RESPONSE",
              status: "COMPLETED",
              content: "Parsed files",
              tool_calls: [{ name: "write_file", args: { Path: '"AntigravityProtocol.ts"' } }],
            }),
          ),
        );

        const state = yield* readAntigravitySwarmState({
          profileDirectory: profileDir,
          rootSessionId,
        });

        assert.isTrue(state.active);
        assert.equal(state.title, "Harness Build Swarm");
        assert.deepEqual(state.overview, {
          goalTitle: "Ship Antigravity Swarm",
          goalLine: "Implement readers and RPCs",
          tasks: { parser: "Build protocol parser", verifier: "Verify endpoints" },
          threads: [{ id: "t-1", title: "Backend", goal: "Swarm reader", tasks: ["parser"] }],
        });
        const parserMember = state.members.find((m) => m.name === "parser");
        assert.equal(parserMember?.conversationId, childSessionId);
        assert.equal(parserMember?.state, "working");
        assert.equal(parserMember?.latestToolCall, "write_file");
        assert.equal(parserMember?.steps?.length, 1);

        expect(state.posts.map((p) => [p.seq, p.kind, p.sender])).toEqual([
          [1, "brief", "coordinator"],
          [2, "result", "parser"],
          [3, "question", "verifier"],
        ]);
        assert.equal(state.posts[1]?.screenshotPath, "shots/ui.png");
        assert.equal(state.posts[1]?.screenshotCaption, "Board view");
        // @all expands to active non-self members (verifier) and excludes killed (retired) and self (parser).
        expect(state.edges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ from: "coordinator", to: "parser", count: 1, lastSeq: 1 }),
            expect.objectContaining({ from: "parser", to: "coordinator", count: 1, lastSeq: 2 }),
            expect.objectContaining({ from: "parser", to: "verifier", count: 1, lastSeq: 2 }),
            expect.objectContaining({ from: "verifier", to: "parser", count: 1, lastSeq: 3 }),
          ]),
        );
        expect(state.edges.some((edge) => edge.to === "retired")).toBe(false);
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(profileDir, { recursive: true, force: true }));
      }
    }),
);

it.effect("merges recorded T3 swarm tool items before disk files flush", () =>
  Effect.gen(function* () {
    const profileDir = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-ag-swarm-recorded-")),
    );
    try {
      const state = yield* readAntigravitySwarmState({
        profileDirectory: profileDir,
        rootSessionId: "session-recorded-only",
        recordedItems: [
          {
            id: "t1",
            toolName: "swarm",
            input: { action: "title", title: "Recorded Swarm" },
            timestamp: "2026-11-23T11:00:00.000Z",
          },
          {
            id: "t2",
            toolName: "swarm",
            input: {
              action: "add",
              name: "worker",
              model: "gemini-3",
              brief: "Implement feature",
            },
            timestamp: "2026-11-23T11:00:01.000Z",
          },
          {
            id: "t3",
            toolName: "post_message",
            input: { text: "@worker Reminder about tests" },
            timestamp: "2026-11-23T11:00:02.000Z",
          },
          {
            id: "t4",
            toolName: "swarm",
            input: { action: "kill", name: "worker" },
            timestamp: "2026-11-23T11:00:03.000Z",
          },
        ],
      });

      assert.isTrue(state.active);
      assert.equal(state.title, "Recorded Swarm");
      expect(state.members).toEqual([
        expect.objectContaining({ name: "worker", model: "gemini-3", state: "killed" }),
      ]);
      expect(state.posts).toHaveLength(2);
      assert.equal(state.posts[0]?.kind, "brief");
      assert.deepEqual(state.posts[0]?.mentions, ["worker"]);
      expect(state.edges).toEqual([
        {
          from: "coordinator",
          to: "worker",
          count: 2,
          lastSeq: 2,
          lastActivityAt: "2026-11-23T11:00:02.000Z",
        },
      ]);
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(profileDir, { recursive: true, force: true }));
    }
  }),
);

it.effect("rejects invalid rootSessionId, path traversal, and symlinks", () =>
  Effect.gen(function* () {
    const profileDir = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-ag-swarm-sec-")),
    );
    try {
      const invalid = yield* readAntigravitySwarmState({
        profileDirectory: profileDir,
        rootSessionId: "../escape",
      });
      assert.deepEqual(invalid, EMPTY_ANTIGRAVITY_SWARM_STATE);

      const outsideFile = NodePath.join(profileDir, "secret.json");
      yield* Effect.promise(() =>
        NodeFSP.writeFile(outsideFile, JSON.stringify({ title: "SECRET" })),
      );
      const { swarmDir } = yield* Effect.promise(() => createManagedProfile(profileDir, "safe-1"));
      const symlinkCreated = yield* Effect.promise(() =>
        NodeFSP.symlink(outsideFile, NodePath.join(swarmDir, "plan.json"))
          .then(() => true)
          .catch(() => false),
      );
      if (symlinkCreated) {
        const res = yield* readAntigravitySwarmState({
          profileDirectory: profileDir,
          rootSessionId: "safe-1",
        });
        assert.deepEqual(res, EMPTY_ANTIGRAVITY_SWARM_STATE);
      }
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(profileDir, { recursive: true, force: true }));
    }
  }),
);
