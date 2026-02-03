"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptManagementService = void 0;
const mysqlDb_1 = require("./mysqlDb");
const ALTER_CHECKER_ENUM_SQL = `ALTER TABLE receipt_templates MODIFY COLUMN template_type ENUM('receipt', 'bill', 'refund', 'checker') NOT NULL COMMENT 'Type of template: receipt (paid transaction), bill (unpaid order), refund, or checker (kitchen label)'`;
/** Ensure receipt_templates.template_type accepts 'checker' (for DBs created before checker was added). */
async function ensureCheckerTemplateType() {
    try {
        await (0, mysqlDb_1.executeUpdate)(ALTER_CHECKER_ENUM_SQL, []);
        console.log('✅ receipt_templates: ensured template_type ENUM includes checker');
    }
    catch (alterErr) {
        const err = alterErr;
        if (err.errno === 1265 || err.code === 'WARN_DATA_TRUNCATED') {
            /* Column might already allow checker; retry is safe */
        }
        else {
            console.warn('⚠️ ensureCheckerTemplateType (main):', alterErr?.message);
        }
    }
    try {
        await (0, mysqlDb_1.executeOnMirror)(ALTER_CHECKER_ENUM_SQL, []);
    }
    catch {
        /* mirror optional */
    }
}
const configManager_1 = require("./configManager");
function logDbOperation(operation, table, detail) {
    try {
        const db = (0, configManager_1.getDbConfig)();
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'receiptManagement.ts', message: `${operation} ${table}`, data: { operation, table, dbHost: db.host, dbName: db.database, detail }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H1' }) }).catch(() => { });
    }
    catch (_) { }
}
class ReceiptManagementService {
    /**
     * Get receipt template from database (code + show_notes for default template).
     * Priority: business-specific default > global default
     */
    async getReceiptTemplate(templateType, businessId) {
        // #region agent log
        logDbOperation('read', 'receipt_templates', `templateType=${templateType} businessId=${businessId ?? 'null'}`);
        // #endregion
        try {
            const selectCols = 'template_code, COALESCE(show_notes, 0) as show_notes';
            if (businessId) {
                const businessTemplate = await (0, mysqlDb_1.executeQueryOne)(`SELECT ${selectCols} FROM receipt_templates 
           WHERE template_type = ? AND business_id = ? AND is_active = 1 AND is_default = 1 
           ORDER BY version DESC LIMIT 1`, [templateType, businessId]);
                if (businessTemplate?.template_code) {
                    console.log(`✅ Found business-specific default ${templateType} template for business ${businessId}`);
                    return { templateCode: businessTemplate.template_code, showNotes: businessTemplate.show_notes === 1 };
                }
            }
            const globalTemplate = await (0, mysqlDb_1.executeQueryOne)(`SELECT ${selectCols} FROM receipt_templates 
         WHERE template_type = ? AND business_id IS NULL AND is_active = 1 AND is_default = 1 
         ORDER BY version DESC LIMIT 1`, [templateType]);
            if (globalTemplate?.template_code) {
                console.log(`✅ Found global default ${templateType} template`);
                return { templateCode: globalTemplate.template_code, showNotes: globalTemplate.show_notes === 1 };
            }
            console.warn(`⚠️ No default ${templateType} template found in database`);
            return { templateCode: null, showNotes: false };
        }
        catch (error) {
            console.error(`❌ Error loading ${templateType} template:`, error);
            return { templateCode: null, showNotes: false };
        }
    }
    /**
     * Get template code and show_notes by template id (for copy/edit).
     */
    async getReceiptTemplateById(id) {
        // #region agent log
        logDbOperation('read', 'receipt_templates', `byId=${id}`);
        // #endregion
        try {
            const row = await (0, mysqlDb_1.executeQueryOne)(`SELECT template_code, COALESCE(show_notes, 0) as show_notes FROM receipt_templates WHERE id = ? AND is_active = 1 LIMIT 1`, [id]);
            if (!row)
                return { templateCode: null, showNotes: false };
            return { templateCode: row.template_code ?? null, showNotes: row.show_notes === 1 };
        }
        catch (error) {
            console.error('Error loading receipt template by id:', error);
            return { templateCode: null, showNotes: false };
        }
    }
    /**
     * Get list of available templates for a type
     */
    async getReceiptTemplates(templateType, businessId) {
        // #region agent log
        logDbOperation('read', 'receipt_templates', `list templateType=${templateType} businessId=${businessId ?? 'null'}`);
        // #endregion
        try {
            const templates = await (0, mysqlDb_1.executeQuery)(`SELECT id, template_name, is_default, COALESCE(show_notes, 0) as show_notes FROM receipt_templates 
         WHERE template_type = ? AND (business_id = ? OR business_id IS NULL) AND is_active = 1 
         ORDER BY is_default DESC, (business_id <=> ?) DESC, template_name ASC`, [templateType, businessId || null, businessId ?? null]);
            return templates.map(t => ({
                id: t.id,
                name: t.template_name || 'Unnamed Template',
                is_default: t.is_default === 1,
                show_notes: t.show_notes === 1
            }));
        }
        catch (error) {
            console.error(`❌ Error loading ${templateType} templates list:`, error);
            return [];
        }
    }
    /**
     * Set default template for a type
     */
    async setDefaultTemplate(templateType, templateName, businessId) {
        const sqlUnset = `UPDATE receipt_templates 
         SET is_default = 0 
         WHERE template_type = ? AND (business_id = ? OR business_id IS NULL)`;
        const paramsUnset = [templateType, businessId || null];
        const sqlSet = `UPDATE receipt_templates 
         SET is_default = 1 
         WHERE template_type = ? AND template_name = ? AND (business_id <=> ?) AND is_active = 1`;
        const paramsSet = [templateType, templateName, businessId ?? null];
        const sqlSetGlobal = `UPDATE receipt_templates 
           SET is_default = 1 
           WHERE template_type = ? AND template_name = ? AND business_id IS NULL AND is_active = 1`;
        const paramsSetGlobal = [templateType, templateName];
        try {
            await (0, mysqlDb_1.executeUpdate)(sqlUnset, paramsUnset);
            await (0, mysqlDb_1.executeOnMirror)(sqlUnset, paramsUnset);
            let result = await (0, mysqlDb_1.executeUpdate)(sqlSet, paramsSet);
            await (0, mysqlDb_1.executeOnMirror)(sqlSet, paramsSet);
            if (result === 0 && businessId != null) {
                result = await (0, mysqlDb_1.executeUpdate)(sqlSetGlobal, paramsSetGlobal);
                await (0, mysqlDb_1.executeOnMirror)(sqlSetGlobal, paramsSetGlobal);
            }
            if (result > 0) {
                console.log(`✅ Set ${templateName} as default ${templateType} template${businessId ? ` for business ${businessId}` : ' (global)'}`);
                return true;
            }
            else {
                console.warn(`⚠️ Template ${templateName} not found for ${templateType}`);
                return false;
            }
        }
        catch (error) {
            console.error(`❌ Error setting default ${templateType} template:`, error);
            return false;
        }
    }
    /**
     * Update existing template by id (overwrite template_code, optionally template_name and show_notes).
     */
    async updateReceiptTemplate(id, templateCode, templateName, showNotes) {
        // #region agent log
        logDbOperation('save', 'receipt_templates', `update id=${id}`);
        // #endregion
        const nameToSet = templateName != null && String(templateName).trim() !== ''
            ? String(templateName).trim()
            : null;
        const showNotesVal = showNotes === true ? 1 : 0;
        const sql = `UPDATE receipt_templates SET template_code = ?, template_name = COALESCE(?, template_name), show_notes = ?, updated_at = NOW() WHERE id = ? AND is_active = 1`;
        const params = [templateCode, nameToSet, showNotesVal, id];
        try {
            const result = await (0, mysqlDb_1.executeUpdate)(sql, params);
            if (result > 0) {
                // Mirror: use upsert so row is created on VPS if missing (UPDATE alone affects 0 rows when id doesn't exist there)
                const row = await (0, mysqlDb_1.executeQueryOne)(`SELECT id, template_type, template_name, business_id, template_code, is_active, is_default, COALESCE(show_notes, 0) AS show_notes, version, created_at, updated_at FROM receipt_templates WHERE id = ? AND is_active = 1 LIMIT 1`, [id]);
                if (row) {
                    const upsertSql = `INSERT INTO receipt_templates (id, template_type, template_name, business_id, template_code, is_active, is_default, show_notes, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              template_code = VALUES(template_code),
              template_name = VALUES(template_name),
              show_notes = VALUES(show_notes),
              version = VALUES(version),
              updated_at = VALUES(updated_at)`;
                    const upsertParams = [
                        row.id,
                        row.template_type,
                        row.template_name ?? null,
                        row.business_id,
                        row.template_code,
                        row.is_active,
                        row.is_default,
                        row.show_notes,
                        row.version,
                        row.created_at,
                        row.updated_at,
                    ];
                    await (0, mysqlDb_1.executeOnMirror)(upsertSql, upsertParams);
                }
                else {
                    await (0, mysqlDb_1.executeOnMirror)(sql, params);
                }
                console.log(`✅ Updated receipt template id ${id}${nameToSet != null ? ` (name: ${nameToSet})` : ''}`);
                return true;
            }
            return false;
        }
        catch (error) {
            console.error('Error updating receipt template:', error);
            return false;
        }
    }
    /**
     * Save receipt template to database
     */
    async saveReceiptTemplate(templateType, templateCode, templateName, businessId, showNotes) {
        // #region agent log
        logDbOperation('save', 'receipt_templates', `save templateType=${templateType} businessId=${businessId ?? 'null'}`);
        // #endregion
        try {
            if (templateType === 'checker') {
                await ensureCheckerTemplateType();
            }
            const existing = await (0, mysqlDb_1.executeQueryOne)(`SELECT version FROM receipt_templates 
         WHERE template_type = ? AND template_name = ? AND business_id ${businessId ? '= ?' : 'IS NULL'} 
         ORDER BY version DESC LIMIT 1`, businessId ? [templateType, templateName || 'Default', businessId] : [templateType, templateName || 'Default']);
            const newVersion = existing?.version ? existing.version + 1 : 1;
            const showNotesVal = showNotes === true ? 1 : 0;
            const templateUpsertSql = `INSERT INTO receipt_templates (template_type, template_name, business_id, template_code, is_active, show_notes, version, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           template_code = VALUES(template_code),
           show_notes = VALUES(show_notes),
           version = VALUES(version),
           is_active = 1,
           updated_at = NOW()`;
            const templateUpsertParams = [templateType, templateName || 'Default', businessId || null, templateCode, showNotesVal, newVersion];
            await (0, mysqlDb_1.executeUpsert)(templateUpsertSql, templateUpsertParams);
            await (0, mysqlDb_1.executeOnMirror)(templateUpsertSql, templateUpsertParams);
            console.log(`✅ Saved ${templateType} template "${templateName || 'Default'}" (version ${newVersion})${businessId ? ` for business ${businessId}` : ' (global)'}`);
            return true;
        }
        catch (error) {
            console.error(`❌ Error saving ${templateType} template:`, error);
            return false;
        }
    }
    /**
     * Get receipt settings from database
     * Priority: business-specific > global
     */
    async getReceiptSettings(businessId) {
        // #region agent log
        logDbOperation('read', 'receipt_settings', `pengaturan konten businessId=${businessId ?? 'null'}`);
        // #endregion
        try {
            // Try to get business-specific settings first
            if (businessId) {
                const businessSettings = await (0, mysqlDb_1.executeQueryOne)(`SELECT * FROM receipt_settings 
           WHERE business_id = ? AND is_active = 1 
           LIMIT 1`, [businessId]);
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
                }
                else {
                    console.log(`🔍 [SETTINGS DEBUG] No business-specific settings found for business_id: ${businessId}`);
                    console.log(`🔍 [SETTINGS DEBUG] Query executed: SELECT * FROM receipt_settings WHERE business_id = ${businessId} AND is_active = 1 LIMIT 1`);
                }
            }
            // Fall back to global settings
            console.log(`🔍 [SETTINGS DEBUG] Checking for global settings (business_id IS NULL)`);
            const globalSettings = await (0, mysqlDb_1.executeQueryOne)(`SELECT * FROM receipt_settings 
         WHERE business_id IS NULL AND is_active = 1 
         LIMIT 1`, []);
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
        }
        catch (error) {
            console.error(`❌ Error loading receipt settings:`, error);
            return null;
        }
    }
    /**
     * Save receipt settings to database
     */
    async saveReceiptSettings(settings, businessId) {
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
        const receiptSettingsParams = [
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
            await (0, mysqlDb_1.executeUpsert)(receiptSettingsSql, receiptSettingsParams);
            await (0, mysqlDb_1.executeOnMirror)(receiptSettingsSql, receiptSettingsParams);
            console.log(`✅ Saved receipt settings${businessId ? ` for business ${businessId}` : ' (global)'}`);
            return true;
        }
        catch (error) {
            console.error(`❌ Error saving receipt settings:`, error);
            return false;
        }
    }
    /**
     * Render template with data
     * Replaces placeholders in template with actual values
     */
    renderTemplate(template, data) {
        let rendered = template;
        // Replace all placeholders
        const replacements = {
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
            '{{finalAmount}}': (data.finalAmount ?? data.total).toLocaleString('id-ID'),
        };
        // Handle conditional sections
        if (data.isBill) {
            // Show bill sections, remove receipt sections
            rendered = rendered.replace(/\{\{#ifBill\}\}[\s\S]*?\{\{\/ifBill\}\}/g, (match) => {
                // Extract content between {{#ifBill}} and {{/ifBill}}
                return match.replace(/\{\{#ifBill\}\}/g, '').replace(/\{\{\/ifBill\}\}/g, '');
            });
            rendered = rendered.replace(/\{\{#ifReceipt\}\}[\s\S]*?\{\{\/ifReceipt\}\}/g, '');
        }
        else {
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
        }
        else {
            rendered = rendered.replace(/\{\{#ifReprint\}\}[\s\S]*?\{\{\/ifReprint\}\}/g, '');
        }
        // Handle bill voucher conditional (show discount + total bayar only if hasVoucher)
        if (data.hasVoucher) {
            const ifVoucherMatch = rendered.match(/\{\{#ifVoucher\}\}([\s\S]*?)\{\{\/ifVoucher\}\}/);
            if (ifVoucherMatch) {
                rendered = rendered.replace(/\{\{#ifVoucher\}\}[\s\S]*?\{\{\/ifVoucher\}\}/g, ifVoucherMatch[1]);
            }
        }
        else {
            rendered = rendered.replace(/\{\{#ifVoucher\}\}[\s\S]*?\{\{\/ifVoucher\}\}/g, '');
        }
        // Handle amount received conditional (show payment details only if amountReceived > 0)
        if (data.amountReceived > 0) {
            // Extract content between {{#ifAmountReceived}} and {{/ifAmountReceived}}
            const amountReceivedMatch = rendered.match(/\{\{#ifAmountReceived\}\}([\s\S]*?)\{\{\/ifAmountReceived\}\}/);
            if (amountReceivedMatch) {
                rendered = rendered.replace(/\{\{#ifAmountReceived\}\}[\s\S]*?\{\{\/ifAmountReceived\}\}/g, amountReceivedMatch[1]);
            }
        }
        else {
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
exports.ReceiptManagementService = ReceiptManagementService;
