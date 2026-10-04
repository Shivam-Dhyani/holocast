/** vitest setupFile for AUTOTEST suites: default app secrets before config loads. */

function b64(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64');
}

process.env.MEDIA_URL_SECRET ??= b64(0x11);
process.env.APP_SECRET_KEY ??= b64(0x22);
process.env.UNLOCK_COOKIE_SECRET ??= b64(0x33);
process.env.STORAGE_KEKS ??= `itk:${b64(0x44)}`;
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3000';
