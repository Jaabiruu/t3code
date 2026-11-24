import {
  ANTIGRAVITY_DEFAULT_MODEL,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationV2ProviderCapabilities,
  type ProviderSetupError,
} from "@t3tools/contracts";
import type { SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Exit from "effect/Exit";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as EffectAcpErrors from "effect-acp/errors";

import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { PULL_REQUEST_LINKING_INSTRUCTIONS } from "@t3tools/provider-core/server/runtimeInstructions";
import type { AntigravityAuth } from "../../provider/AntigravityAuth.ts";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import type { AcpToolCallState } from "@t3tools/provider-acp/server/runtimeModel";
import {
  antigravityAppendsSystemPrompt,
  antigravityPermissionDisposition,
  antigravityPermissionMode,
  antigravityRuntimeModeForSessionMode,
  antigravitySteersWithPrompt,
  applyAntigravityAcpModelSelection,
  applyAntigravityOrchestratorDefaults,
  buildAntigravityPrompt,
  type AntigravityAcpRuntimeInput,
} from "../../provider/acp/AntigravityAcpSupport.ts";
import {
  ANTIGRAVITY_SUBAGENT_BATCH_TITLE,
  antigravitySubagentLaunches,
  describeAntigravitySubagentLaunches,
  readAntigravityChildrenAtWork,
  readAntigravityPendingReply,
} from "../../provider/acp/AntigravityChildWork.ts";
import { readAntigravityClientTextFile } from "../../provider/acp/AntigravityClientFiles.ts";
import { watchAntigravityPromptOutcome } from "../../provider/acp/AntigravityTurnOutcome.ts";
import {
  antigravityApprovalOptions,
  antigravityToolOutlivesPrompt,
  antigravityCommandOutlivesPrompt,
  antigravitySubagentOutput,
  classifyAntigravitySubagentToolCall,
  extractAntigravityArtifactWrite,
  extractAntigravityUserInputQuestion,
  makeAntigravityReadRepair,
  makeAntigravityUserInputResponse,
  normalizeAntigravityToolCall,
} from "../../provider/acp/AntigravityProtocol.ts";
import {
  isAntigravitySignInRequiredError,
  type AntigravityOrchestratorConfig,
} from "../../provider/antigravityAuthSupport.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";

const ANTIGRAVITY_PROVIDER = ProviderDriverKind.make("antigravity");

const AntigravityProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
    supportsRuntimeModeSwitchInSession: true,
  },
  planning: {
    ...AcpProviderCapabilitiesV2.planning,
    emitsProposedPlan: true,
    supportsNativeArtifacts: true,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
  subagents: {
    ...AcpProviderCapabilitiesV2.subagents,
    supportsSubagents: true,
    supportsNativeSwarm: false,
  },
} satisfies OrchestrationV2ProviderCapabilities;

const capturePlanCallbacks = new WeakMap<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  (input: { readonly planMarkdown: string }) => Effect.Effect<void>
>();

/** Extracts proposed plan markdown from plan artifact writes or feedback-requested writes. */
function extractAntigravityProposedPlanMarkdown(toolCall: AcpToolCallState): string | undefined {
  const write = extractAntigravityArtifactWrite(toolCall);
  if (!write) return undefined;
  if (write.requestFeedback !== true && !write.isPlanPath) return undefined;
  const markdown = write.content?.trim();
  return markdown && markdown.length > 0 ? markdown : undefined;
}

/** Thread variables reach the driver here; `makeAntigravityAcpRuntime` never reads them. */
export type AntigravityAdapterV2RuntimeInput = Omit<
  AntigravityAcpRuntimeInput,
  "spawn" | "childProcessSpawner"
> & { readonly processEnvironment?: NodeJS.ProcessEnv };

export interface AntigravityAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly selfInvocation: SelfInvocation;
  readonly makeRuntime: (
    input: AntigravityAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError | ProviderSetupError,
    Scope.Scope
  >;
  readonly withProcess: AntigravityAuth["withProcess"];
  readonly defaultModel: Effect.Effect<string | undefined>;
  readonly supportsNativeGoals?: Effect.Effect<boolean>;
  readonly supportsNativeSwarm?: boolean | Effect.Effect<boolean>;
  readonly orchestrator?: AntigravityOrchestratorConfig;
  readonly onSessionStarted?: (
    started: AcpSessionRuntime.AcpSessionRuntimeStartResult,
    cwd: string,
  ) => Effect.Effect<void>;
  readonly onSessionEvent?: AcpAdapterV2Flavor["onSessionEvent"];
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
  /** The agent's GEMINI_HOME. Its session logs show turns that ended on an upstream error. */
  readonly profileDirectory?: string;
}

