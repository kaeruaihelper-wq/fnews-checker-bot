import { api } from 'sdk';
import {
  doAddChannel,
  doChannels,
  doHelp,
  doNews,
  doRemoveChannel,
  doSetChannel,
  doSetMaxPosts,
  doSetEnabled,
  doSetInterval,
  doStatus,
  doToggle,
  doWelcome,
} from '../lib/actions.js';
import { errorMessage, escapeHtml } from '../lib/format.js';
import { isOwner } from '../lib/store.js';

const COMMAND_RE = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

async function reply(chatId, text) {
  return api.sendMessage({
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}

export default async function (message) {
  if (message.chat?.type !== 'private') return;

  const chatId = message.chat.id;
  const text = String(message.text || '').trim();
  const match = COMMAND_RE.exec(text);

  if (!match) {
    await reply(chatId, 'Используйте /help, чтобы увидеть команды, или /news, чтобы получить свежие новости.');
    return;
  }

  const command = match[1].toLowerCase();
  const arg = (match[2] || '').trim();
  const owner = await isOwner(message.from?.id);

  try {
    if (!owner && command !== 'start' && command !== 'help') {
      await reply(
        chatId,
        'Этот экземпляр FNEWS управляется владельцем.\n\n' +
        'Чтобы получать финансовые новости в своём канале, добавьте @FNewsChecker_bot ' +
        'администратором с правом «Публикация сообщений» — или создайте собственную копию бота.',
      );
      return;
    }

    switch (command) {
      case 'start':
        await doWelcome(chatId);
        break;
      case 'help':
        await doHelp(chatId);
        break;
      case 'status':
        await doStatus(chatId);
        break;
      case 'news':
      case 'latest':
        await doNews(chatId);
        break;
      case 'preview':
        await doNews(chatId, { dryRun: true });
        break;
      case 'pause':
        await doSetEnabled(chatId, false);
        break;
      case 'resume':
        await doSetEnabled(chatId, true);
        break;
      case 'interval':
        await doSetInterval(chatId, arg);
        break;
      case 'digest':
      case 'posts':
        await doSetMaxPosts(chatId, arg);
        break;
      case 'channels':
        await doChannels(chatId);
        break;
      case 'addchannel':
        await doAddChannel(chatId);
        break;
      case 'setchannel':
        await doSetChannel(chatId, arg);
        break;
      case 'removechannel':
        await doRemoveChannel(chatId, arg);
        break;
      default:
        await reply(chatId, `Неизвестная команда: /${escapeHtml(command)}\n\n/help — список команд.`);
    }
  } catch (error) {
    console.error(`Command /${command} failed:`, error);
    await reply(chatId, `⚠️ Ошибка: ${escapeHtml(errorMessage(error))}`).catch(() => {});
  }
}
