// Run: `deno test supabase/functions/_shared/env.test.ts`
import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { config, ConfigError, optionalEnv, requireEnv } from './env.ts';

const SCRATCH = 'PULSE_ENV_TEST_VAR';

function clearScratch() {
  Deno.env.delete(SCRATCH);
  Deno.env.delete('ANTHROPIC_API_KEY');
}

Deno.test('requireEnv throws ConfigError when unset', () => {
  clearScratch();
  const err = assertThrows(() => requireEnv(SCRATCH), ConfigError);
  assertEquals((err as ConfigError).varName, SCRATCH);
});

Deno.test('requireEnv throws ConfigError when empty string', () => {
  Deno.env.set(SCRATCH, '');
  assertThrows(() => requireEnv(SCRATCH), ConfigError);
  clearScratch();
});

Deno.test('requireEnv returns the value when set', () => {
  Deno.env.set(SCRATCH, 'hello');
  assertEquals(requireEnv(SCRATCH), 'hello');
  clearScratch();
});

Deno.test('optionalEnv returns undefined when unset', () => {
  clearScratch();
  assertEquals(optionalEnv(SCRATCH), undefined);
});

Deno.test('optionalEnv returns undefined when empty string', () => {
  Deno.env.set(SCRATCH, '');
  assertEquals(optionalEnv(SCRATCH), undefined);
  clearScratch();
});

Deno.test('optionalEnv returns the value when set', () => {
  Deno.env.set(SCRATCH, 'world');
  assertEquals(optionalEnv(SCRATCH), 'world');
  clearScratch();
});

Deno.test('config.anthropicApiKey throws ConfigError when unset', () => {
  clearScratch();
  assertThrows(() => config.anthropicApiKey, ConfigError);
});

Deno.test('config.anthropicApiKey returns value when set', () => {
  Deno.env.set('ANTHROPIC_API_KEY', 'sk-test-123');
  assertEquals(config.anthropicApiKey, 'sk-test-123');
  clearScratch();
});

Deno.test('ConfigError message names the missing var and the file to set it in', () => {
  const err = new ConfigError('FOO_BAR');
  assertEquals(err.varName, 'FOO_BAR');
  assertEquals(err.name, 'ConfigError');
  if (!err.message.includes('FOO_BAR')) throw new Error('message must name the var');
  if (!err.message.includes('supabase/.env')) throw new Error('message must cite supabase/.env');
});
