import { ProviderHttpError } from '../errors.js';

export class FirefliesTranscriptError extends ProviderHttpError {
  readonly path: string;
  constructor(path: string) {
    super('invalid_response', null, 'transcript_invalid');
    this.name = 'FirefliesTranscriptError';
    this.path = path.length <= 64 && /^[A-Za-z_]\w*(?:\.(?:[A-Za-z_]\w*|0|[1-9][0-9]*))*$/u.test(path)
      ? path : 'transcript';
  }
}