/**
 * Native subagent tools report no child session ids, so children stay read-only.
 * Only permission prompts carry the launch; NativeChildWorkQuery matches their ids by this text.
 */
const extractAntigravitySubagentUpdate: NonNullable<AcpAdapterV2Flavor["extractSubagentUpdate"]> = (
  toolCall,
) => {
  if (classifyAntigravitySubagentToolCall(toolCall) !== "subagent") {
    return undefined;
  }
  const status =
    toolCall.status === "failed" ? "failed" : toolCall.status === "pending" ? "pending" : "running";
  const launches = antigravitySubagentLaunches(toolCall.data.rawInput);
  const launch = launches === undefined ? undefined : describeAntigravitySubagentLaunches(launches);
  return {
    nativeTaskId: toolCall.toolCallId,
    prompt:
      launch?.prompt ??
      antigravitySubagentOutput(toolCall) ??
      toolCall.detail ??
      toolCall.title ??
      ANTIGRAVITY_SUBAGENT_BATCH_TITLE,
    title: launch?.title ?? ANTIGRAVITY_SUBAGENT_BATCH_TITLE,
    model: null,
    status,
    childSessionId: null,
    result: status === "failed" ? (antigravitySubagentOutput(toolCall) ?? null) : null,
  };
};

interface AntigravityFlavorServices {
  readonly random: SecureRandom.SecureRandom["Service"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly host: ProviderHost.ProviderHost["Service"];
}

export function makeAntigravityAcpAdapterFlavor(
  options: AntigravityAdapterV2Options & AntigravityFlavorServices,
): AcpAdapterV2Flavor {
  const { profileDirectory } = options;
  const antigravityClientFileRoots = (cwd: string | null) =>
    cwd === null ? [options.host.paths.attachmentsDir] : [cwd, options.host.paths.attachmentsDir];
  const makeRuntime = Effect.fn("AntigravityAdapterV2.makeRuntime")(
    function* (input: AcpAdapterV2RuntimeInput) {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const runtime = yield* options
        .withProcess(
          Scope.close(scope, Exit.void),
          options.makeRuntime({
            ...input,
            clientFileReads: true,
            sessionSystemPromptAppend: PULL_REQUEST_LINKING_INSTRUCTIONS,
          }),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));
      // Repair keeps state across updates, so each runtime must have one session-update handler.
      const reads = makeAntigravityReadRepair();
      const toolCalls = new Map<string, AcpToolCallState>();
      // Served reads are reported from the read handler, so they take turns with agent updates.
      const updates = yield* Semaphore.make(1);
      let projectUpdate: Parameters<typeof runtime.handleSessionUpdate>[0] | undefined;
      const wrappedRuntime: typeof runtime = {
        ...runtime,
        handleReadTextFile: (handler) =>
          runtime.handleReadTextFile((request, context) =>
            handler(request, context).pipe(
              Effect.onExit((exit) => {
                const served = reads.attempted(request.path, Exit.isSuccess(exit));
                if (served === undefined || projectUpdate === undefined) return Effect.void;
                return updates
                  .withPermit(
                    projectUpdate({
                      sessionId: served.sessionId,
                      update: {
                        sessionUpdate: "tool_call_update",
                        toolCallId: served.toolCallId,
                        status: "completed",
                      },
                    }),
                  )
                  .pipe(Effect.ignore);
              }),
            ),
          ),
        prompt: (payload, promptOptions) =>
          Effect.sync(() => {
            reads.reset();
            toolCalls.clear();
          }).pipe(Effect.andThen(runtime.prompt(payload, promptOptions))),
        handleSessionUpdate: (handler) => {
          projectUpdate = handler;
          return runtime.handleSessionUpdate((notification) =>
            Effect.gen(function* () {
              const repaired = reads.repair(notification);
              yield* updates.withPermit(handler(repaired));
              const update = repaired.update;
              if (
                update.sessionUpdate !== "tool_call" &&
                update.sessionUpdate !== "tool_call_update"
              ) {
                return;
              }
              const previous = toolCalls.get(update.toolCallId);
              const kind = update.kind ?? previous?.kind;
              const rawStatus = update.status ?? previous?.status;
              const status: AcpToolCallState["status"] =
                rawStatus === "pending" ||
                rawStatus === "inProgress" ||
                rawStatus === "requiresAction" ||
                rawStatus === "completed" ||
                rawStatus === "failed"
                  ? rawStatus
                  : rawStatus === "in_progress"
                    ? "inProgress"
                    : rawStatus === "requires_action"
                      ? "requiresAction"
                      : undefined;
              const title = typeof update.title === "string" ? update.title : previous?.title;
              const rawInput =
                update.rawInput !== undefined ? update.rawInput : previous?.data.rawInput;
              const rawOutput =
                update.rawOutput !== undefined ? update.rawOutput : previous?.data.rawOutput;
              const locations =
                update.locations !== undefined ? update.locations : previous?.data.locations;
              const merged: AcpToolCallState = {
                toolCallId: update.toolCallId,
                ...(kind !== undefined ? { kind } : {}),
                ...(status !== undefined ? { status } : {}),
                ...(title !== undefined ? { title } : {}),
                ...(previous?.command !== undefined ? { command: previous.command } : {}),
                ...(previous?.detail !== undefined ? { detail: previous.detail } : {}),
                data: {
                  ...previous?.data,
                  ...(kind !== undefined ? { kind } : {}),
                  ...(title !== undefined ? { title } : {}),
                  ...(rawInput !== undefined ? { rawInput } : {}),
                  ...(rawOutput !== undefined ? { rawOutput } : {}),
                  ...(locations !== undefined ? { locations } : {}),
                },
              };
              toolCalls.set(update.toolCallId, merged);
              if (merged.status === "completed") {
                const planMarkdown = extractAntigravityProposedPlanMarkdown(merged);
                const capture = capturePlanCallbacks.get(wrappedRuntime);
                if (planMarkdown !== undefined && capture !== undefined) {
                  yield* capture({ planMarkdown }).pipe(Effect.ignore);
                }
              }
            }),
          );
        },
        start: () =>
          runtime
            .start()
            .pipe(
              Effect.tap(
                (started) => options.onSessionStarted?.(started, input.cwd) ?? Effect.void,
              ),
            ),
      };
      return wrappedRuntime;
    },
    Effect.provideService(SecureRandom.SecureRandom, options.random),
    Effect.mapError((cause): EffectAcpErrors.AcpError =>
      cause._tag === "ProviderSetupError"
        ? new EffectAcpErrors.AcpTransportError({ detail: cause.detail, cause })
        : cause,
    ),
  );

