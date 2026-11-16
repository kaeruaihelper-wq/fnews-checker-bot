import { api } from 'sdk';
import {
  BOT_USERNAME,
  MAX_INTERVAL_MINUTES,
  MAX_MAX_POSTS,
  MIN_INTERVAL_MINUTES,
  MIN_MAX_POSTS,
} from './config.js';
import { previewNews, runNewsCycle } from './autopost.js';
import { buildCaption, escapeHtml, errorMessage, plural } from './format.js';
import {
  countSeen,
  getChannels,
  getSettings,
  setChannelEnabled,
  updateSettings,
  upsertChannel,
} from './store.js';
import {
  addChannelText,
  channelsText,
  helpText,
  mainKeyboard,
  skipText,
  statusText,
  welcomeText,
} from './panel.js';

async function send(chatId, text, extra = {}) {
  return api.sendMessage({
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

async function typing(chatId) {
  try {
    await api.sendChatAction({ chat_id: chatId, action: 'typing' });
  } catch {
    // Typing is cosmetic; never fail a command because of it.
  }
}

export async function doWelcome(chatId) {
  const [settingsRow, channels] = await Promise.all([getSettings(), getChannels()]);
  await send(chatId, welcomeText(settingsRow, channels), {
    reply_markup: mainKeyboard(settingsRow.enabled),
  });
}

export async function doHelp(chatId) {
  await send(chatId, helpText());
}

export async function doStatus(chatId) {
  const [settingsRow, channels, seen] = await Promise.all([
    getSettings(),
    getChannels(),
    countSeen(),
  ]);
  await send(chatId, statusText(settingsRow, channels, seen));
}

export async function doChannels(chatId) {
  const channels = await getChannels();
  await send(chatId, channelsText(channels));
}

export async function doSetEnabled(chatId, enabled) {
  const settingsRow = await getSettings();
  if (settingsRow.enabled === enabled) {
    await send(
      chatId,
      enabled
        ? '▶️ Автопостинг уже включён.'
        : '⏸ Автопостинг уже на паузе. Включить: /resume.',
    );
    return;
  }

  await updateSettings({ enabled });
  await send(
    chatId,
    enabled
      ? '▶️ Автопостинг включён. Новости будут публиковаться при каждом запуске планировщика.'
      : '⏸ Автопостинг приостановлен. Включить: /resume.',
  );
  await doStatus(chatId);
}

export async function doToggle(chatId) {
  const settingsRow = await getSettings();
  await doSetEnabled(chatId, settingsRow.enabled === false);
}

export async function doNews(chatId, { dryRun = false } = {}) {
  await typing(chatId);

  if (dryRun) {
    const settingsRow = await getSettings();
    const result = await previewNews({ limit: settingsRow.maxItems || 5 });
    if (!result.items.length) {
      await send(chatId, '😕 Новых новостей нет.');
      return;
    }

    await send(
      chatId,
      `🔎 Предпросмотр: ${result.items.length} из ${result.totalFresh} свежих новостей. ` +
      `В канал ничего не отправлено.`,
    );

    for (const item of result.items) {
      const caption = buildCaption(item);
      if (item.image) {
        await api.sendPhoto({
          chat_id: chatId,
          photo: item.image,
          caption,
          parse_mode: 'HTML',
        });
      } else {
        await api.sendMessage({
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      }
    }
    return;
  }

  const result = await runNewsCycle({ force: true, source: 'command' });

  if (result.skipped) {
    await send(chatId, skipText(result.reason));
    return;
  }

  if (result.noChannels) {
    await send(
      chatId,
      `⚠️ Канал не подключён. Добавьте @${BOT_USERNAME} администратором ` +
      `с правом «Публикация сообщений» или используйте /addchannel.`,
    );
    return;
  }

  let note;
  if (result.posted > 0) {
    const channelWord = plural(result.channels, 'канал', 'канала', 'каналов');
    const postWord = plural(result.posted, 'пост', 'поста', 'постов');
    note = `✅ Опубликовано ${result.posted} ${postWord} в ${result.channels} ${channelWord}.`;
    if (result.deferred > 0) {
      const deferredWord = plural(result.deferred, 'пост', 'поста', 'постов');
      note += `\n⏳ Ещё ${result.deferred} ${deferredWord} уйдёт следующим запуском.`;
    }
    if (result.errors?.length) {
      note += `\n⚠️ Ошибки: ${escapeHtml(result.errors.join('; '))}`;
    }
  } else if (result.totalFresh === 0) {
    note = '😕 Новых новостей нет.';
  } else {
    note = '⚠️ Не удалось опубликовать новости. Проверьте /status.';
  }

  await send(chatId, note);
}

export async function doSetInterval(chatId, arg) {
  const value = Number.parseInt(arg, 10);
  if (!Number.isFinite(value) || value < MIN_INTERVAL_MINUTES || value > MAX_INTERVAL_MINUTES) {
    await send(
      chatId,
      `⚠️ Укажите интервал от ${MIN_INTERVAL_MINUTES} до ${MAX_INTERVAL_MINUTES} минут.\n` +
      `Например: <code>/interval 5</code>`,
    );
    return;
  }

  await updateSettings({ intervalMinutes: value });
  await send(chatId, `✅ Интервал: каждые ${value} минут.`);
}

export async function doSetMaxPosts(chatId, arg) {
  const value = Number.parseInt(arg, 10);
  if (!Number.isFinite(value) || value < MIN_MAX_POSTS || value > MAX_MAX_POSTS) {
    await send(
      chatId,
      `⚠️ Укажите число от ${MIN_MAX_POSTS} до ${MAX_MAX_POSTS}.\n` +
      `Например: <code>/posts 5</code>`,
    );
    return;
  }

  await updateSettings({ maxItems: value });
  const postWord = plural(value, 'пост', 'поста', 'постов');
  await send(chatId, `✅ За один запуск: до ${value} ${postWord}.`);
}

async function resolveChannel(arg) {
  const value = String(arg || '').trim();
  if (!value) throw new Error('Укажите @username или числовой id канала.');

  const chatId = value.startsWith('@') || /^-?\d+$/.test(value)
    ? value
    : null;
  if (!chatId) throw new Error('Укажите @username или числовой id канала.');

  return api.getChat({ chat_id: chatId });
}

export async function doSetChannel(chatId, arg) {
  try {
    const chat = await resolveChannel(arg);
    if (chat.type !== 'channel') {
      await send(chatId, '⚠️ Это не канал. Бот работает только с каналами.');
      return;
    }

    const me = await api.getMe();
    const member = await api.getChatMember({ chat_id: chat.id, user_id: me.id });
    const isAdmin = member.status === 'administrator';
    if (!isAdmin || member.can_post_messages === false) {
      await send(
        chatId,
        `⚠️ Бот не может публиковать в <b>${escapeHtml(chat.title || chat.id)}</b>.\n` +
        `Добавьте @${escapeHtml(BOT_USERNAME)} администратором с правом «Публикация сообщений» и повторите.`,
      );
      return;
    }

    await upsertChannel({
      chatId: chat.id,
      title: chat.title,
      username: chat.username,
      enabled: true,
    });

    await send(
      chatId,
      `✅ Канал <b>${escapeHtml(chat.title || chat.id)}</b> подключён.\n` +
      `Публикация включена.`,
    );
  } catch (error) {
    await send(chatId, `⚠️ Не удалось подключить канал: ${escapeHtml(errorMessage(error))}`);
  }
}

export async function doRemoveChannel(chatId, arg) {
  try {
    const value = String(arg || '').trim();
    if (!value) {
      await send(chatId, '⚠️ Укажите id канала или @username. Список: /channels');
      return;
    }

    const channels = await getChannels();
    let resolved = null;

    if (/^-?\d+$/.test(value)) {
      resolved = channels.find((channel) => String(channel.chatId) === value) || null;
    } else if (value.startsWith('@')) {
      const username = value.slice(1).toLowerCase();
      resolved = channels.find(
        (channel) => String(channel.username || '').toLowerCase() === username,
      ) || null;

      // If the row is missing, try Telegram itself (the bot may still be able
      // to resolve a public channel by username).
      if (!resolved) {
        const chat = await api.getChat({ chat_id: value });
        resolved = channels.find((channel) => String(channel.chatId) === String(chat.id)) || null;
      }
    } else {
      await send(chatId, '⚠️ Укажите id канала или @username. Список: /channels');
      return;
    }

    if (!resolved) {
      await send(chatId, '⚠️ Такой канал не подключён. Список: /channels');
      return;
    }

    await setChannelEnabled(resolved.chatId, false);
    await send(
      chatId,
      `🔴 Канал <b>${escapeHtml(resolved.title || resolved.chatId)}</b> отключён.\n` +
      `Включить снова: <code>/setchannel ${resolved.chatId}</code>`,
    );
  } catch (error) {
    await send(chatId, `⚠️ Не удалось отключить канал: ${escapeHtml(errorMessage(error))}`);
  }
}

export async function doAddChannel(chatId) {
  await send(chatId, addChannelText());
}
