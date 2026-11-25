export type ProviderErrorCode = 'rejected' | 'rate_limited' | 'unavailable' | 'not_found' | 'request_failed' | 'invalid_response';

export class ProviderHttpError extends Error {
  readonly retryAfterMs: number | null;

  constructor(readonly code: ProviderErrorCode, readonly status: number | null, readonly detail: string | null = null,
    metadata: { retryAfterMs?: number | null } = {}) {
    super(code);
    this.name = 'ProviderHttpError';
    this.retryAfterMs = metadata.retryAfterMs ?? null;
  }
}

export class GrantRevoked extends Error {
  constructor(readonly detail: string | null = null) {
    super('grant_revoked');
    this.name = 'GrantRevoked';
  }
}

export class SecretUnavailable extends Error {
  constructor() {
    super('secret_unavailable');
    this.name = 'SecretUnavailable';
  }
}

export class RefreshBusy extends Error {
  constructor() {
    super('refresh_busy');
    this.name = 'RefreshBusy';
  }
}
