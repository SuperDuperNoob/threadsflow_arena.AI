/**
 * n8n Code node — wf7 L4 step 0: prepare comment fetch URLs for the Threads API.
 *
 * Since n8n's Code node doesn't support top-level await, this node prepares the
 * fetch parameters and returns them for the HTTP Request node to execute.
 *
 * Input $json:
 *   access_token: Threads API access token
 *   posts: [{id, uid, threads_media_id, published_at}] - posts to fetch comments for
 *
 * Output: one item per post with the fetch URL
 */

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

function prepareFetchUrls(input) {
  const { access_token, posts } = input;
  
  if (!access_token) {
    return [{ json: { _error: 'access_token is required' } }];
  }
  
  if (!Array.isArray(posts) || posts.length === 0) {
    return [{ json: { _empty: true, message: 'No posts to fetch comments for' } }];
  }
  
  // Return one item per post with the URL to fetch comments
  return posts
    .filter(p => p.threads_media_id)
    .map(post => ({
      json: {
        ...input,
        fetch_url: `${THREADS_API_BASE}/${post.threads_media_id}/replies`,
        fetch_query: {
          access_token,
          fields: 'id,text,username,timestamp'
        },
        post_id: post.id,
        post_uid: post.uid,
        threads_media_id: post.threads_media_id,
      }
    }));
}

// n8n entry point
if (typeof $json !== 'undefined') {
  return prepareFetchUrls($json);
}

if (typeof module !== 'undefined') {
  module.exports = { prepareFetchUrls };
}
