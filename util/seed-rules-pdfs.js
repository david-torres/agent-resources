require('./env');
const { createClient } = require('@supabase/supabase-js');
const RulesModel = require('../models/rules');
const { RULES_PDF_BUCKET } = require('../models/pdf');
const pdfRepository = require('../services/pdf/repository');
const { STARTER_RULES_PDF_ID } = require('./starter-content');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// A genuinely valid minimal PDF (starts with the %PDF- signature required by
// models/pdf.js) whose visible page text makes clear on sight that this is
// local seed data, not the real rulebook.
const buildPlaceholderPdfBuffer = () => {
    const header = '%PDF-1.4\n';
    const stream =
        'BT /F1 16 Tf 72 700 Td (Placeholder - local development seed data.) Tj ET\n' +
        'BT /F1 12 Tf 72 676 Td (This is not the Enclave rulebook.) Tj ET\n';

    const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
    const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
    const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n';
    const obj4 = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
    const obj5 = `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`;

    let offset = header.length;
    const objects = [obj1, obj2, obj3, obj4, obj5].map((str) => {
        const entry = { offset, str };
        offset += str.length;
        return entry;
    });

    const xrefOffset = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of objects) {
        xref += `${String(o.offset).padStart(10, '0')} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const body = header + objects.map((o) => o.str).join('') + xref + trailer;
    return Buffer.from(body, 'latin1');
};

// Building the row list must be import-safe (no network, no side effects) so
// it can be unit tested.
const buildHardcodedRulesPdfs = () => [
    {
        id: STARTER_RULES_PDF_ID,
        title: 'Enclave: Advent',
        edition: 'v1',
        storage_path: `${STARTER_RULES_PDF_ID}/local-seed-placeholder.pdf`,
        is_active: true
    }
];

async function seedRulesPdfs() {
    try {
        // Get system admin user ID
        const { data: adminUser, error: adminError } = await supabase
            .from('profiles')
            .select('id')
            .eq('role', 'admin')
            .single();

        if (adminError) {
            throw new Error('Failed to find admin user: ' + adminError.message);
        }

        for (const row of buildHardcodedRulesPdfs()) {
            const { data: existing } = await supabase
                .from('rules_pdfs')
                .select('id')
                .eq('id', row.id)
                .maybeSingle();

            if (existing) {
                console.log(`Rules PDF already seeded, skipping: ${row.title} (${row.id})`);
                continue;
            }

            const { error: uploadError } = await pdfRepository.uploadObject(
                RULES_PDF_BUCKET,
                row.storage_path,
                buildPlaceholderPdfBuffer(),
                { contentType: 'application/pdf', upsert: true }
            );

            if (uploadError) {
                throw new Error('Failed to upload placeholder rules PDF: ' + uploadError.message);
            }

            await RulesModel.createRulesPdf({ ...row, created_by: adminUser.id });
            console.log(`Successfully seeded rules PDF: ${row.title}`);
        }

        console.log('Rules PDF seeding completed');
    } catch (error) {
        console.error('Error during rules PDF seeding:', error);
        process.exit(1);
    }
}

module.exports = { buildHardcodedRulesPdfs };

// Run the seed function — only when invoked directly (`bun run seed:rules`),
// never as a side effect of require().
if (require.main === module) {
  seedRulesPdfs();
}
