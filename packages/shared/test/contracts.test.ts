import { describe, it, expect } from 'vitest';

import { CreateVideoRequest, TelegramId, UnlockRequest, Visibility } from '../src/index.js';

describe('shared contracts', () => {
  it('TelegramId coerces numbers and strings to string', () => {
    expect(TelegramId.parse(12345)).toBe('12345');
    expect(TelegramId.parse('67890')).toBe('67890');
  });

  it('CreateVideoRequest defaults visibility to UNLISTED', () => {
    expect(CreateVideoRequest.parse({}).visibility).toBe('UNLISTED');
  });

  it('CreateVideoRequest requires a password for PASSWORD visibility', () => {
    expect(() => CreateVideoRequest.parse({ visibility: 'PASSWORD' })).toThrow();
    expect(CreateVideoRequest.parse({ visibility: 'PASSWORD', password: 'secret1' }).password).toBe('secret1');
  });

  it('UnlockRequest enforces the 6-char minimum', () => {
    expect(() => UnlockRequest.parse({ password: 'short' })).toThrow();
  });

  it('Visibility rejects unknown values', () => {
    expect(() => Visibility.parse('SECRET')).toThrow();
  });
});
