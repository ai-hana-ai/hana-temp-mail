import { z } from 'zod';

export const mailboxLocalPartPattern = /^[a-z0-9._-]+$/;

export const mailboxLocalPartSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(mailboxLocalPartPattern, 'Mailbox local-part may only contain lowercase letters, numbers, dots, underscores, and hyphens.');

export function normalizeMailboxInput(input: string | null | undefined, mailDomain: string): string | null {
  if (!input) return null;

  const value = input.trim().toLowerCase();
  if (!value) return null;

  if (value.includes('@')) {
    const parts = value.split('@');
    if (parts.length !== 2) return null;

    const [localPart, domain] = parts;
    const parsedLocalPart = mailboxLocalPartSchema.safeParse(localPart);
    if (!parsedLocalPart.success || domain !== mailDomain) return null;
    return `${parsedLocalPart.data}@${mailDomain}`;
  }

  const parsedLocalPart = mailboxLocalPartSchema.safeParse(value);
  if (!parsedLocalPart.success) return null;
  return `${parsedLocalPart.data}@${mailDomain}`;
}
