const { supabase } = require('./_base');
const path = require('path');

const CLASS_PDF_BUCKET = process.env.SUPABASE_CLASS_PDF_BUCKET || 'class-pdfs';
const RULES_PDF_BUCKET = process.env.SUPABASE_RULES_PDF_BUCKET || 'rules-pdfs';
const DEFAULT_SIGNED_URL_TTL = parseInt(process.env.PDF_SIGNED_URL_TTL, 10) || 300;

const sanitizeFilename = (filename = 'document.pdf') => {
  const normalized = filename.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
  if (normalized.endsWith('.pdf')) {
    return normalized;
  }
  return `${normalized.replace(/\.+$/, '')}.pdf`;
};

const uploadToBucket = async (bucket, storagePath, file, { cacheControl = '3600' } = {}) => {
  if (!file?.buffer) {
    return { data: null, error: new Error('Missing file buffer') };
  }
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype || 'application/pdf',
      cacheControl,
      upsert: true
    });
  if (error) {
    return { data: null, error };
  }
  return { data: { bucket, path: storagePath }, error: null };
};

const removeIfExists = async (bucket, storagePath) => {
  if (!storagePath) return;
  try {
    await supabase.storage.from(bucket).remove([storagePath]);
  } catch (error) {
    // noop – deletion failures should not block upload flows
    console.error('Failed to remove storage object', bucket, storagePath, error.message);
  }
};

const storeClassPdf = async (classId, file, { previousPath } = {}) => {
  if (!classId) {
    return { data: null, error: new Error('Missing class id') };
  }
  const safeName = sanitizeFilename(file?.originalname || `${classId}.pdf`);
  const storagePath = path.posix.join(classId, `${Date.now()}-${safeName}`);
  const result = await uploadToBucket(CLASS_PDF_BUCKET, storagePath, file);
  if (result.error) {
    return result;
  }
  if (previousPath && previousPath !== storagePath) {
    await removeIfExists(CLASS_PDF_BUCKET, previousPath);
  }
  return { data: result.data, error: null };
};

const storeRulesPdf = async (rulesPdfId, file, { previousPath } = {}) => {
  if (!rulesPdfId) {
    return { data: null, error: new Error('Missing rules PDF id') };
  }
  const safeName = sanitizeFilename(file?.originalname || `${rulesPdfId}.pdf`);
  const storagePath = path.posix.join(rulesPdfId, `${Date.now()}-${safeName}`);
  const result = await uploadToBucket(RULES_PDF_BUCKET, storagePath, file);
  if (result.error) {
    return result;
  }
  if (previousPath && previousPath !== storagePath) {
    await removeIfExists(RULES_PDF_BUCKET, previousPath);
  }
  return { data: result.data, error: null };
};

const getSignedPdfUrl = async ({ bucket, path: storagePath, expiresIn } = {}) => {
  if (!bucket || !storagePath) {
    return { data: null, error: new Error('Missing bucket or storage path') };
  }
  const ttl = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_SIGNED_URL_TTL;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, ttl);
  if (error) {
    return { data: null, error };
  }
  return { data: data?.signedUrl || null, error: null };
};

const deletePdfObject = async ({ bucket, path: storagePath } = {}) => {
  if (!bucket || !storagePath) {
    return { error: new Error('Missing bucket or storage path') };
  }
  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) {
    console.error('Failed to delete PDF from storage', bucket, storagePath, error.message);
    return { error };
  }
  return { error: null };
};

module.exports = {
  CLASS_PDF_BUCKET,
  RULES_PDF_BUCKET,
  storeClassPdf,
  storeRulesPdf,
  getSignedPdfUrl,
  deletePdfObject
};

