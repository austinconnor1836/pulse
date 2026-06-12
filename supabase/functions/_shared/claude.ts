// Claude judge client — purpose→attributes, use-case fit scoring, why-copy
// generation, event extraction. Consumed by find-spots (W5), plan-day via
// find-spots (W6), events-feed/ingest-events (W8, W10), enrich-business (W11).
// Reads ANTHROPIC_API_KEY via env helper (W1). Prompts live in claude.prompts.ts
// (codification of find-spots/ingest-events SKILL.md). Never logs API key or
// full prompt content. Source-of-truth spec: specs/W4-claude-judge-client/spec.md

import Anthropic from 'npm:@anthropic-ai/sdk@0.40.1';
import { config } from './env.ts';
import type { Event, ScoreBreakdown } from '../../../shared/types.ts';
import type { PlacesCandidate } from './places.ts';
import {
  EXTRACT_EVENTS_SYSTEM,
  PURPOSE_TO_ATTRIBUTES_SYSTEM,
  SCORE_USE_CASE_FIT_SYSTEM,
  WHY_COPY_SYSTEM,
} from './claude.prompts.ts';

export interface UseCaseAttribute {
  attribute: string;
  weight: number;
}

export class ClaudeError extends Error {
  constructor(
    public readonly operation: string,
    public readonly status: number,
    public readonly body: string,
    public readonly requestId?: string,
  ) {
    super(
      `Claude ${operation} failed (${status}${requestId ? `, req=${requestId}` : ''}): ` +
        (body.length > 200 ? body.slice(0, 200) + '…' : body),
    );
    this.name = 'ClaudeError';
  }
}

// Model selection per spec D2:
//   - QUALITY for use-case fit + why-copy (low call volume, quality-sensitive).
//   - CHEAP for purpose→attributes + event extraction (high volume, structured).
// Bare aliases per claude-api skill — never append date suffixes.
export const MODEL_QUALITY = 'claude-opus-4-7' as const;
export const MODEL_CHEAP = 'claude-haiku-4-5' as const;

// Lazy singleton — importing this module without a key doesn't throw at load.
let _client: Anthropic | null = null;

// Stable JSON.stringify replacer for cache hashing.
function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

async function hashRequest(operation: string, request: unknown): Promise<string> {
  const payload = operation + '|' + JSON.stringify(request, sortKeysReplacer);
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

function fixturePath(dir: string, hash: string): string {
  return `${dir.replace(/\/$/, '')}/${hash}.json`;
}

async function readFixture(dir: string, hash: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(fixturePath(dir, hash));
  } catch {
    return null;
  }
}

async function writeFixture(dir: string, hash: string, text: string): Promise<void> {
  try {
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(fixturePath(dir, hash), text);
  } catch {
    // Best-effort capture; never fail the call because we couldn't record.
  }
}

interface CallArgs {
  model: typeof MODEL_QUALITY | typeof MODEL_CHEAP;
  system: string;
  user: string;
  maxTokens: number;
}

// Production callText: hits the Anthropic SDK. Tests override via __setCallTextForTest
// because the SDK in Deno doesn't go through globalThis.fetch (it uses its own
// bundled HTTP layer), so test-side fetch stubbing has no effect.
async function defaultCallText(operation: string, args: CallArgs): Promise<string> {
  // ConfigError throws here when ANTHROPIC_API_KEY is unset. We deliberately
  // touch config.anthropicApiKey before the fixture check so the test for
  // missing-env behavior fails fast (matches W3's pattern).
  const apiKey = config.anthropicApiKey;

  const fixtureDir = Deno.env.get('CLAUDE_FIXTURE_DIR');
  const recordDir = Deno.env.get('CLAUDE_RECORD_DIR');
  const hash = fixtureDir || recordDir ? await hashRequest(operation, args) : '';

  if (fixtureDir) {
    const cached = await readFixture(fixtureDir, hash);
    if (cached !== null) return cached;
  }

  try {
    // Top-level cache_control: auto-places ephemeral cache on the last
    // cacheable block (the system prompt for the small-prompt path; the
    // system + user prefix for scoreUseCaseFit's larger batched calls).
    // The SDK handles 429/5xx retries automatically.
    const sdk = _client ?? (_client = new Anthropic({ apiKey }));
    const response = await sdk.messages.create({
      model: args.model,
      max_tokens: args.maxTokens,
      system: [
        { type: 'text', text: args.system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: args.user }],
    });
    const firstText = response.content.find((b) => b.type === 'text');
    const text = firstText && firstText.type === 'text' ? firstText.text : '';
    if (recordDir) await writeFixture(recordDir, hash, text);
    return text;
  } catch (err) {
    const status = (err as { status?: number }).status ?? 0;
    const message = (err as Error).message ?? String(err);
    const requestId = (err as { request_id?: string }).request_id;
    throw new ClaudeError(operation, status, message, requestId);
  }
}

