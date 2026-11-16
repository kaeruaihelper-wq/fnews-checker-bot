import { BOT_USERNAME } from './config.js';
import { escapeHtml, formatDateRu, plural } from './format.js';

function intervalText(minutes) {
  return `каждые ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}`;
}

function channelText(count) {
  return `${count} ${plural(count, 'канал', 'канала', 'каналов')}`;
}

function channelLine(channel, index) {
  const title = escapeHtml(channel.title || 'Без названия');
  const username = channel.username ? ` @${escapeHtml(channel.username)}` : '';
  const state = channel.enabled === false ? '🔴 выключен' : '🟢 включён';
  return (
    `${index + 1}. <b>${title}</b>${username}\n` +
    `   <code>${channel.chatId}</code> · ${state}`
  );
}

export function welcomeText(settings, channels) {
  const enabledChannels = channels.filter((channel) => channel.enabled !== false);
  const channelSummary = enabledChannels.length
    ? enabledChannels.map((channel) => escapeHtml(channel.title || String(channel.chatId))).join(', ')
    : 'пока не подключён';

  const mode = settings.enabled === false ? '🔴 на паузе' : '🟢 включён';
  return (
    `👋 <b>FNEWS</b> — финансовые новости из Yahoo Finance.\n\n` +
    `Я собираю свежие новости из Yahoo Finance, перевожу их на русский и ` +
    `публикую каждую отдельным постом: с фото, если оно есть, и с тикерами ` +
    `затронутых акций.\n\n` +
    `📢 Канал: <b>${channelSummary}</b>\n` +
    `⚙️ Автопостинг: <b>${mode}</b>, ${intervalText(settings.intervalMinutes || 5)}\n` +
    `🗞 За запуск: до ${settings.maxItems || 5} ${plural(settings.maxItems || 5, 'пост', 'поста', 'постов')}\n\n` +
    `<b>Что умею</b>\n` +
    `/news — проверить и опубликовать свежие новости\n` +
    `/preview — посмотреть готовые посты без публикации\n` +
    `/status — состояние и статистика\n` +
    `/pause · /resume — пауза и продолжение\n` +
    `/interval 5 — интервал автопостинга\n` +
    `/posts 5 — максимум постов за запуск\n` +
    `/channels — подключённые каналы\n` +
    `/help — вся справка\n\n` +
    `Публикуются только новости текущего дня (МСК) не старше 6 часов. ` +
    `Если свежих новостей нет, бот молчит.\n\n` +
    `Добавьте меня администратором в канал с правом «Публикация сообщений» — я подхвачу его автоматически.`
  );
}

export function helpText() {
  return (
    `📖 <b>Команды FNEWS</b>\n\n` +
    `<b>Новости</b>\n` +
    `/news — проверить Yahoo Finance и опубликовать свежие новости\n` +
    `/preview — показать готовые посты без публикации\n\n` +
    `<b>Настройки</b>\n` +
    `/status — состояние, каналы и статистика\n` +
    `/pause — приостановить автопостинг\n` +
    `/resume — включить автопостинг\n` +
    `/interval 5 — интервал в минутах (5–1440)\n` +
    `/posts 5 — максимум постов за запуск (1–10)\n\n` +
    `<b>Каналы</b>\n` +
    `/channels — список каналов\n` +
    `/addchannel — как подключить канал\n` +
    `/setchannel @username — подключить вручную\n` +
    `/removechannel &lt;id&gt; — отключить канал\n\n` +
    `<b>Прочее</b>\n` +
    `/start — приветствие\n` +
    `/help — эта справка\n\n` +
    `Каждая новость публикуется отдельным постом: заголовок и краткое описание ` +
    `на русском, фото — если оно есть у новости. Публикуются только новости ` +
    `текущего дня (МСК) не старше 6 часов; если свежих нет, бот ничего не ` +
    `отправляет.\n\n` +
    `Источник новостей: Yahoo Finance. Бот: @${BOT_USERNAME}`
  );
}

