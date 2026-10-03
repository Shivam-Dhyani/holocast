/** ID and token generation (TDD §1.6: UUIDv7 primary keys; FR-SHR-01: 21-char shareId). */

import { randomBytes } from 'node:crypto';

import { customAlphabet, nanoid } from 'nanoid';
import { uuidv7 } from 'uuidv7';

/** UUIDv7 primary key. */
export const newId = (): string => uuidv7();

/** 21-char URL-safe share id (FR-SHR-01). */
export const newShareId = (): string => nanoid(21);

/** 10-char lowercase alphanumeric public creator id (readable, FR path /c/<publicId>). */
const publicIdGen = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);
export const newPublicId = (): string => publicIdGen();

/** 32 random bytes, base64url — per-video upload token and session token. */
export const newSecretToken = (): string => randomBytes(32).toString('base64url');
