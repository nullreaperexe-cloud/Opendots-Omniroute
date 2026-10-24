import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  computerInputs,
  computerPermissionsSchema,
  type ComputerAction,
  type ComputerControl,
  type ComputerPermissions,
  type ComputerStatus,
} from '../shared/computer-types.js';
import type { WorkspaceStore } from './workspace.js';
import type { PlatformConfig } from './platform-config.js';
const stateSchema = z.object({
  botId: z.string(),
  container: z.string(),
  status: z.string(),
  port: z.number().int().min(1024).max(65535).optional(),
  url: z.string().optional(),
});
const controlSchema = z.object({
  holder: z.enum(['bot', 'human']),
  requested: z.boolean(),
  transitioning: z.boolean(),
  resumeSnapshotRequired: z.boolean(),
  request: z.object({ id: z.string(), status: z.string() }).optional(),
});
type LocalBrowser = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  snapshotId: number;
  refs: Set<string>;
  holder: 'bot' | 'human';
};
const localBrowserSessions = new Map<string, LocalBrowser>();
export class ComputerService {
  private readonly localFallback: boolean;
  private readonly localBrowsers = localBrowserSessions;
  constructor(
    private workspace: WorkspaceStore,
    private config: PlatformConfig,
    private paused: () => boolean,
    private transport: typeof fetch = fetch,
    private deadlineMs = 70000,
  ) {
    this.localFallback = !config.computerSupervisorUrl?.trim();
  }
  get configured() {
    return !!(
      this.localFallback ||
      (this.config.computerSupervisorUrl?.trim() &&
        this.config.computerSupervisorToken?.trim() &&
        this.config.computerToken?.trim())
    );
  }
  private localPolicy(id: string): ComputerPermissions {
    const policy = this.workspace.computers.permissions(id);
    // Development fallback starts with browser-only access. Explicit patches
    // still win, and files/shell remain disabled until separately enabled.
    if (
      this.localFallback &&
      !policy.enabled &&
      !policy.browser &&
      !policy.files &&
      !policy.shell
    )
      return { ...policy, enabled: true, browser: true };
    return policy;
  }
  private chromePath() {
    const candidates = [
      process.env.CHROME_PATH,
      process.platform === 'win32'
        ? `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`
        : '/usr/bin/google-chrome',
      process.platform === 'win32'
        ? `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`
        : '/usr/bin/chromium',
    ].filter((value): value is string => !!value);
    return candidates.find((value) => existsSync(value));
  }
  private async localBrowser(id: string) {
    this.requireDot(id);
    const existing = this.localBrowsers.get(id);
    if (existing) return existing;
    const browser = await chromium.launch({
      headless: true,
      ...(this.chromePath() ? { executablePath: this.chromePath() } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const entry = {
      browser,
      context,
      page,
      snapshotId: 0,
      refs: new Set<string>(),
      holder: 'bot' as const,
    };
    this.localBrowsers.set(id, entry);
    return entry;
  }
  private async localSnapshot(id: string) {
    const entry = await this.localBrowser(id);
    entry.snapshotId += 1;
    entry.refs.clear();
    const refs = await entry.page.locator('a,button,input,textarea,select,[role="button"],[role="link"]').evaluateAll((elements) =>
      elements.filter((element) => !element.matches(':disabled')).slice(0, 120).map((element, index) => {
        const ref = `ref_${index + 1}`;
        element.setAttribute('data-opendots-ref', ref);
        return {
          ref,
          role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
          name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 240),
          value: 'value' in element ? String((element as HTMLInputElement).value ?? '') : '',
        };
      }),
    );
    for (const item of refs) entry.refs.add(item.ref);
    return {
      snapshotId: entry.snapshotId,
      url: entry.page.url(),
      title: await entry.page.title().catch(() => ''),
      text: (await entry.page.locator('body').innerText().catch(() => '')).slice(0, 24000),
      refs,
    };
  }
  private async localAction(
    id: string,
    action: ComputerAction,
    input: unknown,
    actor: 'owner' | 'agent',
  ) {
    const entry = await this.localBrowser(id);
    const data = input as Record<string, unknown>;
    if (actor === 'agent' && entry.holder === 'human')
      throw new Error('The owner currently controls this browser.');
    if (action === 'navigate') {
      await entry.page.goto(String(data.url), { waitUntil: 'domcontentloaded', timeout: this.deadlineMs });
      return { url: entry.page.url(), title: await entry.page.title().catch(() => '') };
    }
    if (action === 'snapshot' || action === 'read') return this.localSnapshot(id);
    if (action === 'screenshot') {
      const image = await entry.page.screenshot({ type: 'png' });
      const viewport = entry.page.viewportSize() ?? { width: 1280, height: 800 };
      return {
        base64: image.toString('base64'),
        url: entry.page.url(),
        capturedAt: Date.now(),
        width: viewport.width,
        height: viewport.height,
      };
    }
    if (action === 'click' || action === 'type') {
      if (!entry.refs.has(String(data.ref)))
        throw new Error('Browser ref is stale. Take a fresh computer_snapshot.');
      const locator = entry.page.locator(`[data-opendots-ref="${String(data.ref)}"]`);
      if (action === 'click') await locator.click();
      else {
        await locator.fill(String(data.text));
        if (data.submit === true) await locator.press('Enter');
      }
      return { ok: true, url: entry.page.url() };
    }
    if (action === 'key') {
      await entry.page.keyboard.press(String(data.key));
      return { ok: true };
    }
    if (action === 'scroll') {
      await entry.page.mouse.wheel(0, Number(data.deltaY));
      return { ok: true, url: entry.page.url() };
    }
    if (action === 'human_click') {
      await entry.page.mouse.click(Number(data.x), Number(data.y));
      return { ok: true };
    }
    if (action === 'human_type') {
      await entry.page.keyboard.type(String(data.text));
      return { ok: true };
    }
    if (action === 'human_key') {
      await entry.page.keyboard.press(String(data.key));
      return { ok: true };
    }
    if (action === 'human_scroll') {
      await entry.page.mouse.wheel(0, Number(data.deltaY));
      return { ok: true };
    }
    throw new Error('Files and shell require the managed computer service.');
  }
  private token(id: string) {
    return createHmac('sha256', this.config.computerToken!.trim())
      .update(`opendots-computer:${id}`)
      .digest('hex');
  }
  private requireDot(id: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || !this.workspace.dot(id))
      throw new Error('Dot not found.');
  }
  private allowed(
    id: string,
    kind: 'browser' | 'files' | 'shell' | undefined,
    actor: 'agent' | 'owner',
  ) {
    this.requireDot(id);
    if (!this.configured)
      throw new Error('Computer service is not configured.');
    const policy = this.localPolicy(id);
    if (!policy.enabled || (kind && !policy[kind]))
      throw new Error('Computer permission is disabled.');
    if (actor === 'agent' && this.paused())
      throw new Error('Agents are paused.');
  }
  private async json(
    url: string,
    token: string,
    body: unknown | undefined,
    signal?: AbortSignal,
    dotId?: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.deadlineMs);
    const combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    try {
      const response = await this.transport(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(dotId ? { 'x-openbot-bot-id': dotId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: combined,
      });
      if (response.status === 409)
        throw new Error(
          'Computer service returned HTTP 409: refresh the browser with computer_snapshot before retrying. If the owner has control, wait for them to release it; do not bypass takeover.',
        );
      if (!response.ok)
        throw new Error(`Computer service returned HTTP ${response.status}.`);
      if (!response.body)
        throw new Error('Computer service returned an empty response.');
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4_000_000) {
          await reader.cancel();
          throw new Error('Computer response exceeded its size limit.');
        }
        chunks.push(value);
      }
      // Infrastructure secrets must never leave the gateway even if an upstream response reflects one.
      let text = Buffer.concat(chunks).toString('utf8');
      for (const secret of [
        token,
        this.config.computerToken?.trim(),
        this.config.computerSupervisorToken?.trim(),
      ])
        if (secret) text = text.split(secret).join('[redacted]');
      return JSON.parse(text);
    } catch (error) {
      if (combined.aborted)
        throw new Error('Computer request was cancelled or timed out.', {
          cause: error,
        });
      if (
        error instanceof Error &&
        /^Computer (service returned|response exceeded)/.test(error.message)
      )
        throw error;
      throw new Error(
        'Computer service is unavailable or returned an invalid response.',
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  private supervisor(path: string, body?: unknown, signal?: AbortSignal) {
    return this.json(
      `${this.config.computerSupervisorUrl!.replace(/\/$/, '')}${path}`,
      this.config.computerSupervisorToken!.trim(),
      body,
      signal,
    );
  }
  private parseUpstream<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success)
      throw new Error('Computer service returned an invalid response.', {
        cause: result.error,
      });
    return result.data;
  }
  private endpoint(id: string, raw: unknown) {
    const state = this.parseUpstream(stateSchema, raw);
    const ns = this.config.computerNamespace ?? 'opendots';
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(ns))
      throw new Error('Invalid computer namespace.');
    const expected = `${ns}-computer-${id}`;
    if (state.botId !== id || state.container !== expected)
      throw new Error('Computer identity mismatch.');
    const url = new URL(
      state.url ??
        (state.port
          ? `http://127.0.0.1:${state.port}`
          : `http://${expected}:4100`),
    );
    const network =
      url.hostname === expected.toLowerCase() && url.port === '4100';
    const local =
      url.hostname === '127.0.0.1' &&
      !!state.port &&
      url.port === String(state.port) &&
      new URL(this.config.computerSupervisorUrl!).hostname === '127.0.0.1';
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (!network && !local)
    )
      throw new Error('Computer endpoint is not bound to this Dot.');
    return url.origin;
  }
  private async existing(id: string, signal?: AbortSignal) {
    const listing = this.parseUpstream(
      z.object({ computers: z.array(stateSchema) }),
      await this.supervisor('/computers', undefined, signal),
    );
    return listing.computers.find((c) => c.botId === id);
  }
  private async running(id: string, signal?: AbortSignal) {
    const state = await this.existing(id, signal);
    if (!state || state.status !== 'running')
      throw new Error('Start this Dot’s computer first.');
    return this.endpoint(id, state);
  }
  async status(id: string): Promise<ComputerStatus> {
    this.requireDot(id);
    const base = {
      configured: this.configured,
      permissions: this.localPolicy(id),
      audit: this.workspace.computers.audit(id),
    };
    if (!this.configured) return { ...base, state: 'not_configured' };
    if (this.localFallback) {
      const entry = this.localBrowsers.get(id);
      return {
        ...base,
        state: entry ? 'running' : 'stopped',
        ...(entry
          ? {
              control: {
                holder: entry.holder,
                requested: false,
                transitioning: false,
                resumeSnapshotRequired: false,
              },
            }
          : {}),
      };
    }
    try {
      const state = await this.existing(id);
      if (!state || state.status !== 'running')
        return { ...base, state: 'stopped' };
      const url = this.endpoint(id, state);
      const control = controlSchema.parse(
        await this.json(
          `${url}/control`,
          this.token(id),
          undefined,
          undefined,
          id,
        ),
      );
      return { ...base, state: 'running', control };
    } catch {
      return {
        ...base,
        state: 'unavailable',
        error:
          'Computer service is unavailable. Check the supervisor configuration and connection.',
      };
    }
  }
  private async audited<T>(
    id: string,
    action: string,
    actor: 'owner' | 'agent',
    fn: () => Promise<T>,
  ): Promise<T> {
    this.requireDot(id);
    const receipt = this.workspace.computers.begin(id, action, actor);
    try {
      const result = await fn();
      this.workspace.computers.finish(receipt, 'succeeded');
      return result;
    } catch (error) {
      this.workspace.computers.finish(receipt, 'failed');
      throw error;
    }
  }
  async permissions(id: string, input: unknown) {
    const patch = computerPermissionsSchema.partial().parse(input);
    await this.audited(id, 'permissions', 'owner', async () =>
      this.workspace.computers.patch(id, patch),
    );
    return this.status(id);
  }
  async start(id: string) {
    if (this.localFallback) {
      await this.audited(id, 'start', 'owner', async () => {
        await this.localBrowser(id);
      });
      return this.status(id);
    }
    await this.audited(id, 'start', 'owner', async () => {
      this.allowed(id, undefined, 'owner');
      this.endpoint(id, await this.supervisor(`/computers/${id}/ensure`, {}));
    });
    return this.status(id);
  }
  async stop(id: string) {
    if (this.localFallback) {
      await this.audited(id, 'stop', 'owner', async () => {
        const entry = this.localBrowsers.get(id);
        if (entry) {
          await entry.context.close().catch(() => {});
          await entry.browser.close().catch(() => {});
          this.localBrowsers.delete(id);
        }
      });
      return this.status(id);
    }
    await this.audited(id, 'stop', 'owner', async () => {
      if (!this.configured)
        throw new Error('Computer service is not configured.');
      await this.supervisor(`/computers/${id}/stop`, {});
    });
    return this.status(id);
  }
  async control(id: string, verb: 'take' | 'release') {
    if (this.localFallback) {
      await this.audited(id, verb, 'owner', async () => {
        const entry = await this.localBrowser(id);
        entry.holder = verb === 'take' ? 'human' : 'bot';
      });
      return this.status(id);
    }
    await this.audited(id, verb, 'owner', async () => {
      if (!this.configured)
        throw new Error('Computer service is not configured.');
      if (verb === 'take') this.allowed(id, 'browser', 'owner');
      const url = await this.running(id);
      if (verb === 'take') this.allowed(id, 'browser', 'owner');
      let control: ComputerControl = this.parseUpstream(
        controlSchema,
        await this.json(
          `${url}/control`,
          this.token(id),
          undefined,
          undefined,
          id,
        ),
      );
      if (verb === 'take' && !control.request)
        control = this.parseUpstream(
          controlSchema,
          await this.json(
            `${url}/control/request`,
            this.token(id),
            { reason: 'Owner requested control.' },
            undefined,
            id,
          ),
        );
      if (
        verb === 'take' &&
        control.request &&
        !['waiting', 'taken'].includes(control.request.status)
      )
        control = this.parseUpstream(
          controlSchema,
          await this.json(
            `${url}/control/request`,
            this.token(id),
            { reason: 'Owner requested control.' },
            undefined,
            id,
          ),
        );
      if (!control.request)
        throw new Error('There is no active control request.');
      await this.json(
        `${url}/control/${verb}`,
        this.token(id),
        { requestId: control.request.id },
        undefined,
        id,
      );
    });
    return this.status(id);
  }
  async action(
    id: string,
    action: ComputerAction,
    input: unknown,
    actor: 'owner' | 'agent' = 'owner',
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!Object.hasOwn(computerInputs, action))
      throw new Error('Unknown computer action.');
    const parsed = computerInputs[action].parse(input);
    if (this.localFallback) {
      const kind = action.startsWith('human_') ? 'browser' :
        action === 'exec' ? 'shell' : action.startsWith('files_') ? 'files' : 'browser';
      if (kind !== 'browser') throw new Error('Files and shell require the managed computer service.');
      this.allowed(id, kind, actor);
      return this.audited(id, action, actor, () =>
        this.localAction(id, action, parsed as never, actor),
      );
    }
    return this.audited(id, action, actor, async () => {
      if (actor === 'agent' && action.startsWith('human_'))
        throw new Error('Human controls are owner-only.');
      const kind =
        action === 'exec'
          ? 'shell'
          : action.startsWith('files_')
            ? 'files'
            : 'browser';
      this.allowed(id, kind, actor);
      const cancellation = new AbortController();
      const activeSignal = signal
        ? AbortSignal.any([signal, cancellation.signal])
        : cancellation.signal;
      const watcher = setInterval(() => {
        try {
          this.allowed(id, kind, actor);
        } catch {
          cancellation.abort();
        }
      }, 50);
      try {
        const url = await this.running(id, activeSignal);
        this.allowed(id, kind, actor);
        activeSignal.throwIfAborted();
        const path = action
          .replace(/^files_/, 'files/')
          .replace(/^human_/, 'human/');
        const result = await this.json(
          `${url}/${path}`,
          this.token(id),
          ['read', 'screenshot'].includes(action) ? undefined : parsed,
          activeSignal,
          id,
        );
        this.allowed(id, kind, actor);
        if (action === 'exec' && result && typeof result === 'object') {
          const copy = { ...result } as Record<string, unknown>;
          delete copy.command;
          return copy;
        }
        return result;
      } finally {
        clearInterval(watcher);
      }
    });
  }
}
