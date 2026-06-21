DELETE FROM public.property_recommendations
WHERE place_id IS NOT NULL
  AND (user_ratings_total IS NULL OR user_ratings_total < 200);