export function statusText(settings, channels, seenCount) {
  const enabled = channels.filter((channel) => channel.enabled !== false);
  const mode = settings.enabled === false ? '🔴 выключен' : '🟢 включён';
  const error = settings.lastError ? escapeHtml(settings.lastError) : 'нет';
  const lastResult = settings.lastResult;
  const lastRun = formatDateRu(settings.lastRunAt);
  const lastPost = formatDateRu(settings.lastPostAt);

  const lines = [
    `📊 <b>FNEWS — статус</b>`,
    ``,
    `Автопостинг: <b>${mode}</b>`,
    `Интервал: ${intervalText(settings.intervalMinutes || 5)}`,
    `За запуск: до ${settings.maxItems || 5} ${plural(settings.maxItems || 5, 'пост', 'поста', 'постов')}`,
    `Каналы: ${channelText(enabled.length)}`,
  ];

  if (channels.length) {
    lines.push('');
    lines.push(...channels.map((channel, index) => channelLine(channel, index)));
  }

  lines.push('');
  lines.push(`Последний запуск: ${lastRun}`);
  lines.push(`Последняя публикация: ${lastPost}`);
  lines.push(`Уникальных новостей в базе: ${seenCount}`);

  if (lastResult && typeof lastResult === 'object' && lastResult.at) {
    lines.push(
      `Последний цикл: ${lastResult.posted || 0} опубл., ` +
      `${lastResult.fresh || 0} свежих`,
    );
    if (lastResult.deferred) {
      lines.push(`Отложено до следующего запуска: ${lastResult.deferred}`);
    }
  }

  lines.push(`Последняя ошибка: ${error}`);
  lines.push('');
  lines.push(
    `Публикуются только новости текущего дня (МСК) не старше 6 часов. ` +
    `Если свежих новостей нет, бот молчит.`,
  );
  lines.push(
    `⏱ Автозапуск выполняет внешний планировщик (GitHub Actions или cron). ` +
    `Без него новости публикуются по команде /news и при добавлении в канал.`,
  );

  return lines.join('\n');
}

export function channelsText(channels) {
  if (!channels.length) {
    return (
      `📢 <b>Каналы</b>\n\n` +
      `Пока ни одного канала.\n\n` +
      `Добавьте @${BOT_USERNAME} администратором в канал с правом «Публикация сообщений» — ` +
      `он появится здесь автоматически.`
    );
  }

  return (
    `📢 <b>Каналы</b>\n\n` +
    channels.map((channel, index) => channelLine(channel, index)).join('\n\n') +
    `\n\nОтключить: <code>/removechannel &lt;id&gt;</code>\n` +
    `Подключить вручную: <code>/setchannel @username</code>`
  );
}

export function addChannelText() {
  return (
    `➕ <b>Как подключить канал</b>\n\n` +
    `1. Откройте канал → «Администраторы» → «Добавить администратора».\n` +
    `2. Найдите @${BOT_USERNAME} и добавьте.\n` +
    `3. Включите право «Публикация сообщений».\n\n` +
    `Бот получит обновление и сразу добавит канал в список.\n\n` +
    `Если автоматическое определение не сработало, подключите вручную:\n` +
    `<code>/setchannel @channel_username</code>\n` +
    `или\n` +
    `<code>/setchannel -1001234567890</code>`
  );
}

export function channelWelcomeText(chatTitle) {
  const title = chatTitle ? escapeHtml(chatTitle) : 'этот канал';
  return (
    `✅ <b>FNEWS подключён</b>\n\n` +
    `В этот канал (<b>${title}</b>) будут приходить новости Yahoo Finance ` +
    `отдельными постами: заголовок и краткое описание на русском, фото — если ` +
    `оно есть у новости, и тикеры затронутых акций.\n\n` +
    `Если свежих новостей нет, бот ничего не публикует.\n\n` +
    `Отправьте /news, чтобы проверить новости немедленно.`
  );
}

export function mainKeyboard(enabled) {
  return {
    inline_keyboard: [
      [
        { text: '📰 Свежие новости', callback_data: 'news' },
        { text: '📊 Статус', callback_data: 'status' },
      ],
      [
        { text: enabled === false ? '▶️ Включить' : '⏸ Пауза', callback_data: 'toggle' },
        { text: '📢 Каналы', callback_data: 'channels' },
      ],
    ],
  };
}

export function skipText(reason) {
  if (reason === 'locked') return '⏳ Другой запуск уже идёт. Попробуйте через минуту.';
  if (reason === 'paused') return '⏸ Автопостинг на паузе. Включите командой /resume.';
  if (reason === 'interval') return '⏱ Интервал ещё не прошёл. Принудительно: /news.';
  return 'Запуск пропущен.';
}
