import { Injectable, Logger } from '@nestjs/common';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Server-side verification of a Cloudflare Turnstile token from the
 * self-serve /signup form. Fails closed: any ambiguity (missing secret,
 * non-2xx response, transport error) is treated as verification-failed,
 * since the whole point is to block automated submissions.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  async verify(token: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      this.logger.warn('TURNSTILE_SECRET_KEY is not set; rejecting captcha verification');
      return false;
    }

    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, response: token }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as SiteverifyResponse;
      return body.success === true;
    } catch (e: unknown) {
      this.logger.warn(`Turnstile verification request failed: ${(e as Error).message}`);
      return false;
    }
  }
}
