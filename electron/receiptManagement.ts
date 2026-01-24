import { executeQuery, executeQueryOne, executeUpdate, executeUpsert } from './mysqlDb';

/**
 * Receipt Management Service
 * Handles loading and saving receipt templates and settings from database
 */

type ReceiptTemplateType = 'receipt' | 'bill';

interface ReceiptTemplate {
  id: number;
  template_type: ReceiptTemplateType;
  business_id: number | null;
  template_code: string;
  is_active: number;
  version: number;
  created_at: string;
  updated_at: string;
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
}

export class ReceiptManagementService {
  /**
   * Get receipt template from database
   * Priority: business-specific default > global default
   */
  async getReceiptTemplate(templateType: ReceiptTemplateType, businessId?: number): Promise<string | null> {
    try {
      // Try to get business-specific default template first
      if (businessId) {
        const businessTemplate = await executeQueryOne<ReceiptTemplate>(
          `SELECT template_code FROM receipt_templates 
           WHERE template_type = ? AND business_id = ? AND is_active = 1 AND is_default = 1 
           ORDER BY version DESC LIMIT 1`,
          [templateType, businessId]
        );
        if (businessTemplate?.template_code) {
          console.log(`✅ Found business-specific default ${templateType} template for business ${businessId}`);
          return businessTemplate.template_code;
        }
      }

      // Fall back to global default template
      const globalTemplate = await executeQueryOne<ReceiptTemplate>(
        `SELECT template_code FROM receipt_templates 
         WHERE template_type = ? AND business_id IS NULL AND is_active = 1 AND is_default = 1 
         ORDER BY version DESC LIMIT 1`,
        [templateType]
      );
      if (globalTemplate?.template_code) {
        console.log(`✅ Found global default ${templateType} template`);
        return globalTemplate.template_code;
      }

      console.warn(`⚠️ No default ${templateType} template found in database`);
      return null;
    } catch (error) {
      console.error(`❌ Error loading ${templateType} template:`, error);
      return null;
    }
  }

  /**
   * Get list of available templates for a type
   */
  async getReceiptTemplates(templateType: ReceiptTemplateType, businessId?: number): Promise<Array<{ id: number; name: string; is_default: boolean }>> {
    try {
      const templates = await executeQuery<{ id: number; template_name: string; is_default: number }>(
        `SELECT id, template_name, is_default FROM receipt_templates 
         WHERE template_type = ? AND (business_id = ? OR business_id IS NULL) AND is_active = 1 
         ORDER BY is_default DESC, template_name ASC`,
        [templateType, businessId || null]
      );
      
      return templates.map(t => ({
        id: t.id,
        name: t.template_name || 'Unnamed Template',
        is_default: t.is_default === 1
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
    try {
      // First, unset all defaults for this type and business
      await executeUpdate(
        `UPDATE receipt_templates 
         SET is_default = 0 
         WHERE template_type = ? AND (business_id = ? OR business_id IS NULL)`,
        [templateType, businessId || null]
      );

      // Then set the selected template as default
      const result = await executeUpdate(
        `UPDATE receipt_templates 
         SET is_default = 1 
         WHERE template_type = ? AND template_name = ? AND (business_id = ? OR business_id IS NULL) AND is_active = 1`,
        [templateType, templateName, businessId || null]
      );

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
   * Save receipt template to database
   */
  async saveReceiptTemplate(
    templateType: ReceiptTemplateType,
    templateCode: string,
    templateName?: string,
    businessId?: number
  ): Promise<boolean> {
    try {
      // Get current version if exists (for same name)
      const existing = await executeQueryOne<{ version: number }>(
        `SELECT version FROM receipt_templates 
         WHERE template_type = ? AND template_name = ? AND business_id ${businessId ? '= ?' : 'IS NULL'} 
         ORDER BY version DESC LIMIT 1`,
        businessId ? [templateType, templateName || 'Default', businessId] : [templateType, templateName || 'Default']
      );

      const newVersion = existing?.version ? existing.version + 1 : 1;

      await executeUpsert(
        `INSERT INTO receipt_templates (template_type, template_name, business_id, template_code, is_active, version, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           template_code = VALUES(template_code),
           version = VALUES(version),
           is_active = 1,
           updated_at = NOW()`,
        [templateType, templateName || 'Default', businessId || null, templateCode, newVersion]
      );

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
    try {
      await executeUpsert(
        `INSERT INTO receipt_settings (
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
          updated_at = NOW()`,
        [
          businessId || null,
          settings.store_name || null,
          settings.address || null,
          settings.phone_number || null,
          settings.contact_phone || null,
          settings.logo_base64 || null,
          settings.footer_text || null,
          settings.partnership_contact || null,
        ]
      );

      console.log(`✅ Saved receipt settings${businessId ? ` for business ${businessId}` : ' (global)'}`);
      return true;
    } catch (error) {
      console.error(`❌ Error saving receipt settings:`, error);
      return false;
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
      '{{leftPadding}}': data.leftPadding || '7.00',
      '{{rightPadding}}': data.rightPadding || '7.00',
      '{{reprintCount}}': data.reprintCount ? String(data.reprintCount) : '',
      // Receipt settings placeholders
      '{{contactPhone}}': data.contactPhone || '',
      '{{logo}}': data.logo || '',
      '{{address}}': data.address || '',
      '{{footerText}}': data.footerText || '',
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
