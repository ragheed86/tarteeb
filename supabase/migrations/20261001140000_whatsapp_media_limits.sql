-- Task 13 (storage hardening), scoped for a single-company app.
-- Every bucket already has a size limit and allowed file types except
-- whatsapp-media, which accepted any file of any size. Limit it to the media
-- customers actually send on WhatsApp (photos, videos, voice notes, PDFs).
-- 25MB matches project-media and covers WhatsApp's own 16MB video/audio cap.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['image/*', 'video/*', 'audio/*', 'application/pdf']
where id = 'whatsapp-media';
