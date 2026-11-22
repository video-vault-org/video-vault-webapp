import { useEffect, useState } from 'react';
import { json } from '../lib/api';
import { encryptText, decryptText, sign, verify } from '../lib/crypto';
import type { Comment, Keys, User } from '../lib/types';
import { Dialog, ErrorMessage, useLanguage, useTask } from '../lib/ui';

const Comments = function ({
  videoId,
  keys,
  user,
  close
}: {
  videoId: string;
  keys: Keys;
  user: User;
  close: () => void;
}) {
  const { t, language } = useLanguage(),
    task = useTask();
  const [items, setItems] = useState<(Comment & { plain: string })[]>([]),
    [cursor, setCursor] = useState(''),
    [loaded, setLoaded] = useState(false),
    [content, setContent] = useState(''),
    [editing, setEditing] = useState<Comment>();

  const load = async function (reset = false) {
    await task.run(async () => {
      const response = await json<{ comments: Comment[]; cursor: string }>(
        `/api/comments/${videoId}?pagesize=50&cursor=${encodeURIComponent(reset ? '' : cursor)}`
      );
      const values: (Comment & { plain: string })[] = [];
      for (const comment of response.comments) {
        if (comment.deleted) {
          values.push({ ...comment, plain: '' });
          continue;
        }
        await verify(comment, keys);
        values.push({ ...comment, plain: await decryptText(comment.content, 'comment', comment.commentId, keys) });
      }

      setItems((prior) => {
        const map = new Map((reset ? [] : prior).map((c) => [c.commentId, c]));

        values.forEach((c) => map.set(c.commentId, c));

        return [...map.values()];
      });

      setCursor(response.cursor);
      setLoaded(true);
    });
  };

  useEffect(() => {
    void load(true);
  }, [videoId]);

  const submit = async function () {
    const ok = await task.run(async () => {
      const commentId = editing?.commentId ?? crypto.randomUUID(),
        now = new Date().toISOString();
      const item: Comment = {
        commentId,
        videoId,
        userId: editing?.userId ?? user.userId,
        content: await encryptText(content, 'comment', commentId, keys),
        created: editing?.created ?? now,
        lastModified: now,
        edited: !!editing,
        deleted: false,
        hmac: ''
      };
      item.hmac = await sign(item, keys);
      if (editing)
        await json(
          `/api/comment/change/${editing.userId === user.userId ? 'own/' : ''}${commentId}`,
          { content: item.content, lastModified: item.lastModified, hmac: item.hmac },
          'PATCH'
        );
      else {
        const { userId: _, edited: __, deleted: ___, ...body } = item;
        await json('/api/comment/submit', body);
      }
      setContent('');
      setEditing(undefined);
    });
    if (ok) await load(true);
  };

  return (
    <Dialog title={t('Kommentare', 'Comments')} close={close}>
      <ErrorMessage text={task.error} />
      <div className="comments">
        {loaded && !items.length && <p>{t('Noch keine Kommentare.', 'No comments yet.')}</p>}
        {items.map((c) => (
          <article className={`comment ${c.deleted ? 'tombstone' : ''}`} key={c.commentId}>
            <small>
              {c.userId === user.userId ? user.displayName : c.userId.slice(0, 8)} ·{' '}
              {new Date(c.created).toLocaleString(language)} {c.edited ? t('· bearbeitet', '· edited') : ''}
            </small>
            {c.deleted ? (
              <p>{t('Gelöscht · unverifizierte Löschmarkierung', 'Deleted · unverified deletion marker')}</p>
            ) : (
              <>
                <p className="prewrap">{c.plain}</p>
                <div className="actions">
                  <button
                    disabled={task.pending || !(user.moderator || c.userId === user.userId)}
                    onClick={() => {
                      setEditing(c);
                      setContent(c.plain);
                    }}
                  >
                    {t('Bearbeiten', 'Edit')}
                  </button>
                  <button
                    disabled={task.pending || !(user.moderator || c.userId === user.userId)}
                    onClick={() => {
                      if (confirm(t('Kommentar löschen?', 'Delete comment?')))
                        void task.run(async () => {
                          await json(
                            `/api/comment/delete/${c.userId === user.userId ? 'own/' : ''}${c.commentId}`,
                            undefined,
                            'DELETE'
                          );

                          setItems((old) =>
                            old.map((item) =>
                              item.commentId === c.commentId ? { ...item, deleted: true, content: '', plain: '' } : item
                            )
                          );
                        });
                    }}
                  >
                    {t('Löschen', 'Delete')}
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {cursor && (
        <button disabled={task.pending} onClick={() => void load()}>
          {t('Weitere Kommentare laden', 'Load more comments')}
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>{editing ? t('Kommentar bearbeiten', 'Edit comment') : t('Dein Kommentar', 'Your comment')}</span>
          <textarea required rows={3} value={content} maxLength={200000} onChange={(e) => setContent(e.target.value)} />
        </label>
        <div className="actions">
          <button className="primary" disabled={task.pending}>
            {t('Speichern', 'Save')}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(undefined);
                setContent('');
              }}
            >
              {t('Abbrechen', 'Cancel')}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
};

export { Comments };
