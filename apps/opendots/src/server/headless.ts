import { HttpAgent } from '@ag-ui/client';
import { IntelligenceAgent } from '@copilotkit/core';
import type { Message } from '@ag-ui/core';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { voiceReceiptMessagePrefix } from '../shared/voice-receipt.js';
import { scheduledTaskMessagePrefix } from '../shared/scheduled-message.js';

export function currentTurnText(messages: Message[], error?: Error): string {
  if (error) throw error;
  const content = messages
    .filter((message) => message.role === 'assistant')
    .at(-1)?.content;
  if (typeof content !== 'string' || !content.trim())
    throw new Error('The current compute turn returned no assistant response.');
  return content;
}

const runtimeInfoSchema = z.object({
  mode: z.enum(['intelligence', 'sse']),
  intelligence: z.object({ wsUrl: z.string().url() }).optional(),
  agents: z.record(z.string(), z.unknown()),
});

export async function runThreadTurn(
  runtimeUrl: string,
  headers: Record<string, string>,
  dotId: string,
  threadId: string,
  prompt: string,
  signal: AbortSignal,
  metadata?: Record<string, unknown>,
): Promise<string> {
  signal.throwIfAborted();
  const infoResponse = await fetch(`${runtimeUrl}/info`, { headers, signal });
  if (!infoResponse.ok)
    throw new Error(`Runtime discovery failed with HTTP ${infoResponse.status}`);
  const info = runtimeInfoSchema.parse(await infoResponse.json());
  if (!(dotId in info.agents)) throw new Error(`Dot is unavailable: ${dotId}`);

  const agent =
    info.mode === 'intelligence' && info.intelligence?.wsUrl
      ? new IntelligenceAgent({
          agentId: dotId,
          runtimeUrl,
          url: info.intelligence.wsUrl,
          headers,
        })
      : new HttpAgent({
          url: `${runtimeUrl}/agent/${encodeURIComponent(dotId)}/run`,
          agentId: dotId,
          threadId,
          headers,
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([signal, init.signal])
                : signal,
            }),
        });
  agent.threadId = threadId;
  let runError: Error | undefined;
  const subscription = agent.subscribe({
    onRunErrorEvent: ({ event }) => {
      runError = new Error(event.message);
    },
  });
  const stop = () => agent.abortRun();
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    const idPrefix =
      metadata?.opendotsSource === 'voice_receipt'
        ? voiceReceiptMessagePrefix
        : metadata?.opendotsSource === 'scheduled_task'
          ? scheduledTaskMessagePrefix
          : '';
    agent.addMessage({
      id: `${idPrefix}${randomUUID()}`,
      role: 'user',
      content: prompt,
      ...(metadata ? { metadata } : {}),
    });
    const result = await agent.runAgent();
    signal.throwIfAborted();
    return currentTurnText(result.newMessages, runError);
  } finally {
    signal.removeEventListener('abort', stop);
    subscription.unsubscribe();
    await agent.detachActiveRun();
  }
}
