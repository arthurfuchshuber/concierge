UPDATE public.property_recommendations
SET image_url = '/api/public/place-photo?name=' ||
  regexp_replace(image_url, '^https?://places\.googleapis\.com/v1/(places/[^/]+/photos/[^/?]+)/media.*$', '\1') ||
  '&w=1600'
WHERE image_url ~ '^https?://places\.googleapis\.com/v1/places/[^/]+/photos/[^/?]+/media';