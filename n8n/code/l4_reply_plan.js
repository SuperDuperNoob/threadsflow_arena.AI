/**
 * n8n Code node — wf7 L4 step 0: plan which posts need replies.
 *
 * Fetches published posts from the last N days that have unreplied comments,
 * applies rate limiting, and outputs one item per comment that needs a reply.
 *
 * Input $json (from preceding Postgres node):
 *   posts: [{id, uid, body, purpose, threads_media_id, published_at, comment_count}]
 *   comments: [{id, comment_id, text, username, post_id, created_at, has_reply}]
 *   l4_settings: { max_replies_per_day, max_replies_per_post, cooldown_hours_per_user,
 *                  post_age_days, min_comment_length, ... }
 *   recent_replies: [{comment_id, post_id, username, published_at}]
 *
 * Output: one item per candidate comment, with post context attached.
 */

function planReplies(input) {
  const settings = input.l4_settings ?? {};
  const maxPerDay = settings.max_replies_per_day ?? 10;
  const maxPerPost = settings.max_replies_per_post ?? 5;
  const cooldownHours = settings.cooldown_hours_per_user ?? 24;
  const postAgeDays = settings.post_age_days ?? 7;
  const minCommentLen = settings.min_comment_length ?? 3;
  const now = Date.now();
  const cutoffMs = now - (postAgeDays * 24 * 60 * 60 * 1000);

  // Build lookup maps
  const postMap = new Map();
  for (const p of (input.posts ?? [])) {
    postMap.set(p.id, p);
  }

  // Count replies per post today
  const repliesPerPostToday = {};
  const repliedCommentIds = new Set();
  const repliedUsernamesRecent = new Map(); // username -> last reply timestamp

  for (const r of (input.recent_replies ?? [])) {
    const rTime = new Date(r.published_at).getTime();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    if (rTime >= todayStart.getTime()) {
      repliesPerPostToday[r.post_id] = (repliesPerPostToday[r.post_id] ?? 0) + 1;
    }
    repliedCommentIds.add(r.comment_id);

    // Track cooldown per username
    if (r.username) {
      const prev = repliedUsernamesRecent.get(r.username) ?? 0;
      if (rTime > prev) repliedUsernamesRecent.set(r.username, rTime);
    }
  }

  // Filter and rank comments
  const candidates = [];
  const selfUsername = input.self_username ?? ''; // our own Threads username

  for (const c of (input.comments ?? [])) {
    // Skip if already replied
    if (repliedCommentIds.has(c.comment_id)) continue;
    if (c.has_reply) continue;

    // Skip self-replies
    if (selfUsername && c.username === selfUsername) continue;

    // Skip very short comments
    if (!c.text || c.text.trim().length < minCommentLen) continue;

    // Skip bot-like comments
    if (isBotComment(c.text)) continue;

    // Check post age
    const post = postMap.get(c.post_id);
    if (!post) continue;
    const postTime = new Date(post.published_at).getTime();
    if (postTime < cutoffMs) continue;

    // Check per-post daily cap
    const postRepliesToday = repliesPerPostToday[c.post_id] ?? 0;
    if (postRepliesToday >= maxPerPost) continue;

    // Check user cooldown
    if (c.username) {
      const lastReply = repliedUsernamesRecent.get(c.username);
      if (lastReply && (now - lastReply) < (cooldownHours * 60 * 60 * 1000)) continue;
    }

    // Score: prioritize questions, link inquiries, and recent comments
    const score = scoreComment(c, post);

    candidates.push({
      comment_id: c.comment_id,
      comment_text: c.text,
      comment_username: c.username,
      post_id: c.post_id,
      post_uid: post.uid,
      post_body: post.body,
      post_purpose: post.purpose,
      post_threads_media_id: post.threads_media_id,
      score,
    });
  }

  // Sort by score descending, cap at maxPerDay minus already-replied today
  const totalRepliedToday = Object.values(repliesPerPostToday).reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, maxPerDay - totalRepliedToday);

  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates.slice(0, remaining);

  return selected;
}

/**
 * Score a comment for reply priority.
 * Higher = more important to reply to.
 */
function scoreComment(comment, post) {
  let score = 0;
  const text = (comment.text ?? '').toLowerCase();

  // Questions are highest priority (they expect an answer)
  if (text.includes('?') || /\b(kenapa|macam mana|berapa|kat mana|bila|apa|siapa)\b/.test(text)) {
    score += 10;
  }

  // Link/price inquiries are high priority (they want to buy)
  if (/\b(link|beli|mana|harga|berapa rm|shopee|lazada)\b/.test(text)) {
    score += 8;
  }

  // Experience/durability questions
  if (/\b(tahan|lama|ok ke|bagus ke|berkesan|berbaloi)\b/.test(text)) {
    score += 6;
  }

  // Compliments deserve a thank-you
  if (/\b(best|bagus|comel|cantik|lawak|thank|terima kasih|nice)\b/.test(text)) {
    score += 3;
  }

  // Longer comments show more engagement
  score += Math.min(5, Math.floor((comment.text ?? '').length / 30));

  // Persona posts get slight boost (they're building community)
  if (post.purpose === 'persona') score += 2;

  // Recency boost (newer comments first)
  const ageHours = (Date.now() - new Date(comment.created_at).getTime()) / (60 * 60 * 1000);
  score += Math.max(0, 5 - Math.floor(ageHours / 6)); // up to 5 points for very recent

  return score;
}

/**
 * Detect bot-like comments (spam, emoji-only, very short generic).
 */
function isBotComment(text) {
  const t = text.trim();
  // Emoji-only
  if (/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\s]+$/u.test(t)) return true;
  // Generic spam patterns
  if (/^(nice|good|great|👍|🔥|💯|❤️|😍)$/i.test(t)) return true;
  // Link spam
  if (/https?:\/\/|wa\.me|t\.me|bit\.ly/i.test(t)) return true;
  // "DM me" spam
  if (/\b(dm me|pm me|message me|inbox me)\b/i.test(t)) return true;
  return false;
}

// n8n entry point
if (typeof $ !== 'undefined' && typeof $json !== 'undefined') {
  const candidates = planReplies($json);
  if (candidates.length === 0) {
    return [{ json: { ...$json, _empty: true, message: 'No comments need replies' } }];
  }
  return candidates.map(c => ({ json: { ...$json, ...c } }));
}

if (typeof module !== 'undefined') {
  module.exports = { planReplies, scoreComment, isBotComment };
}
