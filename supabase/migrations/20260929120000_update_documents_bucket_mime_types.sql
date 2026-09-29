-- Preserve the existing private documents bucket and add the two V1 generated
-- formats that were not present in the production allowlist.
DO $migration$
DECLARE
  bucket_row storage.buckets%ROWTYPE;
  required_mime_types text[] := ARRAY[
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ];
BEGIN
  SELECT *
  INTO bucket_row
  FROM storage.buckets
  WHERE id = 'documents'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The documents Storage bucket is required before this migration can run.';
  END IF;

  IF bucket_row.public THEN
    RAISE EXCEPTION 'The documents Storage bucket must remain private.';
  END IF;

  IF bucket_row.file_size_limit IS NULL OR bucket_row.file_size_limit < 10485760 THEN
    RAISE EXCEPTION 'The documents Storage bucket must allow at least 10 MiB.';
  END IF;

  IF bucket_row.allowed_mime_types IS NULL THEN
    RAISE EXCEPTION 'The documents Storage bucket must have an explicit MIME allowlist.';
  END IF;

  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY(
    SELECT DISTINCT mime_type
    FROM unnest(bucket_row.allowed_mime_types || required_mime_types) AS mime_type
    ORDER BY mime_type
  )
  WHERE id = 'documents';
END
$migration$;
