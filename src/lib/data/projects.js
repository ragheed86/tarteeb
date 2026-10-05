// ============================================================
//  طبقة البيانات · المشاريع (CRUD + الفريق + المهام + التكاليف + الوسائط)
//  جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير
//  الاستيرادات في الصفحات.
// ============================================================
import { cachedSupabaseRead, clearSupabaseReadCache, supabase } from '../supabase';
import { signStoredFile, signStoredFiles } from '../storage';
import { discardUploadedFile, processStorageCleanup } from './storage';

const PROJECT_COLS = 'id,client_id,title,service_type,sale_price,status,supervisor_id,start_date,due_date,progress,created_at,updated_at';

// ---------- المشاريع ----------
export async function getProjects() {
  return cachedSupabaseRead('projects', async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id,client_id,title,service_type,sale_price,status,supervisor_id,start_date,due_date,progress,created_at,updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error; return data;
  });
}
export async function getProject(id) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
  if (error) throw error; return data;
}

export async function createProject(p) {
  const { data, error } = await supabase.from('projects').insert(p).select(PROJECT_COLS).single();
  if (error) throw error; clearSupabaseReadCache('projects'); return data;
}
export async function updateProject(id, p) {
  const { data, error } = await supabase.from('projects').update(p).eq('id', id).select(PROJECT_COLS).single();
  if (error) throw error; clearSupabaseReadCache('projects'); return data;
}
export async function removeProject(id) {
  // احتفظ بمسارات الملفات قبل أن يحذف ON DELETE CASCADE سجلاتها.
  const [{ data: media, error: mediaReadError }, { data: attachments, error: attachmentsReadError }] = await Promise.all([
    supabase.from('project_media').select('file_path').eq('project_id', id),
    supabase.from('project_cost_attachments').select('file_path').eq('project_id', id),
  ]);
  if (mediaReadError) throw mediaReadError;
  if (attachmentsReadError) throw attachmentsReadError;

  // العلاقات التابعة (الفريق، المهام، التكاليف، الوسائط والمرفقات) تُحذف
  // تلقائياً بواسطة مفاتيح ON DELETE CASCADE. الفواتير تبقى كسجل مالي
  // ويصبح project_id فيها null وفق تعريف قاعدة البيانات.
  const { data: deleted, error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!deleted) throw new Error('لم يتم حذف المشروع. تحقق من صلاحية الحذف ثم حاول مجدداً.');
  clearSupabaseReadCache('projects', 'invoices');

  // ملفات المشروع (الوسائط والمرفقات) دخلت طابور التنظيف ضمن نفس عملية الحذف؛
  // نحذفها الآن، وما يفشل يبقى في الطابور ويُعاد لاحقاً.
  const cleanup = await processStorageCleanup(100);
  return { cleanupWarning: cleanup.failed ? `${cleanup.failed} ملف سيُعاد حذفه لاحقاً تلقائياً` : '' };
}

// ---------- تكلفة المشروع (بنود + ملخص محسوب من view) ----------
export async function getProjectCosts(projectId) {
  const { data, error } = await supabase.from('project_costs')
    .select('id,kind,label,amount,qty,hours,rate,work_date,note,worker_name,product_name,supplier_id,supplier_name,sale_price,markup_percent')
    .eq('project_id', projectId);
  if (error) throw error; return data;
}
export async function createProjectCost(p) {
  const { data, error } = await supabase.from('project_costs').insert(p)
    .select('id,kind,label,amount,qty,hours,rate,work_date,note,worker_name,product_name,supplier_id,supplier_name,sale_price,markup_percent')
    .single();
  if (error) throw error; return data;
}
export async function removeProjectCost(id) {
  const { error } = await supabase.from('project_costs').delete().eq('id', id);
  if (error) throw error;
}
// كل بنود تكلفة كل المشاريع مع اسم المشروع/العميل — لاستيراد/تصدير ملف مصاريف تفصيلي (dataio)
export async function getAllProjectCostItemsDetailed() {
  const { data, error } = await supabase.from('project_costs')
    .select('id,project_id,kind,work_date,note,worker_name,product_name,qty,hours,rate,markup_percent,amount,projects(title,clients(name))');
  if (error) throw error; return data || [];
}

