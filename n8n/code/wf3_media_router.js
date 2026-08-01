/**
 * wf3_media_router.js
 * Pure decision logic extracted from wf3_publish "Quota guard" + routing.
 * Returns the target outputKey + whether video polling is required.
 *
 * Used by:
 *   - n8n code node (eval)
 *   - unit tests
 */
function decideMediaRoute(input = {}) {
  const {
    media_type: rawType,
    image_urls = [],
    product_images = [], // [{media_kind, public_url}]
  } = input;

  const valid = ['TEXT','IMAGE','CAROUSEL','VIDEO','MIXED_CAROUSEL'];
  let media_type = rawType;
  if (!media_type || !valid.includes(media_type)) {
    const hasVideo = (product_images || []).some(p => p.media_kind === 'VIDEO');
    const hasImageFromList = (product_images || []).some(p => p.media_kind === 'IMAGE');
    const hasAnyImage = hasImageFromList || (image_urls || []).length > 0;
    if (hasVideo && hasAnyImage) media_type = 'MIXED_CAROUSEL';
    else if (hasVideo) media_type = 'VIDEO';
    else if (hasAnyImage) media_type = (image_urls || []).length > 1 ? 'CAROUSEL' : 'IMAGE';
    else media_type = 'TEXT';
  }

  // existing guards (unchanged) — but respect explicit VIDEO/MIXED
  if (!['VIDEO','MIXED_CAROUSEL'].includes(media_type)) {
    if (media_type !== 'TEXT' && image_urls.length === 0) media_type = 'TEXT';
    if (media_type === 'CAROUSEL' && image_urls.length < 2) {
      media_type = image_urls.length === 1 ? 'IMAGE' : 'TEXT';
    }
    if (media_type === 'IMAGE' && image_urls.length > 1) {
      image_urls.length = 1;
    }
  }

  // NEW: VIDEO / MIXED_CAROUSEL support
  const hasVideo = product_images.some(p => p.media_kind === 'VIDEO') ||
                   (media_type === 'VIDEO');

  const needsVideoPoll = (media_type === 'VIDEO') ||
    (media_type === 'MIXED_CAROUSEL' && product_images.some(p => p.media_kind === 'VIDEO'));

  return {
    media_type,
    route: media_type,
    needsVideoPoll,
    image_urls,
    is_text: media_type === 'TEXT',
    is_carousel: media_type === 'CAROUSEL',
    wait_seconds: media_type === 'TEXT' ? 3 : 35,
  };
}

module.exports = { decideMediaRoute };