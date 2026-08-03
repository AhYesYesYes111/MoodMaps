SELECT
  component,
  weight,
  fallback_weight,
  observable,
  reason
FROM model_weights
ORDER BY weight DESC;
