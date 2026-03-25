import { describe, expect, it } from 'vitest';
import { mailboxLocalPartPattern, mailboxLocalPartSchema, normalizeMailboxInput } from '../validation';

describe('validation', () => {
  it('accepts and normalizes valid local parts', () => {
    expect(mailboxLocalPartPattern.test('hana.mail_123')).toBe(true);
    expect(mailboxLocalPartSchema.parse('  Hana.Mail_123  ')).toBe('hana.mail_123');
    expect(normalizeMailboxInput(' Hana.Mail_123 ', 'adopsee.com')).toBe('hana.mail_123@adopsee.com');
  });

  it('accepts full mailbox input only for the configured domain', () => {
    expect(normalizeMailboxInput('MiXeD@adopsee.com', 'adopsee.com')).toBe('mixed@adopsee.com');
    expect(normalizeMailboxInput('mixed@other.test', 'adopsee.com')).toBeNull();
  });

  it('rejects invalid mailbox inputs', () => {
    expect(normalizeMailboxInput(null, 'adopsee.com')).toBeNull();
    expect(normalizeMailboxInput(undefined, 'adopsee.com')).toBeNull();
    expect(normalizeMailboxInput('   ', 'adopsee.com')).toBeNull();
    expect(normalizeMailboxInput('bad value', 'adopsee.com')).toBeNull();
    expect(normalizeMailboxInput('bad!value', 'adopsee.com')).toBeNull();
    expect(normalizeMailboxInput('a@b@adopsee.com', 'adopsee.com')).toBeNull();
    expect(normalizeMailboxInput(`${'a'.repeat(65)}@adopsee.com`, 'adopsee.com')).toBeNull();
  });
});
