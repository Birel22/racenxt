-- Storage: admins can upload/replace any file in the media bucket (logo uploads from the admin)
create policy media_read on storage.objects for select to authenticated using (bucket_id = 'media');
create policy media_admin_all on storage.objects for all to authenticated using (bucket_id = 'media' and private.is_admin()) with check (bucket_id = 'media' and private.is_admin());
