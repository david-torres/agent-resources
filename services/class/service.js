const { normalizeClassInput } = require('./input');

const REQUIRED_ADAPTER_METHODS = ['createClassRow', 'updateClassRow', 'deleteClassRow', 'savePdfMetadataRow'];

/** Application boundary for class writes. Route authorization stays unchanged. */
class ClassService {
  constructor(adapter) {
    const missing = REQUIRED_ADAPTER_METHODS.filter(method => typeof adapter?.[method] !== 'function');
    if (missing.length) throw new TypeError(`ClassService requires adapter methods: ${missing.join(', ')}`);
    this.adapter = adapter;
  }

  async createClass(input) {
    return this.adapter.createClassRow(normalizeClassInput(input));
  }

  async updateClass(id, input) {
    return this.adapter.updateClassRow(id, normalizeClassInput(input));
  }

  async deleteClass(id) {
    return this.adapter.deleteClassRow(id);
  }

  async savePdfMetadata(classId, storagePath) {
    if (!classId) return { data: null, error: new Error('Missing class id') };
    return this.adapter.savePdfMetadataRow(classId, {
      pdf_storage_path: storagePath || null,
      pdf_updated_at: storagePath ? new Date().toISOString() : null
    });
  }
}

module.exports = { ClassService };
