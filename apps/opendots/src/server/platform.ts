import { ComputerService } from './computer-service.js';
import { ConnectionService } from './connections.js';
import { PageService } from './page-service.js';
import { randomUUID } from 'node:crypto';
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  type CopilotHonoApp,
} from '@copilotkit/runtime/v2';
import { createSlackChannel } from './slack-channel.js';
export { slackIdentity } from './slack-channel.js';
import { Store } from './store.js';
import { WorkspaceStore } from './workspace.js';
import { DotAgent } from './dot-agent.js';
import { runThreadTurn } from './headless.js';
import { setupStatus, type PlatformConfig } from './platform-config.js';
import { validateRuntimeScope } from './runtime-scope.js';
import { learningSelector } from './learning.js';
import { SetupTelemetry } from './setup-telemetry.js';
export class Platform {
  private channelStartupFailed = false;
  readonly setupTelemetry: SetupTelemetry;
  readonly pages: PageService;
  readonly computers: ComputerService;
  readonly connections: ConnectionService;
  readonly intelligence?: CopilotKitIntelligence;
  readonly handler: CopilotHonoApp;
  readonly runtime: CopilotRuntime;
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: PlatformConfig,
  ) {
    this.setupTelemetry = new SetupTelemetry(store);
    this.computers = new ComputerService(
      workspace,
      config,
      () => store.settings().paused,
    );
    this.connections = new ConnectionService(workspace.connections);
    if (config.intelligenceKey)
      this.intelligence = new CopilotKitIntelligence({
        apiKey: config.intelligenceKey,
        apiUrl: config.intelligenceApiUrl,
        wsUrl: config.intelligenceWsUrl,
        getLearningContainerId: learningSelector(
          workspace,
          config.slackDotId ?? workspace.dots()[0]?.id,
        ),
      });
    const channels = [];
    if (
      this.intelligence &&
      config.slackChannel &&
      config.slackTeam &&
      config.slackUsers.length
    ) {
      const dotId = config.slackDotId ?? workspace.dots()[0].id;
      if (!workspace.dot(dotId))
        throw new Error('SLACK_DOT_ID does not identify an existing Dot.');
      const slack = createSlackChannel({
        name: config.slackChannel,
        config,
        ownerId: workspace.ownerId,
        paused: () => store.settings().paused,
        agent: () =>
          new DotAgent(
            store,
            workspace,
            config,
            dotId,
            true,
            this.setupTelemetry,
          ),
      });
      channels.push(slack);
    }
    const agents = async () =>
      Object.fromEntries(
        workspace
          .dots()
          .map((dot) => [
            dot.id,
            new DotAgent(
              store,
              workspace,
              config,
              dot.id,
              false,
              this.setupTelemetry,
            ),
          ]),
      );
    this.runtime = this.intelligence
      ? new CopilotRuntime({
          intelligence: this.intelligence,
          telemetryId: this.setupTelemetry.identity,
          telemetryProperties: this.setupTelemetry.metadata,
          identifyUser: async () => ({
            id: workspace.ownerId,
            name: 'OpenDots owner',
          }),
          agents,
          channels,
          generateThreadNames: true,
        })
      : new CopilotRuntime({
          telemetryId: this.setupTelemetry.identity,
          telemetryProperties: this.setupTelemetry.metadata,
          agents,
          runner: new InMemoryAgentRunner(),
        });
    this.handler = createCopilotHonoHandler({
      runtime: this.runtime,
      basePath: '/api/copilotkit',
      cors: { origin: [] },
    });
    this.pages = new PageService(workspace, () => ({
      getOrCreateThread: async ({ threadId, agentId, name }) => {
        if (this.intelligence)
          return this.intelligence.getOrCreateThread({
            threadId,
            userId: workspace.ownerId,
            agentId,
            name,
          });
        return undefined;
      },
      getThreadMessages: async ({ threadId }) => {
        if (this.intelligence)
          return this.intelligence.getThreadMessages({
            threadId,
            userId: workspace.ownerId,
          });
        return {
          messages: (this.runtime.runner as InMemoryAgentRunner).getThreadMessages(
            threadId,
          ),
        };
      },
    }));
  }
  setup() {
    return setupStatus(
      this.config,
      this.handler.channels?.status().overall ??
        (this.config.slackChannel ? 'setup_required' : 'not_configured'),
      this.channelStartupFailed,
    );
  }
  requireReady() {
    const missing = this.setup().missing;
    if (missing.length)
      throw new Error(
        `Set ${missing.join(' and ')} to start a conversation.`,
      );
  }
  async start() {
    this.setupTelemetry.start();
    if (this.handler.channels) {
      try {
        await this.handler.channels.ready({ timeoutMs: 15000 });
        this.channelStartupFailed = false;
      } catch (error) {
        this.channelStartupFailed = true;
        this.setupTelemetry.capture({
          kind: 'setup_failed',
          step: 'settings',
          error_class: 'channel_start_failed',
        });
        throw error;
      }
    }
  }
  async stop() {
    await this.setupTelemetry.stop();
    await this.handler.channels?.stop();
  }
  async createConversation(dotId: string, title: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    const id = randomUUID();
    try {
      if (this.intelligence)
        await this.intelligence.createThread({
          threadId: id,
          userId: this.workspace.ownerId,
          agentId: dotId,
          name: title,
        });
    } catch {
      throw new Error('Could not create this conversation. Check your model API key.');
    }
    return this.workspace.bindThread(id, dotId, title);
  }
  async history(threadId: string): Promise<string> {
    this.requireReady();
    this.workspace.requireThread(threadId);
    const history = this.intelligence
      ? await this.intelligence.getThreadMessages({
          threadId,
          userId: this.workspace.ownerId,
        })
      : (this.runtime.runner as InMemoryAgentRunner).getThreadMessages(threadId);
    const messages = Array.isArray(history) ? history : history.messages;
    return messages
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .slice(-12)
      .map(
        (message) =>
          `${message.role}: ${typeof message.content === 'string' ? message.content : ''}`,
      )
      .join('\n')
      .slice(-12000);
  }
  async handle(request: Request): Promise<Response> {
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      body = await request
        .clone()
        .json()
        .catch(() => null);
    try {
      validateRuntimeScope(request, this.workspace, body);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Conversation scope denied.',
        },
        { status: 403 },
      );
    }
    return this.handler.fetch(request);
  }
  async turn(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    return runThreadTurn(
      this.config.runtimeUrl,
      this.config.ownerToken
        ? { Authorization: `Bearer ${this.config.ownerToken}` }
        : {},
      thread.dotId,
      threadId,
      prompt,
      signal,
      metadata,
    );
  }
}
