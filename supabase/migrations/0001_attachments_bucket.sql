-- Attachments for ShopFlow: drawings and photos on a job or a task.
--
-- The bucket is PRIVATE. Files are read through the signed-in session, the
-- same shop login that already protects the workspace row — an anon key on
-- its own reads nothing here, exactly as with `workspaces`.
--
--   supabase db push --project-ref niveinyzkkwtreeeaziv
-- or paste into Supabase → SQL editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shopflow', 'shopflow', false,
  12582912,                                   -- 12 MB, matching Files.MAX_BYTES
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','application/pdf']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = false;

-- One policy per verb: Postgres storage policies do not take a list of them,
-- and a single "for all" policy would also hand out deletes to anyone signed in
-- before we had decided that was what we wanted. It is what we want here — the
-- shop shares one login — but it should be written down, not implied.

drop policy if exists "shopflow read"   on storage.objects;
drop policy if exists "shopflow insert" on storage.objects;
drop policy if exists "shopflow update" on storage.objects;
drop policy if exists "shopflow delete" on storage.objects;

create policy "shopflow read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'shopflow');

create policy "shopflow insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'shopflow');

-- upsert is an update on an existing object, so re-attaching the same id works
create policy "shopflow update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'shopflow')
  with check (bucket_id = 'shopflow');

create policy "shopflow delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'shopflow');
