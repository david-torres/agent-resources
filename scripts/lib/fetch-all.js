const { supabaseAdmin } = require('../../models/_base');

const PAGE_SIZE = 500;

const fetchAll = async (table, columns, query = q => q) => {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(supabaseAdmin.from(table).select(columns))
      .order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
};

module.exports = { fetchAll };
