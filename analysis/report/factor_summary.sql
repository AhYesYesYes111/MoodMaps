SELECT
  rank,
  factor,
  mean_impact,
  ci_low,
  ci_high,
  high_impact_share,
  top_three_share,
  evidence_index,
  sample_size
FROM factor_summary
ORDER BY evidence_index DESC;
