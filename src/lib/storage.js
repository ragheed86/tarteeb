import { supabase } from './supabase';

const SIGNED_URL_TTL_SECONDS = 60 * 60;

function pathFromStorageUrl(value, bucket) {
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value;

  try {
    const pathname = new URL(value).pathname;
    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/authenticated/${bucket}/`,
    ];
    const marker = markers.find((candidate) => pathname.includes(candidate));
    if (!marker) return '';
    return decodeURIComponent(pathname.slice(pathname.indexOf(marker) + marker.length));
  } catch {
    return '';
  }
}

export async function signStoredFile(row, bucket, pathKey = 'file_path', urlKey = 'file_url') {
  if (!row) return row;
  const path = row[pathKey] || pathFromStorageUrl(row[urlKey], bucket);

  // الروابط الخارجية التي أدخلها المستخدم يدوياً لا تمر عبر Supabase Storage.
  if (!path) return row;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;

  return { ...row, [pathKey]: path, [urlKey]: data.signedUrl };
}

export async function signStoredFiles(rows, bucket, pathKey = 'file_path', urlKey = 'file_url') {
  return Promise.all((rows || []).map((row) => signStoredFile(row, bucket, pathKey, urlKey)));
}
