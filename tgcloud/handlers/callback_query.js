import { api } from 'sdk';
import {
  doChannels,
  doHelp,
  doNews,
  doStatus,
  doToggle,
} from '../lib/actions.js';
import { errorMessage, escapeHtml } from '../lib/format.js';
import { isOwner } from '../lib/store.js';

export default async function (callback) {
  const chatId = callback.message?.chat?.id || callback.from?.id;
  const data = callback.data || '';

  const owner = await isOwner(callback.from?.id);
  if (!owner) {
    await api.answerCallbackQuery({
      callback_query_id: callback.id,
      text: 'Нет доступа.',
      show_alert: true,
    });
    return;
  }

  const hints = {
    news: 'Собираю новости…',
    status: 'Обновляю статус…',
    toggle: 'Меняю режим…',
    channels: 'Загружаю каналы…',
    help: 'Открываю справку…',
  };

  await api.answerCallbackQuery({
    callback_query_id: callback.id,
    text: hints[data] || 'Выполняю…',
  });

  try {
    if (data === 'news') await doNews(chatId);
    else if (data === 'status') await doStatus(chatId);
    else if (data === 'toggle') await doToggle(chatId);
    else if (data === 'channels') await doChannels(chatId);
    else if (data === 'help') await doHelp(chatId);
    else await api.sendMessage({ chat_id: chatId, text: 'Неизвестное действие.' });
  } catch (error) {
    console.error('Callback failed:', error);
    await api
      .sendMessage({
        chat_id: chatId,
        text: `⚠️ Ошибка: ${escapeHtml(errorMessage(error))}`,
        parse_mode: 'HTML',
      })
      .catch(() => {});
  }
}
