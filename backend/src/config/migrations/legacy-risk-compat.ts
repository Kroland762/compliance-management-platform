import { QueryTypes, Sequelize, Transaction } from 'sequelize';

function quote(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) throw new Error(`非法标识符: ${value}`);
  return `"${value}"`;
}

export async function tableColumns(db: Sequelize, schema: string, table: string, transaction?: Transaction): Promise<string[]> {
  const rows = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = :schema AND table_name = :table ORDER BY ordinal_position`,
    { replacements: { schema, table }, type: QueryTypes.SELECT, transaction },
  );
  return rows.map((row) => row.column_name);
}

/** Membership mapping must work before both the risk graph and independent-risk migrations. */
export async function risksWithoutTask(db: Sequelize, schema: string): Promise<object[]> {
  const columns = await tableColumns(db, schema, 'risk_records');
  const title = columns.includes('title') ? '"title"'
    : columns.includes('riskIdentification') ? '"riskIdentification" AS title' : "'历史风险' AS title";
  const hasMode = columns.includes('creationMode');
  return db.query(
    `SELECT id, "taskId", ${title}${hasMode ? ', "creationMode"' : ''}
     FROM ${quote(schema)}.risk_records WHERE "taskId" IS NULL
     ${hasMode ? `AND ("creationMode" IS NULL OR "creationMode" <> 'manual')` : ''}`,
    { type: QueryTypes.SELECT },
  );
}

async function rowHash(db: Sequelize, schema: string, table: string, columns: string[], transaction: Transaction): Promise<string> {
  const [row] = await db.query<{ hash: string }>(
    `SELECT md5(COALESCE(string_agg(md5(to_jsonb(row_data)::text), '' ORDER BY row_data.id::text), '')) AS hash
     FROM (SELECT ${columns.map(quote).join(', ')} FROM ${quote(schema)}.${quote(table)}
       ${schema === 'public' ? '' : `WHERE id IN (SELECT id FROM public.${quote(table)})`}) row_data`,
    { type: QueryTypes.SELECT, transaction },
  );
  return row.hash;
}

async function riskImportFields(db: Sequelize, sourceColumns: string[], targetColumns: string[], transaction: Transaction): Promise<Map<string, string>> {
  const fields = new Map<string, string>();
  if (targetColumns.includes('creationMode') && !sourceColumns.includes('creationMode')) fields.set('creationMode', "'import'");
  if (targetColumns.includes('discoverySource') && !sourceColumns.includes('discoverySource')) fields.set('discoverySource', "'compliance_assessment'");
  if (!targetColumns.includes('createdBy')) return fields;

  let creator = 'p."createdBy"';
  if (!sourceColumns.includes('createdBy')) {
    const candidates: string[] = [];
    // Match migration 026's provenance order, without assuming legacy relationship tables exist.
    for (const table of ['risk_finding_links', 'risk_sources']) {
      const columns = await tableColumns(db, 'public', table, transaction);
      if (columns.includes('riskId') && columns.includes('createdBy')) {
        candidates.push(`(SELECT relation."createdBy" FROM public.${quote(table)} relation
          WHERE relation."riskId" = p.id ${columns.includes('createdAt') ? 'ORDER BY relation."createdAt" ASC NULLS LAST' : ''} LIMIT 1)`);
      }
    }
    if (sourceColumns.includes('ownerUserId')) candidates.push('p."ownerUserId"');
    creator = `COALESCE(${[...candidates, 'NULL::uuid'].join(', ')})`;
    fields.set('createdBy', creator);
  }
  const invalid = await db.query<{ id: string }>(
    `SELECT p.id FROM public.risk_records p
     WHERE NOT EXISTS (SELECT 1 FROM public.users actor WHERE actor.id = ${creator}) ORDER BY p.id`,
    { type: QueryTypes.SELECT, transaction },
  );
  if (invalid.length) throw new Error(`风险创建人缺失或不存在于 public.users: ${invalid.map((risk) => risk.id).join(', ')}`);
  return fields;
}

/** Copy in one transaction and compare only original shared fields; public data is never changed. */
export async function importLegacyTables(
  db: Sequelize,
  schema: string,
  tenantId: string,
  report: Array<{ table: string; rows: number }>,
): Promise<Array<{ table: string; rows: number; hash: string }>> {
  return db.transaction({ type: Transaction.TYPES.DEFERRED }, async (transaction) => {
    await db.query('SET CONSTRAINTS ALL DEFERRED', { transaction });
    const verifiedTables: Array<{ table: string; rows: number; hash: string }> = [];
    for (const { table, rows } of report) {
      if (rows === 0) continue;
      const targetColumns = await tableColumns(db, schema, table, transaction);
      if (!targetColumns.length) continue;
      const sourceColumns = await tableColumns(db, 'public', table, transaction);
      const shared = targetColumns.filter((column) => sourceColumns.includes(column));
      if (!shared.includes('id')) throw new Error(`${table} 缺少可核对的 id 字段`);
      const additional = table === 'risk_records'
        ? await riskImportFields(db, sourceColumns, targetColumns, transaction) : new Map<string, string>();
      if (table === 'roles' && targetColumns.includes('tenantId') && !sourceColumns.includes('tenantId')) {
        additional.set('tenantId', ':tenantId');
      }
      await db.query(
        `INSERT INTO ${quote(schema)}.${quote(table)} (${[...shared, ...additional.keys()].map(quote).join(', ')})
         SELECT ${[...shared.map((column) => `p.${quote(column)}`), ...additional.values()].join(', ')}
         FROM public.${quote(table)} p ON CONFLICT (id) DO NOTHING`,
        { replacements: { tenantId }, transaction },
      );
      const [verified] = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${quote(schema)}.${quote(table)} t
         JOIN public.${quote(table)} p ON p.id = t.id`,
        { type: QueryTypes.SELECT, transaction },
      );
      if (Number(verified.count) !== rows) throw new Error(`${table} 数量核对失败: source=${rows}, target=${verified.count}`);
      const sourceHash = await rowHash(db, 'public', table, shared, transaction);
      const targetHash = await rowHash(db, schema, table, shared, transaction);
      if (sourceHash !== targetHash) throw new Error(`${table} 哈希核对失败: source=${sourceHash}, target=${targetHash}`);
      verifiedTables.push({ table, rows, hash: sourceHash });
    }
    return verifiedTables;
  });
}
