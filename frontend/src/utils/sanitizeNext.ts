// Aceita apenas paths internos ("/app/exam/123"); rejeita URLs absolutas e
// protocol-relative ("//evil.com") para o ?next= não virar open redirect.
export function sanitizeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/app';
  }
  return raw;
}
