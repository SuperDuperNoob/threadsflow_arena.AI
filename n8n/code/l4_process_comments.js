/**
 * n8n Code node — wf7 L4 step 1: process fetched comments and prepare for DB insert.
 *
 * Takes the response from the Threads API and prepares it for insertion into
 * the threads_comments table.
 *
 * Input $json (from HTTP Request node):
 *   data: [{id, text, username, timestamp}] - comments from Threads API
 *   post_id: the post ID these comments belong to
 *   post_uid: the post UID
 *
 * Output: one item per comment, ready for DB insert
 */

function processFetchedComments(input) {
  const comments = input.data || [];
  const postId = input.post_id;
  const postUid = input.post_uid;
  
  if (!Array.isArray(comments) || comments.length === 0) {
    return [{ json: { _empty: true, post_id: postId, message: 'No comments fetched' } }];
  }
  
  return comments.map(comment => ({
    json: {
      comment_id: comment.id,
      post_id: postId,
      post_uid: postUid,
      username: comment.username || null,
      text: comment.text || '',
      created_at: comment.timestamp ? new Date(comment.timestamp).toISOString() : new Date().toISOString(),
      metadata: JSON.stringify(comment),
    }
  }));
}

// n8n entry point
if (typeof $json !== 'undefined') {
  return processFetchedComments($json);
}

if (typeof module !== 'undefined') {
  module.exports = { processFetchedComments };
}
