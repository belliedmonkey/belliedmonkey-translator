\set ON_ERROR_STOP on
\echo '== totals =='
SELECT count(*) AS memories,
       count(*) FILTER (WHERE formed_by = 'bot') AS bot_scoped,
       count(*) FILTER (WHERE formed_by = 'person') AS shared,
       count(*) FILTER (WHERE enabled) AS enabled,
       count(*) FILTER (WHERE review_state = 'confirmed') AS confirmed
FROM personal_memories;

\echo '== per bot =='
SELECT a.name, count(*) AS facts,
       count(DISTINCT lower(btrim(m.content))) AS unique_facts
FROM personal_memories m
JOIN agents a ON a.id = m.formed_by_agent_id
WHERE m.formed_by = 'bot'
GROUP BY a.name
ORDER BY facts DESC;

\echo '== orphans (must be 0) =='
SELECT count(*) AS orphan_bot_rows
FROM personal_memories m
LEFT JOIN agents a ON a.id = m.formed_by_agent_id
WHERE m.formed_by = 'bot' AND a.id IS NULL;

\echo '== duplicate content within one bot (must be 0 rows) =='
SELECT formed_by_agent_id, count(*) AS n, min(left(content, 60)) AS sample
FROM personal_memories
WHERE formed_by = 'bot'
GROUP BY formed_by_agent_id, lower(btrim(content))
HAVING count(*) > 1
LIMIT 20;

\echo '== routines =='
SELECT a.name AS bot, c.name AS channel, r.cron, r.timezone, r.enabled,
       length(r.instruction) AS instruction_len, r.next_run_at > now() AS future
FROM routines r
JOIN agents a ON a.id = r.agent_id
JOIN channels c ON c.id = r.channel_id
ORDER BY a.name, r.cron;

\echo '== routines that cannot be enabled (OpenBot floor is 15 min) =='
SELECT count(*) AS below_floor
FROM routines
WHERE split_part(cron, ' ', 1) ~ '^\*/[0-9]+$'
  AND regexp_replace(split_part(cron, ' ', 1), '^\*/', '')::int < 15;

\echo '== private channels =='
SELECT c.name, ca.agent_id, count(m.user_id) AS members,
       count(DISTINCT icm.thread_id) AS threads
FROM channels c
LEFT JOIN channel_agents ca ON ca.channel_id = c.id
LEFT JOIN channel_memberships m ON m.channel_id = c.id
LEFT JOIN intelligence_channel_mappings icm ON icm.channel_id = c.id
WHERE c.id LIKE 'channel_%'
GROUP BY c.id, c.name, ca.agent_id
ORDER BY c.created_at;

\echo '== scheduler state (runs must stay 0 while all routines are paused) =='
SELECT (SELECT count(*) FROM routine_runs) AS runs,
       (SELECT count(*) FROM routine_sweeps) AS sweeps;
