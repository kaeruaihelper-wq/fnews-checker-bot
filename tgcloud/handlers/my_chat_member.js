import { api } from 'sdk';
import { runNewsCycle } from '../lib/autopost.js';
import { escapeHtml } from '../lib/format.js';
import { channelWelcomeText } from '../lib/panel.js';
import { setChannelEnabled, upsertChannel } from '../lib/store.js';

export default async function (update) {
  const chat = update.chat;
  const member = update.new_chat_member || {};
  const status = member.status;

  if (!chat || chat.type !== 'channel') return;

  if (status === 'administrator' || status === 'member') {
    const canPost = status === 'administrator' && member.can_post_messages !== false;

    await upsertChannel({
      chatId: chat.id,
      title: chat.title,
      username: chat.username,
      addedBy: update.from?.id,
      enabled: canPost,
    });

    if (!canPost) {
      if (update.from?.id) {
        await api
          .sendMessage({
            chat_id: update.from.id,
            text:
              `⚠️ Бот добавлен в канал «${escapeHtml(chat.title || chat.id)}», но без права публикации.\n\n` +
              `Выдайте @FNewsChecker_bot право «Публикация сообщений» — и канал включится автоматически.`,
            parse_mode: 'HTML',
          })
          .catch(() => {});
      }
      return;
    }

    try {
      await api.sendMessage({
        chat_id: chat.id,
        text: channelWelcomeText(chat.title),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.warn('Could not send channel welcome:', error?.message || String(error));
    }

    try {
      await runNewsCycle({ force: false, source: 'channel_added' });
    } catch (error) {
      console.error('Initial news cycle after channel add failed:', error);
    }

    return;
  }

  if (status === 'left' || status === 'kicked') {
    await setChannelEnabled(chat.id, false);
    console.log(`Bot removed from channel ${chat.id}; disabled.`);
  }
}
