-- Dashboard / analysis queries. Point Metabase or the UI at these.

-- ── 1. Money dashboard: last 30 days
SELECT date_trunc('day', published_at)::date AS day,
       count(*) AS posts,
       sum(views) AS views,
       sum(clicks) AS clicks,
       round(sum(clicks)::numeric / NULLIF(sum(views),0) * 100, 2) AS ctr_pct,
       sum(orders) AS orders,
       sum(commission_idr) AS commission
FROM v_post_performance
WHERE published_at > now() - interval '30 days'
GROUP BY 1 ORDER BY 1 DESC;

-- ── 2. Which lever value actually earns? (the query you'll live in)
SELECT 'format' AS lever, format AS value, count(*) n,
       round(avg(views)) avg_views,
       round(avg(clicks)::numeric,1) avg_clicks,
       round(avg(clicks)/NULLIF(avg(views),0)*100, 3) ctr_pct,
       sum(orders) orders, sum(commission_idr) commission
FROM v_post_performance GROUP BY 2
UNION ALL
SELECT 'angle', angle, count(*), round(avg(views)), round(avg(clicks)::numeric,1),
       round(avg(clicks)/NULLIF(avg(views),0)*100,3), sum(orders), sum(commission_idr)
FROM v_post_performance GROUP BY 2
UNION ALL
SELECT 'tone', tone, count(*), round(avg(views)), round(avg(clicks)::numeric,1),
       round(avg(clicks)/NULLIF(avg(views),0)*100,3), sum(orders), sum(commission_idr)
FROM v_post_performance GROUP BY 2
UNION ALL
SELECT 'sell_intensity', sell_intensity::text, count(*), round(avg(views)),
       round(avg(clicks)::numeric,1), round(avg(clicks)/NULLIF(avg(views),0)*100,3),
       sum(orders), sum(commission_idr)
FROM v_post_performance GROUP BY 2
UNION ALL
SELECT 'length_band', length_band, count(*), round(avg(views)), round(avg(clicks)::numeric,1),
       round(avg(clicks)/NULLIF(avg(views),0)*100,3), sum(orders), sum(commission_idr)
FROM v_post_performance GROUP BY 2
ORDER BY 1, ctr_pct DESC NULLS LAST;

-- ── 3. Best posting hour (free lever, costs nothing to exploit)
SELECT hour_of_day, count(*) n, round(avg(views)) avg_views,
       round(avg(clicks)::numeric,2) avg_clicks
FROM v_post_performance
GROUP BY 1 HAVING count(*) >= 3 ORDER BY avg_views DESC;

-- ── 4. Carousel vs single image
SELECT is_carousel, count(*) n, round(avg(views)) avg_views,
       round(avg(clicks)/NULLIF(avg(views),0)*100,3) ctr_pct
FROM v_post_performance GROUP BY 1;

-- ── 5. Per-product ROI — who deserves airtime
SELECT pr.name, count(p.*) posts, sum(vp.views) views, sum(vp.clicks) clicks,
       sum(vp.orders) orders, sum(vp.commission_idr) commission,
       round(sum(vp.commission_idr)/NULLIF(count(p.*),0)) commission_per_post
FROM products pr
JOIN posts p ON p.product_id = pr.id
JOIN v_post_performance vp ON vp.id = p.id
GROUP BY 1 ORDER BY commission DESC NULLS LAST;

-- ── 6. Top 10 posts of all time — read these, they teach you more than the stats
SELECT p.uid, pr.name, p.format, p.angle, p.tone, vp.views, vp.clicks, vp.orders,
       left(p.body, 160) AS opening
FROM v_post_performance vp
JOIN posts p ON p.id = vp.id
JOIN products pr ON pr.id = p.product_id
ORDER BY vp.clicks DESC NULLS LAST LIMIT 10;

-- ── 7. Repetition audit — are the openings drifting samey?
SELECT lower(split_part(body, ' ', 1) || ' ' || split_part(body, ' ', 2)) AS opener_2w,
       count(*) n
FROM posts WHERE status='published' AND published_at > now() - interval '30 days'
GROUP BY 1 HAVING count(*) > 1 ORDER BY n DESC;

-- ── 8. Bot traffic sanity check
SELECT is_bot, count(*), count(DISTINCT post_uid)
FROM clicks WHERE ts > now() - interval '7 days' GROUP BY 1;

SELECT ua, count(*) FROM clicks
WHERE NOT is_bot AND ts > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- ── 9. Current bandit state — what the machine believes right now
SELECT lever_kind, lever_code, round(n,1) n, round(reward_sum/NULLIF(n,0),3) mean_reward,
       round(alpha,2) alpha, round(beta,2) beta, cooldown_until
FROM arm_stats WHERE scope='global'
ORDER BY lever_kind, mean_reward DESC NULLS LAST;

-- ── 10. Health check — anything stuck?
SELECT status, count(*), min(scheduled_at), max(scheduled_at) FROM posts GROUP BY 1;
SELECT * FROM posts WHERE status='publishing' AND scheduled_at < now() - interval '30 minutes';
SELECT * FROM run_log WHERE level='error' AND ts > now() - interval '3 days' ORDER BY ts DESC;

-- ═══════════════════════════════════════════════════════════════
-- TECHNIQUE LIBRARY QUERIES (requires schema_techniques.sql)
-- ═══════════════════════════════════════════════════════════════

-- ── 11. Does the Technique Library actually help? (control group comparison)
-- Posts with 0 devices are the control arm. If devices aren't beating control after
-- ~8 cycles, your library is noise and you should prune it hard.
SELECT CASE WHEN tu.post_id IS NULL THEN 'control (no device)' ELSE 'with device' END AS grp,
       count(DISTINCT ps.post_id) n,
       round(avg(ps.final_score)::numeric, 3) mean_score,
       round(avg(vp.clicks)::numeric, 2) avg_clicks,
       sum(vp.orders) orders
FROM post_scores ps
JOIN v_post_performance vp ON vp.id = ps.post_id
LEFT JOIN technique_usage tu ON tu.post_id = ps.post_id
GROUP BY 1;

-- ── 12. Technique leaderboard
SELECT * FROM v_technique_performance WHERE uses >= 4 LIMIT 25;

-- ── 13. Which book's advice actually works for YOUR audience?
SELECT ts.title, count(DISTINCT t.id) techniques, sum(vtp.uses) total_uses,
       round(avg(vtp.mean_score)::numeric, 3) mean_score,
       sum(vtp.commission) commission
FROM techniques t
JOIN technique_sources ts ON ts.id = t.source_id
JOIN v_technique_performance vtp ON vtp.code = t.code
GROUP BY 1 ORDER BY mean_score DESC NULLS LAST;

-- ── 14. Contested claims your data has now settled
SELECT * FROM v_contested_verdicts;

-- ── 15. Library hygiene: techniques never used, or used and failing
SELECT code, name, type, n, round(reward_sum/NULLIF(n,0),3) mean_reward, cooldown_until,
       CASE WHEN n = 0 THEN 'never fired — check compatible_* gating is not too narrow'
            WHEN n < 4 THEN 'not enough data'
            WHEN reward_sum/n < 0.4 THEN 'underperforming — consider disabling'
            ELSE 'ok' END AS action
FROM techniques WHERE enabled ORDER BY n ASC, mean_reward ASC;
