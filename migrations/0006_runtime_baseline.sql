INSERT OR IGNORE INTO settings (key, value) VALUES
  ('baseUrl', ''),
  ('policyName', ''),
  ('publicLinksEnabled', 'true'),
  ('tokenLinksEnabled', 'true'),
  ('customIconPackUrls', '[]'),
  ('customIconPackNames', '{}');

UPDATE category_sources
SET url = 'https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/' || geoip_name || '.txt'
WHERE source_type = 'geoip'
  AND geoip_name IS NOT NULL
  AND url NOT LIKE '%/text/%.txt';
