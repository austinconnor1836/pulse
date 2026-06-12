// Typed config helper for Edge Functions. Reads secrets from Deno.env and throws a clear,
// named error when a required var is missing. Never log values from here.

export class ConfigError extends Error {
  constructor(public readonly varName: string) {
    super(
      `Missing required env var "${varName}". Set it in supabase/.env ` +
        `(local: \`supabase functions serve --env-file supabase/.env\`) ` +
        `or in prod via \`supabase secrets set ${varName}=…\`.`,
    );
    this.name = 'ConfigError';
  }
}

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (v === undefined || v === '') throw new ConfigError(name);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v === undefined || v === '' ? undefined : v;
}

// Lazy getters — importing `env.ts` in a function that doesn't need a given secret
// won't crash at module-load time. Each access re-reads Deno.env, so the values
// stay correct if the runtime injects vars after import (e.g. local --env-file).
export const config = Object.freeze({
  get anthropicApiKey(): string {
    return requireEnv('ANTHROPIC_API_KEY');
  },
  get googlePlacesApiKey(): string {
    return requireEnv('GOOGLE_PLACES_API_KEY');
  },
  get ingestSecret(): string {
    return requireEnv('INGEST_SECRET');
  },
  get supabaseUrl(): string {
    return requireEnv('SUPABASE_URL');
  },
  get supabaseServiceRoleKey(): string {
    return requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  },
  get redditUserAgent(): string | undefined {
    return optionalEnv('REDDIT_USER_AGENT');
  },
  get eventbriteToken(): string | undefined {
    return optionalEnv('EVENTBRITE_TOKEN');
  },
  get diceToken(): string | undefined {
    return optionalEnv('DICE_TOKEN');
  },
});
