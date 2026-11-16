import { EndpointError } from 'sdk';
import { runNewsCycle } from '../lib/autopost.js';
import { DEFAULT_OWNER_ID } from '../lib/config.js';
import { getOwnerId } from '../lib/store.js';

/**
 * External scheduler entry point.
 *
 * Telegram Serverless has no built-in timer, so a cron (the bundled GitHub
 * Actions workflow, or any other scheduler) invokes this module with:
 *
 *   npx tgcloud run endpoints/tick '{}' \
 *     --ctx '{ initData: { user: { id: 1709377874 } } }'
 *
 * The endpoint itself is also deployed, but the platform only lets Mini App
 * calls with valid init data reach it, and the owner check below adds a second
 * layer.
 */
export default async function (input, ctx) {
  const payload = input || {};
  const user = ctx?.initData?.user;

  if (!user) {
    throw new EndpointError('Owner context is required', { code: 'UNAUTHORIZED' });
  }

  const ownerId = await getOwnerId();
  if (String(user.id) !== String(ownerId) && String(user.id) !== String(DEFAULT_OWNER_ID)) {
    throw new EndpointError('Not allowed', { code: 'FORBIDDEN' });
  }

  const result = await runNewsCycle({
    force: payload.force === true,
    source: payload.source || 'scheduler',
  });

  console.log('FNEWS tick:', {
    skipped: result.skipped || false,
    reason: result.reason,
    fresh: result.totalFresh,
    posted: result.posted,
    channels: result.channels,
    errors: result.errors,
  });

  if (payload.compact === true) {
    const { items, ...summary } = result;
    return summary;
  }

  return result;
}
