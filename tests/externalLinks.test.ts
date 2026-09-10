import { describe, expect, it, vi } from 'vitest';
import {
  MAX_EXTERNAL_URL_LENGTH,
  openExternalLinkWithConfirmation,
  shouldPreventSubframeNavigation,
  validateExternalLink
} from '../electron/externalLinks';

describe('safe external links', () => {
  it('normalizes only absolute HTTP and HTTPS URLs with a host', () => {
    expect(validateExternalLink(' https://Example.com/report?q=1#result ')).toEqual({
      ok: true,
      link: {
        hostname: 'example.com',
        protocol: 'https:',
        url: 'https://example.com/report?q=1#result'
      }
    });
    expect(validateExternalLink('http://intranet.local:8080/path')).toEqual({
      ok: true,
      link: {
        hostname: 'intranet.local',
        protocol: 'http:',
        url: 'http://intranet.local:8080/path'
      }
    });
  });

  it.each([
    ['javascript:alert(1)', 'unsupported-protocol'],
    ['data:text/html,<h1>unsafe</h1>', 'unsupported-protocol'],
    ['file:///C:/private/report.html', 'unsupported-protocol'],
    ['blob:https://example.com/id', 'unsupported-protocol'],
    ['htmlpoint-asset://token/report.html', 'unsupported-protocol'],
    ['mailto:user@example.com', 'unsupported-protocol'],
    ['tel:+821012345678', 'unsupported-protocol'],
    ['//example.com/report', 'invalid-url'],
    ['/relative/report.html', 'invalid-url'],
    ['https://user:secret@example.com/report', 'credentials'],
    ['https://example.com\n.evil.test/report', 'control-character'],
    ['', 'empty']
  ])('rejects %s as %s', (candidate, reason) => {
    expect(validateExternalLink(candidate)).toEqual({ ok: false, reason });
  });

  it('rejects non-strings, malformed or hostless web URLs, and overlong values', () => {
    expect(validateExternalLink(undefined)).toEqual({ ok: false, reason: 'not-string' });
    expect(validateExternalLink('https://')).toEqual({ ok: false, reason: 'invalid-url' });
    expect(
      validateExternalLink(`https://example.com/${'a'.repeat(MAX_EXTERNAL_URL_LENGTH)}`)
    ).toEqual({ ok: false, reason: 'too-long' });
  });

  it('accepts the documented Windows shell limit but rejects the next character', () => {
    const prefix = 'https://example.com/';
    const atLimit = `${prefix}${'a'.repeat(MAX_EXTERNAL_URL_LENGTH - prefix.length)}`;
    expect(validateExternalLink(atLimit).ok).toBe(true);
    expect(validateExternalLink(`${atLimit}a`)).toEqual({ ok: false, reason: 'too-long' });
  });

  it('opens only after the confirmation callback approves the normalized URL', async () => {
    const confirm = vi.fn(async () => true);
    const open = vi.fn(async () => undefined);

    await expect(
      openExternalLinkWithConfirmation('HTTPS://Example.com/report', { confirm, open })
    ).resolves.toEqual({ opened: true });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'example.com', url: 'https://example.com/report' })
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/report');
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]);
  });

  it('does not call the opener after cancellation or invalid input', async () => {
    const cancel = vi.fn(async () => false);
    const open = vi.fn(async () => undefined);
    await expect(
      openExternalLinkWithConfirmation('https://example.com/report', {
        confirm: cancel,
        open
      })
    ).resolves.toEqual({ opened: false });
    expect(open).not.toHaveBeenCalled();

    const confirmInvalid = vi.fn(async () => true);
    await expect(
      openExternalLinkWithConfirmation('javascript:alert(1)', {
        confirm: confirmInvalid,
        open
      })
    ).rejects.toThrow('HTTP 또는 HTTPS');
    expect(confirmInvalid).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('allows initial srcdoc frames but blocks every document navigation away from them', () => {
    expect(shouldPreventSubframeNavigation('about:blank')).toBe(false);
    expect(shouldPreventSubframeNavigation('about:srcdoc')).toBe(false);
    expect(shouldPreventSubframeNavigation('about:srcdoc#section')).toBe(false);
    expect(shouldPreventSubframeNavigation('https://example.com')).toBe(true);
    expect(shouldPreventSubframeNavigation('file:///C:/private/report.html')).toBe(true);
    expect(shouldPreventSubframeNavigation('data:text/html,blank')).toBe(true);
    expect(shouldPreventSubframeNavigation('htmlpoint-asset://token/report.html')).toBe(true);
    expect(shouldPreventSubframeNavigation(undefined)).toBe(true);
  });
});
