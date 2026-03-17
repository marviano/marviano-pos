import { executeQuery, executeQueryOne, executeUpdate, executeUpsert, executeOnMirror, executeQueryOnMirror } from './mysqlDb';

/** Fallback when no checker template is saved – same layout as label.html (40mm, placeholders). */
const FALLBACK_CHECKER_TEMPLATE = `<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 40mm 30mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; color: black; }
    body { font-family: 'Arial', 'Helvetica', sans-serif; width: 22ch; max-width: 22ch; font-size: 8pt; font-weight: 600; line-height: 1.4; padding: 3mm 0 3mm 3mm; word-wrap: break-word; overflow-wrap: break-word; color: black; }
    .content { }
    .row { display: flex; justify-content: space-between; align-items: baseline; width: calc(100% + 3mm); margin-right: -3mm; }
    .counter { font-size: 9pt; font-weight: 700; }
    .pickup { text-align: left; font-size: 7pt; font-weight: 700; text-transform: uppercase; }
    .product { text-align: left; font-size: 7pt; font-weight: 600; }
    .customizations { text-align: left; font-size: 7pt; font-weight: 500; }
    .number { font-size: 9pt; font-weight: 700; text-align: right; white-space: nowrap; }
    .footer { margin-top: 2mm; }
    .time { text-align: left; font-size: 7pt; font-weight: 500; }
  </style>
</head>
<body>
  <div class="content">
    <div class="row">
      <div class="counter">{{counter}}</div>
      <div class="number">{{itemNumber}}/{{totalItems}}</div>
    </div>
    <div class="pickup">{{pickupMethod}}</div>
    <div class="product">{{productName}}</div>
    <div class="customizations">{{customizations}}</div>
  </div>
  <div class="footer">
    <div class="time">{{orderTime}}</div>
  </div>
</body>
</html>`;

const ALTER_CHECKER_ENUM_SQL = `ALTER TABLE receipt_templates MODIFY COLUMN template_type ENUM('receipt', 'bill', 'refund', 'checker') NOT NULL COMMENT 'Type of template: receipt (paid transaction), bill (unpaid order), refund, or checker (kitchen label)'`;

/** Ensure receipt_templates.template_type accepts 'checker' (for DBs created before checker was added). */
async function ensureCheckerTemplateType(): Promise<void> {
  try {
    await executeUpdate(ALTER_CHECKER_ENUM_SQL, []);
    console.log('✅ receipt_templates: ensured template_type ENUM includes checker');
  } catch (alterErr: unknown) {
    const err = alterErr as { code?: string; errno?: number };
    if (err.errno === 1265 || err.code === 'WARN_DATA_TRUNCATED') {
      /* Column might already allow checker; retry is safe */
    } else {
      console.warn('⚠️ ensureCheckerTemplateType (main):', (alterErr as Error)?.message);
    }
  }
  try {
    await executeOnMirror(ALTER_CHECKER_ENUM_SQL, []);
  } catch {
    /* mirror optional */
  }
}
import { getDbConfig } from './configManager';

function logDbOperation(operation: 'read' | 'save', table: string, detail?: string): void {
  try {
    const db = getDbConfig();
    fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'receiptManagement.ts', message: `${operation} ${table}`, data: { operation, table, dbHost: db.host, dbName: db.database, detail }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H1' }) }).catch(() => { });
  } catch (_) { }
}

/**
 * Receipt Management Service
 * Handles loading and saving receipt templates and settings from database
 */

type ReceiptTemplateType = 'receipt' | 'bill' | 'checker';

interface ReceiptTemplate {
  id: number;
  template_type: ReceiptTemplateType;
  business_id: number | null;
  template_code: string;
  is_active: number;
  version: number;
  created_at: string;
  updated_at: string;
  show_notes?: number;
}

export type GetReceiptTemplateResult = { templateCode: string | null; showNotes: boolean; templateName?: string | null; oneLabelPerProduct?: boolean; splitByCategory?: boolean };

/** Result of per-template VPS upload or download. */
export interface TemplateSyncResult {
  success: boolean;
  skipped?: boolean;   // true = destination was same or newer; not an error
  message: string;     // user-facing Indonesian message
}