  return {
    driver: ANTIGRAVITY_PROVIDER,
    runtimeHarness: "Antigravity",
    capabilities: {
      ...AntigravityProviderCapabilitiesV2,
      subagents: {
        ...AntigravityProviderCapabilitiesV2.subagents,
        supportsNativeSwarm:
          typeof options.supportsNativeSwarm === "boolean" ? options.supportsNativeSwarm : false,
      },
    },
    supportsNativeGoals: options.supportsNativeGoals ?? Effect.succeed(false),
    registerExtensions: (context) =>
      Effect.sync(() => {
        capturePlanCallbacks.set(context.runtime, context.captureProposedPlan);
      }),
    extractProposedPlanMarkdown: extractAntigravityProposedPlanMarkdown,
    // Agents that advertise HTTP MCP skip the stdio bridge process; others keep stdio.
    mcpOverHttp: true,
    sessionCarriesPullRequestLinking: antigravityAppendsSystemPrompt,
    makeRuntime,
    buildAttachmentPrompt: ({ text, attachments, resolveAttachmentPath, promptCapabilities }) =>
      buildAntigravityPrompt({
        input: text,
        attachments,
        resolveAttachmentPath,
        promptCapabilities,
      }).pipe(
        Effect.map((blocks) => (text.trim() ? blocks.slice(1) : blocks)),
        Effect.provideService(FileSystem.FileSystem, options.fileSystem),
        Effect.provideService(Path.Path, options.path),
      ),
    // Loading history replays tool calls; resume avoids replay.
    subagentsIdleOnTurnCompletion: true,
    // A finished background command or timer wakes the agent with no prompt open: it streams a
    // reply and asks for permissions, and no prompt response ever ends that reply.
    enablePostSettleContinuation: true,
    deferFinalizeForBackgroundWork: true,
    wakeOnDetachedRequest: true,
    replyEndsWithUsageUpdate: true,
    toolOutlivesPrompt: antigravityToolOutlivesPrompt,
    // agy sometimes loses the terminal update or wake for a background command, which would
    // hold the turn in Working forever. 30 minutes still leaves long commands room.
    postSettleCommandHold: {
      timeout: "30 minutes",
      isCommand: antigravityCommandOutlivesPrompt,
    },
    // session/cancel ends the agent's running commands, so only Stop sends it once the prompt
    // has ended. A message sent while a command runs leaves the command alone.
    preserveRuntimeOnSettledInterrupt: true,
    // `agy acp` reads a prompt sent mid-turn as a steer; cancel-and-restart killed its subagents.
    steersWithPrompt: antigravitySteersWithPrompt,
    ...(options.onSessionEvent === undefined ? {} : { onSessionEvent: options.onSessionEvent }),
    applyModelSelection: Effect.fn("AntigravityAdapterV2.applyModelSelection")(function* ({
      runtime,
      modelSelection,
    }) {
      const defaultModel = yield* options.defaultModel;
      const selectedModel = yield* applyAntigravityAcpModelSelection({
        runtime,
        model:
          modelSelection.model === ANTIGRAVITY_DEFAULT_MODEL ? undefined : modelSelection.model,
        defaultModel,
        mapError: (cause) => cause,
      });
      yield* applyAntigravityOrchestratorDefaults({
        runtime,
        orchestrator: options.orchestrator,
        selectedModel,
        explicitOptionIds: new Set((modelSelection.options ?? []).map((option) => option.id)),
      });
      return selectedModel;
    }),
    sessionModeForPolicy: (policy) => antigravityPermissionMode(policy.runtimeMode),
    runtimeModeForSessionMode: antigravityRuntimeModeForSessionMode,
    clientFileSystem: {
      readTextFile: (request, cwd) =>
        readAntigravityClientTextFile({
          fileSystem: options.fileSystem,
          path: options.path,
          allowedRoots: antigravityClientFileRoots(cwd),
          request,
        }),
    },
    permissionDisposition: antigravityPermissionDisposition,
    approvalOptions: antigravityApprovalOptions,
    extractPermissionQuestion: (request) => {
      const question = extractAntigravityUserInputQuestion(request);
      if (question === undefined) return undefined;
      return {
        question,
        respond: (answers) => makeAntigravityUserInputResponse(request, answers),
      };
    },
    normalizeToolCall: normalizeAntigravityToolCall,
    extractSubagentUpdate: extractAntigravitySubagentUpdate,
    supportsImagePrompts: true,
    compactViaAdvertisedCommand: true,
    requiresSignIn: isAntigravitySignInRequiredError,
    checksVersionAtHandshake: true,
    // Antigravity can leave a prompt open without updates; long tools and approvals pause this.
    promptInactivityTimeout: "15 minutes",
    reportsPerTurnPromptUsage: true,
    geminiPromptUsage: true,
    ...(profileDirectory === undefined
      ? {}
      : {
          watchPromptOutcome: (sessionId: string) =>
            watchAntigravityPromptOutcome(profileDirectory, sessionId),
          subagentsOutlivingPrompt: ({ sessionId, nativeTaskIds }) =>
            readAntigravityChildrenAtWork({
              profileDirectory,
              rootSessionId: sessionId,
              toolCallIds: nativeTaskIds,
            }),
          hasPendingReply: (sessionId: string) =>
            readAntigravityPendingReply({
              profileDirectory,
              sessionId,
            }),
        }),
  };
}

