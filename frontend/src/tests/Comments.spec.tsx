import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Comments } from '../components/Comments';
import { LanguageProvider } from '../lib/ui';
import { json } from '../lib/api';
import { encryptText, sign, verify } from '../lib/crypto';
import type { CommentDto, Keys, User } from '../lib/types';

vi.mock('../lib/api', async () => ({ ...(await vi.importActual('../lib/api')), json: vi.fn() }));

vi.mock('../lib/crypto', async () => ({
  ...(await vi.importActual('../lib/crypto')),
  decryptText: vi.fn().mockResolvedValue('Decrypted comment'),
  encryptText: vi.fn().mockResolvedValue('encrypted-new'),
  sign: vi.fn().mockResolvedValue('hmac-new'),
  verify: vi.fn().mockResolvedValue(undefined)
}));

const comment: CommentDto = {
  displayName: 'Me',
  commentId: 'c1',
  videoId: 'v1',
  userId: 'u1',
  content: 'encrypted',
  created: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-01T00:00:00.000Z',
  hmac: 'hmac',
  edited: false,
  deleted: false
};
const user = { userId: 'u1', displayName: 'Me', moderator: false } as User;

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(json).mockImplementation(async () => ({ comments: [comment], cursor: '' }));
});

const show = function (current = user) {
  render(
    <LanguageProvider>
      <Comments videoId="v1" user={current} keys={{} as Keys} close={() => {}} />
    </LanguageProvider>
  );
  return userEvent.setup();
};

test.each([
  ['de', 'bearbeitet'],
  ['en', 'edited']
])('shows the last modification date and time after the edited label in %s', async (language, label) => {
  const lastModified = '2026-02-03T14:25:00.000Z';
  localStorage.setItem('videovault.language', language);
  vi.mocked(json).mockResolvedValueOnce({ comments: [{ ...comment, edited: true, lastModified }], cursor: '' });
  show();
  await screen.findByText('Decrypted comment');
  const header = screen.getByText(new RegExp(`· ${label}`));
  expect(header).toHaveTextContent(`· ${label} ${new Date(lastModified).toLocaleString(language)}`);
  expect(header.querySelector('time')).toHaveAttribute('datetime', lastModified);
  expect(header).toHaveTextContent(new Date(comment.created).toLocaleString(language));
});

test('does not display an edited timestamp for an unedited comment', async () => {
  const lastModified = '2026-02-03T14:25:00.000Z';
  vi.mocked(json).mockResolvedValueOnce({ comments: [{ ...comment, lastModified }], cursor: '' });
  show();
  await screen.findByText('Decrypted comment');
  expect(screen.queryByText(/bearbeitet|edited/)).not.toBeInTheDocument();
  expect(screen.queryByText(new Date(lastModified).toLocaleString('de'))).not.toBeInTheDocument();
});

test('shows the server-provided display name for other authors instead of a shortened user ID', async () => {
  vi.mocked(json).mockResolvedValueOnce({ comments: [{ ...comment, userId: 'another-user-id', displayName: 'Bob Example' }], cursor: '' });
  show();
  expect(await screen.findByText(/Bob Example ·/)).toBeVisible();
  expect(screen.queryByText(/another-/)).not.toBeInTheDocument();
});

test('uses the current response name for own comments as well', async () => {
  vi.mocked(json).mockResolvedValueOnce({ comments: [{ ...comment, displayName: 'Renamed author' }], cursor: '' });
  show();
  expect(await screen.findByText(/Renamed author ·/)).toBeVisible();
});

test.each([['de', '[Gelöschter Nutzer]'], ['en', '[Deleted user]']])('shows the translated missing-author placeholder in %s', async (language, label) => {
  localStorage.setItem('videovault.language', language);
  vi.mocked(json).mockResolvedValueOnce({ comments: [{ ...comment, displayName: null, deleted: true, content: '' }], cursor: '' });
  show();
  expect(await screen.findByText((text) => text.startsWith(`${label} ·`))).toBeVisible();
});

test('loads subsequent pages, deduplicates IDs, ends at empty cursor and treats deleted shells as unverified', async () => {
  vi.mocked(json)
    .mockResolvedValueOnce({ comments: [comment], cursor: 'next/key' })
    .mockResolvedValueOnce({
      comments: [comment, { ...comment, commentId: 'deleted', deleted: true, content: '' }],
      cursor: ''
    });
  const actor = show();
  await actor.click(await screen.findByRole('button', { name: 'Weitere Kommentare laden' }));
  expect(await screen.findByText('Gelöscht')).toBeVisible();
  expect(screen.getAllByText('Decrypted comment')).toHaveLength(1);
  // noinspection SpellCheckingInspection
  expect(json).toHaveBeenCalledWith('/api/comments/v1?pagesize=50&cursor=next%2Fkey');
  expect(screen.queryByRole('button', { name: 'Weitere Kommentare laden' })).not.toBeInTheDocument();
  expect(vi.mocked(verify).mock.calls.every(([item]) => !('deleted' in item && item.deleted))).toBe(true);
});

test('posts encrypted contents with a fresh ID and keeps plaintext out of the request', async () => {
  vi.mocked(json).mockImplementation(async (path) =>
    String(path).startsWith('/api/comments') ? { comments: [], cursor: '' } : undefined
  );

  const actor = show();
  await screen.findByText('Noch keine Kommentare.');
  await actor.type(screen.getByLabelText('Dein Kommentar'), 'Secret comment');
  await actor.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() =>
    expect(json).toHaveBeenCalledWith(
      '/api/comment/submit',
      expect.objectContaining({ content: 'encrypted-new', hmac: 'hmac-new' })
    )
  );
  expect(encryptText).toHaveBeenCalledWith('Secret comment', 'comment', expect.any(String), {});
  expect(JSON.stringify(vi.mocked(json).mock.calls)).not.toContain('Secret comment');
});

test.each([false, true])('only owners or moderators may edit someone else’s comment (%s)', async (moderator) => {
  const actor = show({ ...user, userId: 'other', moderator });
  await screen.findByText('Decrypted comment');
  const button = screen.getByRole('button', { name: 'Bearbeiten' });
  if (!moderator) {
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeDisabled();
    return;
  }
  await actor.click(button);
  await actor.clear(screen.getByRole('textbox', { name: 'Kommentar bearbeiten' }));
  await actor.type(screen.getByRole('textbox', { name: 'Kommentar bearbeiten' }), 'Edited');
  await actor.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() =>
    expect(json).toHaveBeenCalledWith(
      '/api/comment/change/c1',
      expect.objectContaining({ content: 'encrypted-new' }),
      'PATCH'
    )
  );
  expect(sign).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', edited: true }), {});
});

test('own deletion uses the owner endpoint and immediately displays an empty tombstone', async () => {
  const actor = show();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await actor.click(await screen.findByRole('button', { name: 'Löschen' }));
  await waitFor(() => expect(json).toHaveBeenCalledWith('/api/comment/delete/own/c1', undefined, 'DELETE'));
  expect(await screen.findByText('Gelöscht')).toBeVisible();
  expect(screen.queryByText('Decrypted comment')).not.toBeInTheDocument();
});
