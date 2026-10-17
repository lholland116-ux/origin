begin;

-- Original manufacturing workbooks are stored separately from personal chat
-- documents. The bucket is private and receives no authenticated/anonymous
-- Storage policies; access is mediated by server code after quality-data
-- organization authorization.
do $$
declare
  existing storage.buckets%rowtype;
begin
  if not exists (
    select 1 from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and relation.relrowsecurity
  ) then
    raise exception 'QUALITY_DATA_STORAGE_RLS_REQUIRED';
  end if;

  select * into existing
  from storage.buckets
  where id = 'quality-data-sources'
     or name = 'quality-data-sources'
  for update;

  if not found then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'quality-data-sources',
      'quality-data-sources',
      false,
      10485760,
      array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    );
  elsif existing.id <> 'quality-data-sources'
    or existing.name <> 'quality-data-sources'
    or existing.public
    or existing.file_size_limit is distinct from 10485760
    or existing.allowed_mime_types is distinct from array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] then
    raise exception 'QUALITY_DATA_SOURCE_BUCKET_CONFLICT';
  end if;
end
$$;

create policy quality_data_source_objects_server_only
on storage.objects
as restrictive
for all
to public
using (bucket_id <> 'quality-data-sources')
with check (bucket_id <> 'quality-data-sources');

commit;