// فرق كل المشاريع دفعة واحدة (لعرض صور الفريق في التقويم الموحّد دون استعلام لكل مشروع)
export async function getAllProjectTeams() {
  const { data, error } = await supabase.from('project_team').select('project_id, employee_id');
  if (error) throw error; return data || [];
}

// الفريق (project_team — مفتاح مركّب) — مع أسماء الموظفين
export async function getProjectTeam(projectId) {
  const { data, error } = await supabase.from('project_team')
    .select('employee_id, employees(id,name,role)').eq('project_id', projectId);
  if (error) throw error; return data;
}
export async function addProjectTeam(projectId, employeeId) {
  const { error } = await supabase.from('project_team').insert({ project_id: projectId, employee_id: employeeId });
  if (error) throw error;
}
export async function removeProjectTeam(projectId, employeeId) {
  const { error } = await supabase.from('project_team').delete().eq('project_id', projectId).eq('employee_id', employeeId);
  if (error) throw error;
}

// الوسائط (قبل/بعد)
const PROJECT_MEDIA_BUCKET = 'project-media';

export async function getProjectMedia(projectId) {
  const { data, error } = await supabase.from('project_media')
    .select('id,project_id,kind,file_url,file_path,created_at').eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return signStoredFiles(data, PROJECT_MEDIA_BUCKET);
}
export async function createProjectMedia(p) {
  const { data, error } = await supabase.from('project_media').insert(p).select().single();
  if (error) throw error; return data;
}
export async function uploadProjectMedia(projectId, kind, file) {
  const fallbackExt = file.type?.startsWith('video/') ? 'mp4' : 'jpg';
  const ext = (file.name.split('.').pop() || fallbackExt).toLowerCase();
  const path = `${projectId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(PROJECT_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  let row;
  try { row = await createProjectMedia({ project_id: projectId, kind, file_url: path, file_path: path }); }
  catch (e) { await discardUploadedFile(PROJECT_MEDIA_BUCKET, path); throw e; }
  return signStoredFile(row, PROJECT_MEDIA_BUCKET);
}
export async function removeProjectMedia(id) {
  // السجل أولاً؛ الملف يدخل طابور التنظيف تلقائياً ثم يُحذف
  const { error } = await supabase.from('project_media').delete().eq('id', id);
  if (error) throw error;
  await processStorageCleanup();
}

// ---------- مرفقات تكلفة المشروع (مستندات: فواتير موردين، إيصالات...) ----------
const COST_ATTACHMENTS_BUCKET = 'project-cost-attachments';

export async function getProjectCostAttachments(projectId) {
  const { data, error } = await supabase.from('project_cost_attachments')
    .select('id,project_id,file_name,file_url,file_path,file_type,file_size,note,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return signStoredFiles(data, COST_ATTACHMENTS_BUCKET);
}

// يرفع المستند إلى الحاوية الخاصة، ثم يعيد رابطاً موقّعاً محدود الصلاحية.
export async function uploadProjectCostAttachment(projectId, file, note = '') {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(COST_ATTACHMENTS_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const row = {
    project_id: projectId,
    file_name: file.name,
    file_url: path,
    file_path: path,
    file_type: file.type || null,
    file_size: file.size || null,
    note: note?.trim() || null,
  };
  const { data, error } = await supabase.from('project_cost_attachments').insert(row).select().single();
  if (error) { await discardUploadedFile(COST_ATTACHMENTS_BUCKET, path); throw error; }
  return signStoredFile(data, COST_ATTACHMENTS_BUCKET);
}

export async function removeProjectCostAttachment(id) {
  const { error } = await supabase.from('project_cost_attachments').delete().eq('id', id);
  if (error) throw error;
  await processStorageCleanup();
}
