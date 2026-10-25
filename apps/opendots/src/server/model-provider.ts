/**
 * Select one private OpenAI-compatible model gateway for chat, tools, research
 * and scheduled turns. The first configured provider wins.
 *
 * FreeLLMAPI is local-first; its unified key authenticates *your own router*,
 * not a hosted free-inference service. Configure provider keys in its dashboard.
 * Never expose this server-side key through browser/Vite configuration.
 */
export type ModelGatewayName = 'freellmapi' | 'openrouter' | 'openai';
export interface ModelGateway {
  provider: ModelGatewayName;
  apiKey?: string;
  model: string;
  baseUrl: string;
}
const value = (text: string | undefined): string | undefined => text?.trim() || undefined;

export function modelGatewayFromEnv(
  env: Record<string, string | undefined>,
): ModelGateway {
  const freeKey = value(env.FREELLMAPI_API_KEY);
  if (freeKey) {
    return {
      provider: 'freellmapi',
      apiKey: freeKey,
      model: value(env.FREELLMAPI_MODEL) ?? 'auto:smart',
      baseUrl: value(env.FREELLMAPI_BASE_URL) ?? 'http://127.0.0.1:3001/v1',
    };
  }

  const routerKey = value(env.OPENROUTER_API_KEY);
  if (routerKey) {
    return {
      provider: 'openrouter',
      apiKey: routerKey,
      model: value(env.OPENROUTER_MODEL) ?? value(env.OPENAI_MODEL) ?? 'openai/gpt-4o-mini',
      baseUrl: value(env.OPENROUTER_BASE_URL) ?? 'https://openrouter.ai/api/v1',
    };
  }
  return {
    provider: 'openai',
    apiKey: value(env.OPENAI_API_KEY),
    model: value(env.OPENAI_MODEL) ?? 'openai/gpt-4o-mini',
    baseUrl: value(env.OPENAI_BASE_URL) ?? 'https://api.openai.com/v1',
  };
}