interface ReceiptSettings {
  id: number;
  business_id: number | null;
  store_name: string | null;
  address: string | null;
  phone_number: string | null;
  contact_phone: string | null;
  logo_base64: string | null;
  footer_text: string | null;
  partnership_contact: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ReceiptTemplateData {
  businessName: string;
  items: string; // HTML string of items
  total: number;
  totalItems: number;
  paymentMethod: string;
  amountReceived: number;
  change: number;
  orderTime: string;
  printTime: string;
  transactionDisplay: string;
  displayCounter: string;
  receiptNumber: string;
  cashier: string;
  customerName?: string;
  isBill: boolean;
  isReprint: boolean;
  reprintCount?: number;
  leftPadding: string;
  rightPadding: string;
  // Receipt settings data
  contactPhone?: string;
  logo?: string; // HTML string for logo (img tag or empty)
  address?: string;
  footerText?: string;
  // Bill discount (optional)
  voucherDiscount?: number;
  voucherLabel?: string;
  finalAmount?: number;
  hasVoucher?: boolean;
}

export class ReceiptManagementService {
  /**
   * Get receipt template from database (code + show_notes for default template).
   * Priority: business-specific default > global default
   */
  async getReceiptTemplate(templateType: ReceiptTemplateType, businessId?: number): Promise<GetReceiptTemplateResult> {
    // #region agent log
    logDbOperation('read', 'receipt_templates', `templateType=${templateType} businessId=${businessId ?? 'null'}`);
    // #endregion
    try {
      const selectCols = 'template_code, COALESCE(show_notes, 0) as show_notes, template_name, COALESCE(one_label_per_product, 1) as one_label_per_product, COALESCE(checker_split_by_category, 0) as checker_split_by_category';
      if (businessId) {
        const businessTemplate = await executeQueryOne<{ template_code: string; show_notes: number; template_name: string | null; one_label_per_product: number; checker_split_by_category: number }>(
          `SELECT ${selectCols} FROM receipt_templates 
           WHERE template_type = ? AND business_id = ? AND is_active = 1 AND is_default = 1 
           ORDER BY version DESC LIMIT 1`,
          [templateType, businessId]
        );
        if (businessTemplate?.template_code) {
          console.log(`✅ Found business-specific default ${templateType} template for business ${businessId}`);
          // #region agent log
          fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'receiptManagement.ts:getReceiptTemplate', message: 'checker/receipt template result', data: { templateType, businessId, showNotes: businessTemplate.show_notes === 1, hasTemplateCode: true, scope: 'business', templateName: businessTemplate.template_name }, timestamp: Date.now(), hypothesisId: 'A' }) }).catch(() => { });
          // #endregion
          return {
            templateCode: businessTemplate.template_code,
            showNotes: businessTemplate.show_notes === 1,
            templateName: businessTemplate.template_name ?? null,
            oneLabelPerProduct: businessTemplate.one_label_per_product !== 0,
            splitByCategory: businessTemplate.checker_split_by_category === 1,
          };
        }
      }

      const globalTemplate = await executeQueryOne<{ template_code: string; show_notes: number; template_name: string | null; one_label_per_product: number; checker_split_by_category: number }>(
        `SELECT ${selectCols} FROM receipt_templates 
         WHERE template_type = ? AND business_id IS NULL AND is_active = 1 AND is_default = 1 
         ORDER BY version DESC LIMIT 1`,
        [templateType]
      );
      if (globalTemplate?.template_code) {
        console.log(`✅ Found global default ${templateType} template`);
        // #region agent log
        fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'receiptManagement.ts:getReceiptTemplate', message: 'checker/receipt template result', data: { templateType, businessId: businessId ?? null, showNotes: globalTemplate.show_notes === 1, hasTemplateCode: true, scope: 'global', templateName: globalTemplate.template_name }, timestamp: Date.now(), hypothesisId: 'B' }) }).catch(() => { });
        // #endregion
        return {
          templateCode: globalTemplate.template_code,
          showNotes: globalTemplate.show_notes === 1,
          templateName: globalTemplate.template_name ?? null,
          oneLabelPerProduct: globalTemplate.one_label_per_product !== 0,
          splitByCategory: globalTemplate.checker_split_by_category === 1,
        };
      }

      console.warn(`⚠️ No default ${templateType} template found in database`);
      // #region agent log
      fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'receiptManagement.ts:getReceiptTemplate', message: 'no default template', data: { templateType, businessId: businessId ?? null, showNotes: false, hasTemplateCode: false }, timestamp: Date.now(), hypothesisId: 'D' }) }).catch(() => { });
      // #endregion
      // When no checker template is saved, use built-in label layout so labels still print with expected placeholders
      if (templateType === 'checker') {
        return { templateCode: FALLBACK_CHECKER_TEMPLATE, showNotes: true, templateName: '(fallback)', oneLabelPerProduct: true, splitByCategory: false };
      }
      return { templateCode: null, showNotes: false, templateName: null, oneLabelPerProduct: true, splitByCategory: false };
    } catch (error) {
      console.error(`❌ Error loading ${templateType} template:`, error);
      return { templateCode: null, showNotes: false, templateName: null, oneLabelPerProduct: true, splitByCategory: false };
    }
  }

  /**
   * Get template code and show_notes by template id (for copy/edit).
   */
  async getReceiptTemplateById(id: number): Promise<{ templateCode: string | null; showNotes: boolean; oneLabelPerProduct: boolean; splitByCategory: boolean }> {
    // #region agent log
    logDbOperation('read', 'receipt_templates', `byId=${id}`);
    // #endregion
    try {
      const row = await executeQueryOne<{ template_code: string; show_notes: number; one_label_per_product: number | null; checker_split_by_category: number | null }>(
        `SELECT template_code, COALESCE(show_notes, 0) as show_notes, COALESCE(one_label_per_product, 1) as one_label_per_product, COALESCE(checker_split_by_category, 0) as checker_split_by_category FROM receipt_templates WHERE id = ? AND is_active = 1 LIMIT 1`,
        [id]
      );
      if (!row) return { templateCode: null, showNotes: false, oneLabelPerProduct: true, splitByCategory: false };
      return {
        templateCode: row.template_code ?? null,
        showNotes: row.show_notes === 1,
        oneLabelPerProduct: (row.one_label_per_product ?? 1) !== 0,
        splitByCategory: (row.checker_split_by_category ?? 0) === 1,
      };
    } catch (error) {
      console.error('Error loading receipt template by id:', error);
      return { templateCode: null, showNotes: false, oneLabelPerProduct: true, splitByCategory: false };
    }
  }

  /**
   * Get list of available templates for a type
   */
  async getReceiptTemplates(templateType: ReceiptTemplateType, businessId?: number): Promise<Array<{ id: number; name: string; is_default: boolean; show_notes?: boolean }>> {
    // #region agent log
    logDbOperation('read', 'receipt_templates', `list templateType=${templateType} businessId=${businessId ?? 'null'}`);
    // #endregion
    try {
      const templates = await executeQuery<{ id: number; template_name: string; is_default: number; show_notes: number }>(
        `SELECT id, template_name, is_default, COALESCE(show_notes, 0) as show_notes FROM receipt_templates 
         WHERE template_type = ? AND (business_id = ? OR business_id IS NULL) AND is_active = 1 
         ORDER BY is_default DESC, (business_id <=> ?) DESC, template_name ASC`,
        [templateType, businessId || null, businessId ?? null]
      );

      return templates.map(t => ({
        id: t.id,
        name: t.template_name || 'Unnamed Template',
        is_default: t.is_default === 1,
        show_notes: t.show_notes === 1
      }));
    } catch (error) {
      console.error(`❌ Error loading ${templateType} templates list:`, error);
      return [];
    }
  }

  /**
   * Set default template for a type
   */
  async setDefaultTemplate(templateType: ReceiptTemplateType, templateName: string, businessId?: number): Promise<boolean> {
    const sqlUnset = `UPDATE receipt_templates 
         SET is_default = 0 
         WHERE template_type = ? AND (business_id = ? OR business_id IS NULL)`;
    const paramsUnset: (string | number | null)[] = [templateType, businessId || null];
    const sqlSet = `UPDATE receipt_templates 
         SET is_default = 1 
         WHERE template_type = ? AND template_name = ? AND (business_id <=> ?) AND is_active = 1`;
    const paramsSet: (string | number | null)[] = [templateType, templateName, businessId ?? null];
    const sqlSetGlobal = `UPDATE receipt_templates 
           SET is_default = 1 
           WHERE template_type = ? AND template_name = ? AND business_id IS NULL AND is_active = 1`;
    const paramsSetGlobal: (string | number | null)[] = [templateType, templateName];
    try {
      await executeUpdate(sqlUnset, paramsUnset);

      let result = await executeUpdate(sqlSet, paramsSet);
      if (result === 0 && businessId != null) {
        result = await executeUpdate(sqlSetGlobal, paramsSetGlobal);
      }

      if (result > 0) {
        console.log(`✅ Set ${templateName} as default ${templateType} template${businessId ? ` for business ${businessId}` : ' (global)'}`);
        return true;
      } else {
        console.warn(`⚠️ Template ${templateName} not found for ${templateType}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error setting default ${templateType} template:`, error);
      return false;
    }
  }

  /**
   * Update existing template by id (overwrite template_code, optionally template_name, show_notes, one_label_per_product, splitByCategory).
   */
  async updateReceiptTemplate(id: number, templateCode: string, templateName?: string | null, showNotes?: boolean, oneLabelPerProduct?: boolean, splitByCategory?: boolean): Promise<boolean> {
    // #region agent log
    logDbOperation('save', 'receipt_templates', `update id=${id}`);
    // #endregion
    const nameToSet =
      templateName != null && String(templateName).trim() !== ''
        ? String(templateName).trim()
        : null;
    const showNotesVal = showNotes === true ? 1 : 0;
    const oneLabelPerProductVal = oneLabelPerProduct !== false ? 1 : 0;
    const splitByCategoryVal = splitByCategory === true ? 1 : 0;
    const sql = `UPDATE receipt_templates SET template_code = ?, template_name = COALESCE(?, template_name), show_notes = ?, one_label_per_product = ?, checker_split_by_category = ?, updated_at = NOW() WHERE id = ? AND is_active = 1`;
    const params: (string | number | null)[] = [templateCode, nameToSet, showNotesVal, oneLabelPerProductVal, splitByCategoryVal, id];
    try {
      const result = await executeUpdate(sql, params);
      if (result > 0) {
        // Mirror: use upsert so row is created on VPS if missing (UPDATE alone affects 0 rows when id doesn't exist there)
        const row = await executeQueryOne<{
          id: number;
          template_type: string;
          template_name: string | null;
          business_id: number | null;
          template_code: string;
          is_active: number;
          is_default: number;
          show_notes: number;
          one_label_per_product: number;
          checker_split_by_category: number;
          version: number;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT id, template_type, template_name, business_id, template_code, is_active, is_default, COALESCE(show_notes, 0) AS show_notes, COALESCE(one_label_per_product, 1) AS one_label_per_product, COALESCE(checker_split_by_category, 0) AS checker_split_by_category, version, created_at, updated_at FROM receipt_templates WHERE id = ? AND is_active = 1 LIMIT 1`,
          [id]
        );
        if (row) {
          // Exclude local-only columns (show_notes, one_label_per_product, checker_split_by_category) from mirror write
          const mirrorUpsertSql = `INSERT INTO receipt_templates (id, template_type, template_name, business_id, template_code, is_active, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              template_code = VALUES(template_code),
              template_name = VALUES(template_name),
              version = VALUES(version),
              updated_at = VALUES(updated_at)`;
          const mirrorUpsertParams: (string | number | null)[] = [
            row.id,
            row.template_type,
            row.template_name ?? null,
            row.business_id,
            row.template_code,
            row.is_active,
            row.version,
            row.created_at,
            row.updated_at,
          ];
          await executeOnMirror(mirrorUpsertSql, mirrorUpsertParams);
        } else {
          // Mirror: only push template_code, template_name, updated_at (exclude show_notes, one_label_per_product)
          const mirrorUpdateSql = `UPDATE receipt_templates SET template_code = ?, template_name = COALESCE(?, template_name), updated_at = NOW() WHERE id = ?`;
          await executeOnMirror(mirrorUpdateSql, [templateCode, nameToSet, id]);
        }
        console.log(`✅ Updated receipt template id ${id}${nameToSet != null ? ` (name: ${nameToSet})` : ''}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error updating receipt template:', error);
      return false;
    }
  }

  /**
   * Upload a single template to VPS (local → VPS). Newest wins; if VPS is same or newer, skips.
   */
  async uploadTemplateToVps(id: number): Promise<TemplateSyncResult> {
    try {
      const localRow = await executeQueryOne<{
        id: number;
        template_type: string;
        template_name: string | null;
        business_id: number | null;
        template_code: string;
        is_active: number;
        is_default: number;
        show_notes: number;
        one_label_per_product: number;
        checker_split_by_category: number;
        version: number;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, template_type, template_name, business_id, template_code, is_active, is_default,
         COALESCE(show_notes, 0) AS show_notes, COALESCE(one_label_per_product, 1) AS one_label_per_product, COALESCE(checker_split_by_category, 0) AS checker_split_by_category,
         version, created_at, updated_at FROM receipt_templates WHERE id = ? AND is_active = 1 LIMIT 1`,
        [id]
      );
      if (!localRow) {
        return { success: false, message: 'Template tidak ditemukan' };
      }
      const vpsRows = await executeQueryOnMirror<{ updated_at: string }>(
        'SELECT updated_at FROM receipt_templates WHERE id = ? LIMIT 1',
        [id]
      );
      const vpsRow = vpsRows[0];
      const localUpdated = localRow.updated_at ? String(localRow.updated_at).replace('T', ' ').slice(0, 19) : '';
      const vpsUpdated = vpsRow?.updated_at ? String(vpsRow.updated_at).replace('T', ' ').slice(0, 19) : '';
      if (vpsRow && vpsUpdated >= localUpdated) {
        return { success: true, skipped: true, message: 'VPS sudah lebih baru, tidak ada perubahan' };
      }
      // Exclude local-only columns (is_default, show_notes, one_label_per_product, checker_split_by_category) from sync to VPS
      const mirrorUpsertSql = `INSERT INTO receipt_templates (id, template_type, template_name, business_id, template_code, is_active, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          template_code = VALUES(template_code),
          template_name = VALUES(template_name),
          version = VALUES(version),
          updated_at = VALUES(updated_at)`;
      const mirrorUpsertParams: (string | number | null)[] = [
        localRow.id,
        localRow.template_type,
        localRow.template_name ?? null,
        localRow.business_id,
        localRow.template_code,
        localRow.is_active,
        localRow.version,
        localRow.created_at,
        localRow.updated_at,
      ];
      await executeOnMirror(mirrorUpsertSql, mirrorUpsertParams);
      return { success: true, message: 'Berhasil diupload ke VPS' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'VPS_NOT_CONFIGURED') {
        return { success: false, message: 'VPS tidak terhubung' };
      }
      return { success: false, message: msg || 'Gagal upload' };
    }
  }

  /**
   * Download a single template from VPS (VPS → local). Newest wins; if local is same or newer, skips.
   */
  async downloadTemplateFromVps(id: number): Promise<TemplateSyncResult> {
    try {
      // VPS may have older schema without one_label_per_product; do not SELECT it from VPS
      const vpsRows = await executeQueryOnMirror<{
        id: number;
        template_type: string;
        template_name: string | null;
        business_id: number | null;
        template_code: string;
        is_active: number;
        is_default: number;
        show_notes: number;
        version: number;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, template_type, template_name, business_id, template_code, is_active, is_default,
         COALESCE(show_notes, 0) AS show_notes, version, created_at, updated_at FROM receipt_templates WHERE id = ? LIMIT 1`,
        [id]
      );
      const vpsRow = vpsRows[0];
      if (!vpsRow) {
        return { success: false, message: 'Template tidak ditemukan di VPS' };
      }
      const localRow = await executeQueryOne<{ updated_at: string }>(
        'SELECT updated_at FROM receipt_templates WHERE id = ? LIMIT 1',
        [id]
      );
      const vpsUpdated = vpsRow.updated_at ? String(vpsRow.updated_at).replace('T', ' ').slice(0, 19) : '';
      const localUpdated = localRow?.updated_at ? String(localRow.updated_at).replace('T', ' ').slice(0, 19) : '';
      if (localRow && localUpdated >= vpsUpdated) {
        return { success: true, skipped: true, message: 'Template lokal sudah lebih baru, tidak ada perubahan' };
      }
      // Local-only columns: do not overwrite is_default, show_notes, one_label_per_product, checker_split_by_category from VPS (keep local preferences)
      const oneLabelPerProduct = 1;
      const checkerSplitByCategory = 0;
      const isDefault = 0;
      const showNotes = 0;
      const upsertSql = `INSERT INTO receipt_templates (id, template_type, template_name, business_id, template_code, is_active, is_default, show_notes, one_label_per_product, checker_split_by_category, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          template_type = VALUES(template_type),
          template_name = VALUES(template_name),
          business_id = VALUES(business_id),
          template_code = VALUES(template_code),
          is_active = VALUES(is_active),
          version = VALUES(version),
          updated_at = VALUES(updated_at)`;
      const upsertParams: (string | number | null)[] = [
        vpsRow.id,
        vpsRow.template_type,
        vpsRow.template_name ?? null,
        vpsRow.business_id,
        vpsRow.template_code,
        vpsRow.is_active,
        isDefault,
        showNotes,
        oneLabelPerProduct,
        checkerSplitByCategory,
        vpsRow.version,
        vpsRow.created_at,
        vpsRow.updated_at,
      ];
      await executeUpdate(upsertSql, upsertParams);
      return { success: true, message: 'Berhasil didownload dari VPS' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'VPS_NOT_CONFIGURED') {
        return { success: false, message: 'VPS tidak terhubung' };
      }
      return { success: false, message: msg || 'Gagal download' };
    }
  }

  /**
   * Save receipt template to database
   */
  async saveReceiptTemplate(
    templateType: ReceiptTemplateType,
    templateCode: string,
    templateName?: string,
    businessId?: number,
    showNotes?: boolean,
    oneLabelPerProduct?: boolean,
    splitByCategory?: boolean
  ): Promise<boolean> {
    // #region agent log
    logDbOperation('save', 'receipt_templates', `save templateType=${templateType} businessId=${businessId ?? 'null'}`);
    // #endregion
    try {
      if (templateType === 'checker') {
        await ensureCheckerTemplateType();
      }
      const existing = await executeQueryOne<{ version: number }>(
        `SELECT version FROM receipt_templates 
         WHERE template_type = ? AND template_name = ? AND business_id ${businessId ? '= ?' : 'IS NULL'} 
         ORDER BY version DESC LIMIT 1`,
        businessId ? [templateType, templateName || 'Default', businessId] : [templateType, templateName || 'Default']
      );

      const newVersion = existing?.version ? existing.version + 1 : 1;
      const showNotesVal = showNotes === true ? 1 : 0;
      const oneLabelPerProductVal = templateType === 'checker' ? (oneLabelPerProduct !== false ? 1 : 0) : 1;
      const splitByCategoryVal = templateType === 'checker' ? (splitByCategory === true ? 1 : 0) : 0;

      const templateUpsertSql = `INSERT INTO receipt_templates (template_type, template_name, business_id, template_code, is_active, show_notes, one_label_per_product, checker_split_by_category, version, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           template_code = VALUES(template_code),
           show_notes = VALUES(show_notes),
           one_label_per_product = VALUES(one_label_per_product),
           checker_split_by_category = VALUES(checker_split_by_category),
           version = VALUES(version),
           is_active = 1,
           updated_at = NOW()`;
      const templateUpsertParams: (string | number | null)[] = [templateType, templateName || 'Default', businessId || null, templateCode, showNotesVal, oneLabelPerProductVal, splitByCategoryVal, newVersion];

      await executeUpsert(templateUpsertSql, templateUpsertParams);
      // VPS may have older schema without one_label_per_product/checker_split_by_category; omit in mirror write
      const mirrorUpsertSql = `INSERT INTO receipt_templates (template_type, template_name, business_id, template_code, is_active, show_notes, version, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           template_code = VALUES(template_code),
           show_notes = VALUES(show_notes),
           version = VALUES(version),
           is_active = 1,
           updated_at = NOW()`;
      const mirrorUpsertParams: (string | number | null)[] = [templateType, templateName || 'Default', businessId || null, templateCode, showNotesVal, newVersion];
      await executeOnMirror(mirrorUpsertSql, mirrorUpsertParams);

      console.log(`✅ Saved ${templateType} template "${templateName || 'Default'}" (version ${newVersion})${businessId ? ` for business ${businessId}` : ' (global)'}`);
      return true;
    } catch (error) {
      console.error(`❌ Error saving ${templateType} template:`, error);
      return false;
    }
  }

  /**
   * Get receipt settings from database
   * Priority: business-specific > global
   */
  async getReceiptSettings(businessId?: number): Promise<ReceiptSettings | null> {
    // #region agent log
    logDbOperation('read', 'receipt_settings', `pengaturan konten businessId=${businessId ?? 'null'}`);
    // #endregion
    try {
      // Try to get business-specific settings first
      if (businessId) {
        const businessSettings = await executeQueryOne<ReceiptSettings>(
          `SELECT * FROM receipt_settings 
           WHERE business_id = ? AND is_active = 1 
           LIMIT 1`,
          [businessId]
        );
        if (businessSettings) {
          console.log(`✅ Found business-specific receipt settings for business ${businessId}`);
          console.log(`🔍 [SETTINGS DEBUG] Business settings content:`, {
            id: businessSettings.id,
            business_id: businessSettings.business_id,
            store_name: businessSettings.store_name || '(empty)',
            address: businessSettings.address ? businessSettings.address.substring(0, 50) + '...' : '(empty)',
            contact_phone: businessSettings.contact_phone || '(empty)',
            is_active: businessSettings.is_active
          });
          return businessSettings;
        } else {
          console.log(`🔍 [SETTINGS DEBUG] No business-specific settings found for business_id: ${businessId}`);
          console.log(`🔍 [SETTINGS DEBUG] Query executed: SELECT * FROM receipt_settings WHERE business_id = ${businessId} AND is_active = 1 LIMIT 1`);
        }
      }

      // Fall back to global settings
      console.log(`🔍 [SETTINGS DEBUG] Checking for global settings (business_id IS NULL)`);
      const globalSettings = await executeQueryOne<ReceiptSettings>(
        `SELECT * FROM receipt_settings 
         WHERE business_id IS NULL AND is_active = 1 
         LIMIT 1`,
        []
      );
      if (globalSettings) {
        console.log(`✅ Found global receipt settings`);
        console.log(`🔍 [SETTINGS DEBUG] Global settings content:`, {
          id: globalSettings.id,
          business_id: globalSettings.business_id,
          store_name: globalSettings.store_name || '(empty)',
          address: globalSettings.address ? globalSettings.address.substring(0, 50) + '...' : '(empty)',
          contact_phone: globalSettings.contact_phone || '(empty)',
          is_active: globalSettings.is_active
        });
        return globalSettings;
      }

      console.warn(`⚠️ No receipt settings found in database (checked business-specific and global)`);
      console.log(`🔍 [SETTINGS DEBUG] Query executed: SELECT * FROM receipt_settings WHERE business_id IS NULL AND is_active = 1 LIMIT 1`);
      return null;
    } catch (error) {
      console.error(`❌ Error loading receipt settings:`, error);
      return null;
    }
  }

  /**
   * Save receipt settings to database
   */
  async saveReceiptSettings(
    settings: Partial<Omit<ReceiptSettings, 'id' | 'created_at' | 'updated_at' | 'is_active'>>,
    businessId?: number
  ): Promise<boolean> {
    // #region agent log
    logDbOperation('save', 'receipt_settings', `pengaturan konten businessId=${businessId ?? 'null'}`);
    // #endregion
    const receiptSettingsSql = `INSERT INTO receipt_settings (
          business_id, store_name, address, phone_number, 
          contact_phone, logo_base64, footer_text, partnership_contact, 
          is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
        ON DUPLICATE KEY UPDATE 
          store_name = VALUES(store_name),
          address = VALUES(address),
          phone_number = VALUES(phone_number),
          contact_phone = VALUES(contact_phone),
          logo_base64 = VALUES(logo_base64),
          footer_text = VALUES(footer_text),
          partnership_contact = VALUES(partnership_contact),
          is_active = 1,
          updated_at = NOW()`;
    const receiptSettingsParams: (string | number | null)[] = [
      businessId || null,
      settings.store_name || null,
      settings.address || null,
      settings.phone_number || null,
      settings.contact_phone || null,
      settings.logo_base64 || null,
      settings.footer_text || null,
      settings.partnership_contact || null,
    ];
    try {
      await executeUpsert(receiptSettingsSql, receiptSettingsParams);
      // VPS upload is separate: call uploadReceiptSettingsToVps() for explicit feedback
      console.log(`✅ Saved receipt settings (local)${businessId ? ` for business ${businessId}` : ' (global)'}`);
      return true;
    } catch (error) {
      console.error(`❌ Error saving receipt settings:`, error);
      return false;
    }
  }

  /**
   * Upload current receipt_settings (for business or global) to VPS. Call after saveReceiptSettings for explicit sync.
   */
  async uploadReceiptSettingsToVps(businessId?: number): Promise<{ success: boolean; message: string }> {
    try {
      const settings = await this.getReceiptSettings(businessId);
      if (!settings) {
        return { success: false, message: 'Tidak ada pengaturan struk untuk di-upload' };
      }
      const receiptSettingsSql = `INSERT INTO receipt_settings (
            business_id, store_name, address, phone_number,
            contact_phone, logo_base64, footer_text, partnership_contact,
            is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
        ON DUPLICATE KEY UPDATE
          store_name = VALUES(store_name),
          address = VALUES(address),
          phone_number = VALUES(phone_number),
          contact_phone = VALUES(contact_phone),
          logo_base64 = VALUES(logo_base64),
          footer_text = VALUES(footer_text),
          partnership_contact = VALUES(partnership_contact),
          is_active = 1,
          updated_at = NOW()`;
      const receiptSettingsParams: (string | number | null)[] = [
        businessId ?? settings.business_id ?? null,
        settings.store_name || null,
        settings.address || null,
        settings.phone_number || null,
        settings.contact_phone || null,
        settings.logo_base64 || null,
        settings.footer_text || null,
        settings.partnership_contact || null,
      ];
      await executeOnMirror(receiptSettingsSql, receiptSettingsParams);
      console.log(`✅ Uploaded receipt settings to VPS${businessId ? ` for business ${businessId}` : ' (global)'}`);
      return { success: true, message: 'Pengaturan struk berhasil di-upload ke VPS' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'VPS_NOT_CONFIGURED') {
        return { success: false, message: 'VPS tidak terhubung' };
      }
      return { success: false, message: msg || 'Gagal upload pengaturan struk ke VPS' };
    }
  }

  /**
   * Render template with data
   * Replaces placeholders in template with actual values
   */
  renderTemplate(template: string, data: ReceiptTemplateData): string {
    let rendered = template;

    // Replace all placeholders
    const replacements: Record<string, string> = {
      '{{businessName}}': data.businessName || '',
      '{{items}}': data.items || '',
      '{{total}}': data.total.toLocaleString('id-ID'),
      '{{totalItems}}': String(data.totalItems),
      '{{paymentMethod}}': data.paymentMethod || '',
      '{{amountReceived}}': data.amountReceived.toLocaleString('id-ID'),
      '{{change}}': data.change.toLocaleString('id-ID'),
      '{{orderTime}}': data.orderTime || '',
      '{{printTime}}': data.printTime || '',
      '{{transactionDisplay}}': data.transactionDisplay || '',
      '{{displayCounter}}': data.displayCounter || '',
      '{{receiptNumber}}': data.receiptNumber || '',
      '{{cashier}}': data.cashier || 'N/A',
      '{{customerName}}': data.customerName || '',
      '{{leftPadding}}': data.leftPadding || '7.00',
      '{{rightPadding}}': data.rightPadding || '7.00',
      '{{reprintCount}}': data.reprintCount ? String(data.reprintCount) : '',
      // Receipt settings placeholders
      '{{contactPhone}}': data.contactPhone || '',
      '{{logo}}': data.logo || '',
      '{{address}}': data.address || '',
      '{{footerText}}': data.footerText || '',
      // Bill discount (optional)
      '{{voucherDiscount}}': (data.voucherDiscount ?? 0).toLocaleString('id-ID'),
      '{{voucherLabel}}': data.voucherLabel || '',
      // finalAmount/grandTotal = amount to pay (subtotal - voucher discount). Use for "Pembayaran Sebenarnya", "Total Bayar"
      '{{finalAmount}}': (data.finalAmount ?? data.total).toLocaleString('id-ID'),
      '{{grandTotal}}': (data.finalAmount ?? data.total).toLocaleString('id-ID'),
    };

    // Handle conditional sections
    if (data.isBill) {
      // Show bill sections, remove receipt sections
      rendered = rendered.replace(/\{\{#ifBill\}\}[\s\S]*?\{\{\/ifBill\}\}/g, (match) => {
        // Extract content between {{#ifBill}} and {{/ifBill}}
        return match.replace(/\{\{#ifBill\}\}/g, '').replace(/\{\{\/ifBill\}\}/g, '');
      });
      rendered = rendered.replace(/\{\{#ifReceipt\}\}[\s\S]*?\{\{\/ifReceipt\}\}/g, '');
    } else {
      // Show receipt sections, remove bill sections
      rendered = rendered.replace(/\{\{#ifReceipt\}\}[\s\S]*?\{\{\/ifReceipt\}\}/g, (match) => {
        // Extract content between {{#ifReceipt}} and {{/ifReceipt}}
        return match.replace(/\{\{#ifReceipt\}\}/g, '').replace(/\{\{\/ifReceipt\}\}/g, '');
      });
      rendered = rendered.replace(/\{\{#ifBill\}\}[\s\S]*?\{\{\/ifBill\}\}/g, '');
    }

    // Handle reprint notice - extract content and keep it (placeholders will be replaced later)
    if (data.isReprint && data.reprintCount) {
      // Extract content between {{#ifReprint}} and {{/ifReprint}}
      rendered = rendered.replace(/\{\{#ifReprint\}\}([\s\S]*?)\{\{\/ifReprint\}\}/g, '$1');
    } else {
      rendered = rendered.replace(/\{\{#ifReprint\}\}[\s\S]*?\{\{\/ifReprint\}\}/g, '');
    }

    // Handle bill voucher conditional (show discount + total bayar only if hasVoucher)
    if (data.hasVoucher) {
      const ifVoucherMatch = rendered.match(/\{\{#ifVoucher\}\}([\s\S]*?)\{\{\/ifVoucher\}\}/);
      if (ifVoucherMatch) {
        rendered = rendered.replace(/\{\{#ifVoucher\}\}[\s\S]*?\{\{\/ifVoucher\}\}/g, ifVoucherMatch[1]);
      }
    } else {
      rendered = rendered.replace(/\{\{#ifVoucher\}\}[\s\S]*?\{\{\/ifVoucher\}\}/g, '');
    }

    // Handle amount received conditional (show payment details only if amountReceived > 0)
    if (data.amountReceived > 0) {
      // Extract content between {{#ifAmountReceived}} and {{/ifAmountReceived}}
      const amountReceivedMatch = rendered.match(/\{\{#ifAmountReceived\}\}([\s\S]*?)\{\{\/ifAmountReceived\}\}/);
      if (amountReceivedMatch) {
        rendered = rendered.replace(/\{\{#ifAmountReceived\}\}[\s\S]*?\{\{\/ifAmountReceived\}\}/g, amountReceivedMatch[1]);
      }
    } else {
      // Remove sections between {{#ifAmountReceived}} and {{/ifAmountReceived}}
      rendered = rendered.replace(/\{\{#ifAmountReceived\}\}[\s\S]*?\{\{\/ifAmountReceived\}\}/g, '');
    }

    // Replace all placeholders (do this last so conditional blocks are processed first)
    for (const [placeholder, value] of Object.entries(replacements)) {
      rendered = rendered.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }

    return rendered;
  }
}
