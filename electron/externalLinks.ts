export const MAX_EXTERNAL_URL_LENGTH = 2081;

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

export interface SafeExternalLink {
  hostname: string;
  protocol: 'http:' | 'https:';
  url: string;
}

export type ExternalLinkValidation =
  | { ok: true; link: SafeExternalLink }
  | {
      ok: false;
      reason:
        | 'not-string'
        | 'empty'
        | 'control-character'
        | 'too-long'
        | 'invalid-url'
        | 'unsupported-protocol'
        | 'missing-host'
        | 'credentials';
    };

export interface ExternalLinkOpenDependencies {
  confirm: (link: SafeExternalLink) => Promise<boolean>;
  open: (url: string) => Promise<void>;
}

export interface ExternalLinkOpenResult {
  opened: boolean;
}

export function validateExternalLink(candidate: unknown): ExternalLinkValidation {
  if (typeof candidate !== 'string') {
    return { ok: false, reason: 'not-string' };
  }
  if (CONTROL_CHARACTER.test(candidate)) {
    return { ok: false, reason: 'control-character' };
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }
  if (trimmed.length > MAX_EXTERNAL_URL_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: 'unsupported-protocol' };
  }
  if (!parsed.hostname) {
    return { ok: false, reason: 'missing-host' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials' };
  }

  const url = parsed.toString();
  if (url.length > MAX_EXTERNAL_URL_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  return {
    ok: true,
    link: {
      hostname: parsed.hostname,
      protocol: parsed.protocol as SafeExternalLink['protocol'],
      url
    }
  };
}

export function shouldPreventSubframeNavigation(candidate: unknown): boolean {
  if (typeof candidate !== 'string') {
    return true;
  }
  try {
    const parsed = new URL(candidate);
    return !(
      parsed.protocol === 'about:' &&
      (parsed.pathname === 'blank' || parsed.pathname === 'srcdoc')
    );
  } catch {
    return true;
  }
}

export async function openExternalLinkWithConfirmation(
  candidate: unknown,
  dependencies: ExternalLinkOpenDependencies
): Promise<ExternalLinkOpenResult> {
  const validation = validateExternalLink(candidate);
  if (!validation.ok) {
    throw new Error('지원하지 않는 외부 링크입니다. HTTP 또는 HTTPS 주소인지 확인하세요.');
  }
  if (!(await dependencies.confirm(validation.link))) {
    return { opened: false };
  }
  await dependencies.open(validation.link.url);
  return { opened: true };
}
