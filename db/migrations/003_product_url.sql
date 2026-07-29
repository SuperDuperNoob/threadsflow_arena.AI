-- Migration 003 — optional plain product URL for enrichment.
--
-- affiliate_url remains the buyer/money link used by the redirector. product_url is optional
-- metadata for product intake: use it to store the full Shopee product page so enrichment can
-- parse item ids from /product/<shop>/<item> or /i.<shop>.<item> URLs without replacing the
-- affiliate short link that carries commission tracking.
--
-- Safe to run on an existing install. Idempotent.

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_url TEXT;

COMMENT ON COLUMN products.affiliate_url IS
  'Buyer/money link. Use the Shopee affiliate link here; the redirector reads this column and appends post-level sub_id tracking.';
COMMENT ON COLUMN products.product_url IS
  'Optional plain Shopee product URL used only for enrichment/Open API item lookup. Never used for buyer redirects.';

-- If an older install accidentally stored a plain Shopee product page as affiliate_url, keep a
-- copy as product_url so enrichment still has a visible item id after the user replaces the
-- affiliate_url with the real affiliate short link.
UPDATE products
   SET product_url = affiliate_url
 WHERE product_url IS NULL
   AND affiliate_url ~* 'https?://([^/]+[.])?shopee[.]com[.]my/(product/|i[.]|[^?#]+[.][0-9]+[.][0-9]+)';

COMMIT;
