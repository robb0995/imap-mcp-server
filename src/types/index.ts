export interface ImapAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  email?: string;
  loginMethod?: string;
  authTimeout?: number;
  connTimeout?: number;
  keepalive?: boolean;
  smtp?: SmtpConfig;
  saveToSent?: boolean;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  authMethod?: 'PLAIN' | 'LOGIN' | 'CRAM-MD5' | 'XOAUTH2';
  tls?: {
    rejectUnauthorized?: boolean;
  };
}

export interface EmailMessage {
  uid: number;
  date: Date;
  from: string;
  to: string[];
  subject: string;
  messageId: string;
  inReplyTo?: string;
  flags: string[];
  customKeywords: string[];
}

export type EmailBodyFormat = 'markdown' | 'text' | 'html' | 'auto';

export interface EmailContent extends EmailMessage {
  textContent?: string;
  htmlContent?: string;
  markdownContent?: string;
  bodyFormat?: EmailBodyFormat;
  headers: Record<string, string | string[]>;
  attachments: Attachment[];
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  textContent?: string;
  textContentTruncated?: boolean;
}

export interface Folder {
  name: string;
  delimiter: string;
  attributes: string[];
  /** RFC 6154 special-use attribute as parsed by imapflow (e.g. "\\Sent", "\\Drafts"). */
  specialUse?: string;
  children?: Folder[];
}

export interface SearchCriteria {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  since?: Date;
  before?: Date;
  seen?: boolean;
  flagged?: boolean;
  answered?: boolean;
  draft?: boolean;
  messageId?: string;
  /** Match messages that have ANY of these custom keywords (server-side OR). */
  keywords?: string[];
  /** Exclude messages that have ANY of these custom keywords (server-side; result has NONE of them). */
  unKeywords?: string[];
}

export interface EmailLocation {
  found: boolean;
  folder?: string;
  uid?: number;
  messageId?: string;
  subject?: string;
  from?: string;
  date?: Date;
  flags?: string[];
  customKeywords?: string[];
  foldersSearched?: string[];
}

export interface ConnectionPool {
  [accountId: string]: any; // IMAP connection instance
}

export interface EmailComposer {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  inReplyTo?: string;
  references?: string | string[];
}

export interface EmailAttachment {
  filename: string;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  contentDisposition?: 'attachment' | 'inline';
  cid?: string;
}

/** RFC 3501 system flags (documentation/tests only — see isSystemFlag for the authoritative check). */
export const SYSTEM_FLAGS = ['\\Seen', '\\Answered', '\\Flagged', '\\Deleted', '\\Draft', '\\Recent'];

/** RFC 3501: all system flags (and server extensions like `\*`) are backslash-prefixed; custom keywords never are. */
export function isSystemFlag(flag: string): boolean {
  return flag.startsWith('\\');
}