export const makeAntigravityAdapterV2 = Effect.fn("makeAntigravityAdapterV2")(function* (
  options: AntigravityAdapterV2Options,
) {
  const services: AntigravityFlavorServices = {
    random: yield* SecureRandom.SecureRandom,
    fileSystem: yield* FileSystem.FileSystem,
    path: yield* Path.Path,
    host: yield* ProviderHost.ProviderHost,
  };
  const readSwarmSupport =
    options.supportsNativeSwarm === undefined
      ? Effect.succeed(false)
      : typeof options.supportsNativeSwarm === "boolean"
        ? Effect.succeed(options.supportsNativeSwarm)
        : options.supportsNativeSwarm;
  const withSwarmCapability = (
    capabilities: OrchestrationV2ProviderCapabilities,
    supportsNativeSwarm: boolean,
  ): OrchestrationV2ProviderCapabilities => ({
    ...capabilities,
    subagents: {
      ...capabilities.subagents,
      supportsNativeSwarm,
    },
  });
  const baseAdapter = yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeAntigravityAcpAdapterFlavor({ ...options, ...services }),
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
  });
  return ProviderAdapter.ProviderAdapterV2.of({
    ...baseAdapter,
    getCapabilities: Effect.fn("AntigravityAdapterV2.getCapabilities")(function* () {
      const [capabilities, supportsNativeSwarm] = yield* Effect.all([
        baseAdapter.getCapabilities(),
        readSwarmSupport,
      ]);
      return withSwarmCapability(capabilities, supportsNativeSwarm);
    }),
    openSession: Effect.fn("AntigravityAdapterV2.openSession")(function* (input) {
      const session = yield* baseAdapter.openSession(input);
      const supportsNativeSwarm = yield* readSwarmSupport;
      return {
        ...session,
        providerSession: {
          ...session.providerSession,
          capabilities: withSwarmCapability(
            session.providerSession.capabilities,
            supportsNativeSwarm,
          ),
        },
      };
    }),
  });
});
