/**
 * Strip credentials from text that may end up in a log line or an error
 * message: `key=`, `access_token=` and similar query parameters, and bearer /
 * API-key header values.
 */
const SECRET_PARAM =
  /((?:^|[?&\s"'])(?:key|access_token|token|api_key|apikey|password|secret)=)[^&\s"'#]+/gi;
const SECRET_HEADER = /((?:authorization|x-webapi-key|x-api-key)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',}]+/gi;

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PARAM, "$1[redacted]").replace(SECRET_HEADER, "$1[redacted]");
}

/** Message of any thrown value, with credentials removed. */
export function safeErrorMessage(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}
