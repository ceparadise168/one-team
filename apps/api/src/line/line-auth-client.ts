import { ValidationError } from '../errors.js';

export interface LineAuthClient {
  validateIdToken(idToken: string): Promise<{ lineUserId: string }>;
}

export class StubLineAuthClient implements LineAuthClient {
  async validateIdToken(idToken: string): Promise<{ lineUserId: string }> {
    if (!idToken.startsWith('line-id:')) {
      throw new ValidationError('LINE ID token format is invalid');
    }

    const lineUserId = idToken.replace('line-id:', '').trim();

    if (!lineUserId) {
      throw new ValidationError('LINE user identity is missing from id token');
    }

    return { lineUserId };
  }
}