let _callTextImpl: (operation: string, args: CallArgs) => Promise<string> = defaultCallText;

async function callText(operation: string, args: CallArgs): Promise<string> {
  return _callTextImpl(operation, args);
}

// Test-only seam. The SDK in Deno does not go through globalThis.fetch, so we
// cannot stub HTTP from tests; instead, tests override callText itself. Production
// code MUST NOT call this. Pass undefined to restore the default implementation.
export function __setCallTextForTest(
  fn: ((operation: string, args: CallArgs) => Promise<string>) | undefined,
): void {
  _callTextImpl = fn ?? defaultCallText;
}

function tryParse<T>(text: string, fallback: T): T {
  try {
    const parsed = JSON.parse(text) as T;
    return parsed;
  } catch {
    return fallback;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export async function purposeToAttributes(purpose: string): Promise<UseCaseAttribute[]> {
  const text = await callText('purposeToAttributes', {
    model: MODEL_CHEAP,
    system: PURPOSE_TO_ATTRIBUTES_SYSTEM,
    user: purpose,
    maxTokens: 512,
  });
  const parsed = tryParse<unknown>(text, null);
  if (!Array.isArray(parsed)) {
    console.warn(`purposeToAttributes: malformed response, returning [] (purpose="${purpose.slice(0, 40)}")`);
    return [];
  }
  const valid: UseCaseAttribute[] = [];
  for (const item of parsed) {
    if (
      item && typeof item === 'object' &&
      typeof (item as UseCaseAttribute).attribute === 'string' &&
      typeof (item as UseCaseAttribute).weight === 'number' &&
      Number.isFinite((item as UseCaseAttribute).weight)
    ) {
      valid.push({
        attribute: (item as UseCaseAttribute).attribute,
        weight: (item as UseCaseAttribute).weight,
      });
    }
  }
  valid.sort((a, b) => b.weight - a.weight);
  return valid;
}

export async function scoreUseCaseFit(
  purpose: string,
  candidates: readonly PlacesCandidate[],
): Promise<Map<string, number>> {
  if (candidates.length === 0) return new Map();
  const userPayload = JSON.stringify({
    purpose,
    candidates: candidates.map((c) => ({ id: c.id, name: c.name, address: c.address })),
  });
  const text = await callText('scoreUseCaseFit', {
    model: MODEL_QUALITY,
    system: SCORE_USE_CASE_FIT_SYSTEM,
    user: userPayload,
    maxTokens: 1024,
  });
  const parsed = tryParse<Record<string, unknown>>(text, {});
  const result = new Map<string, number>();
  for (const c of candidates) {
    const raw = parsed[c.id];
    const score = typeof raw === 'number' ? clamp01(raw) : 0;
    result.set(c.id, score);
  }
  return result;
}

export async function whyCopy(
  purpose: string,
  candidate: PlacesCandidate,
  breakdown: ScoreBreakdown,
): Promise<string> {
  const userPayload = JSON.stringify({
    purpose,
    candidate: { id: candidate.id, name: candidate.name, address: candidate.address },
    breakdown,
  });
  const text = await callText('whyCopy', {
    model: MODEL_QUALITY,
    system: WHY_COPY_SYSTEM,
    user: userPayload,
    maxTokens: 128,
  });
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  const trimmed = firstLine.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length <= 140) return trimmed;
  return trimmed.slice(0, 139) + '…';
}

function isValidEvent(value: unknown): value is Event {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const requiredStrings = ['id', 'title', 'startISO', 'announcedAtISO'];
  for (const k of requiredStrings) {
    if (typeof v[k] !== 'string' || (v[k] as string).length === 0) return false;
  }
  return true;
}

export async function extractEvents(text: string): Promise<Event[]> {
  const responseText = await callText('extractEvents', {
    model: MODEL_CHEAP,
    system: EXTRACT_EVENTS_SYSTEM,
    user: text,
    maxTokens: 4096,
  });
  const parsed = tryParse<unknown>(responseText, null);
  if (!Array.isArray(parsed)) {
    console.warn('extractEvents: malformed response, returning []');
    return [];
  }
  const events: Event[] = [];
  let dropped = 0;
  for (const item of parsed) {
    if (isValidEvent(item)) {
      events.push(item);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) {
    console.warn(`extractEvents: dropped ${dropped} invalid item(s); kept ${events.length}`);
  }
  return events;
}
