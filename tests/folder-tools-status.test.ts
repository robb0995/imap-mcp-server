import { describe, it, expect, vi, beforeEach } from 'vitest';
import { folderTools } from '../src/tools/folder-tools.js';

let folderStatusHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_folder_status') {
      folderStatusHandler = handler;
    }
  }),
};

const mockImapService = {
  selectFolder: vi.fn(),
};

describe('imap_folder_status Tool Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    folderTools(mockServer as any, mockImapService as any, { resolveAccountId: (id: string) => id } as any);
  });

  it('derives customKeywords from mailbox flags, excluding system flags', async () => {
    mockImapService.selectFolder.mockResolvedValueOnce({
      messages: { total: 10, new: 1, unseen: 2 },
      uidvalidity: 123,
      uidnext: 456,
      flags: new Set(['\\Seen', '\\Flagged', '$cl_3']),
      permanentFlags: new Set(['\\Seen', '\\Flagged', '$cl_3', '\\*']),
    });

    const result = await folderStatusHandler({ accountId: 'acc1', folder: 'INBOX' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.customKeywords).toEqual(['$cl_3']);
  });

  it('returns an empty customKeywords array when the mailbox has no custom keywords', async () => {
    mockImapService.selectFolder.mockResolvedValueOnce({
      messages: { total: 0, new: 0, unseen: 0 },
      uidvalidity: 1,
      uidnext: 1,
      flags: new Set(['\\Seen', '\\Deleted']),
      permanentFlags: new Set(['\\Seen', '\\Deleted']),
    });

    const result = await folderStatusHandler({ accountId: 'acc1', folder: 'INBOX' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.customKeywords).toEqual([]);
  });
});
