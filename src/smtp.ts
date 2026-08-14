/**
 * Public entry point for the `imap-mcp-server/smtp` subpath.
 *
 * This is a deliberately narrow surface: send-only consumers (e.g. a shared
 * mail-egress broker) must be able to import SMTP sending without pulling in
 * ImapService, AccountManager, or any other part of the package that can
 * read mail or touch the local credential store. Do not add exports here
 * without checking that they keep that import graph intact — see
 * tests/smtp-export-isolation.test.ts.
 */
export { SmtpService } from './services/smtp-service.js';
export type { ImapAccount, SmtpConfig, EmailComposer, EmailAttachment } from './types/index.js';
