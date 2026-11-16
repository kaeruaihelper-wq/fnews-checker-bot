import { api } from 'sdk';
import { runNewsCycle } from '../lib/autopost.js';
import { upsertChannel } from '../lib/store.js';

const COMMAND_RE = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/;

export default async function (post) {
  const text = String(post.text || '').trim();
  const match = COMMAND_RE.exec(text);
  if (!match) return;

  const command = match[1].toLowerCase();
  if (command !== 'news' && command !== 'latest') return;

  // A command in the channel is also a useful way to (re-)enable it.
  await upsertChannel({
    chatId: post.chat.id,
    title: post.chat.title,
    username: post.chat.username,
    enabled: true,
  });

  // Keep the channel clean: remove the /news command itself.
  try {
    await api.deleteMessage({ chat_id: post.chat.id, message_id: post.message_id });
  } catch {
    // The bot may lack can_delete_messages; not important.
  }

  // Each fresh story is posted as its own photo message. If nothing fresh
  // exists, the bot stays silent — an explicit /news never creates an empty post.
  try {
    await runNewsCycle({ force: true, source: 'channel_command' });
  } catch (error) {
    console.error('Channel /news failed:', error);
  }
}
