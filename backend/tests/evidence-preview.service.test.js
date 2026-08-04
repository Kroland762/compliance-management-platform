import { describe, expect, test } from 'vitest';
import {
  decodeCsvBuffer,
  getPreviewKind,
  getSafeContentType,
  parseCsvPreview,
} from '../src/services/evidence-preview.service';

describe('evidence preview service', () => {
  test('only previews explicitly supported file extensions', () => {
    expect(getPreviewKind('evidence.PNG', 'image/png')).toBe('image');
    expect(getPreviewKind('report.pdf', 'application/octet-stream')).toBe('pdf');
    expect(getPreviewKind('accounts.csv', 'text/plain')).toBe('csv');
    expect(getPreviewKind('unsafe.html', 'application/pdf')).toBe('unsupported');
    expect(getSafeContentType('unsafe.html', 'image/png')).toBeNull();
  });

  test('decodes UTF-8 BOM and common Chinese encoding', () => {
    const utf8 = decodeCsvBuffer(Buffer.from('\ufeff姓名,部门\n张三,安全部', 'utf8'));
    expect(utf8.encoding).toBe('UTF-8');
    expect(utf8.text).toContain('张三');

    const gb18030 = decodeCsvBuffer(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
    expect(gb18030.encoding).toBe('GB18030');
    expect(gb18030.text).toBe('中文');
  });

  test('parses a header row and paginates CSV values', () => {
    const result = parseCsvPreview('姓名,部门\n张三,安全部\n李四,法务部', 2, 1);
    expect(result.columns).toEqual(['姓名', '部门']);
    expect(result.rows).toEqual([{ 姓名: '李四', 部门: '法务部' }]);
    expect(result.pagination).toMatchObject({ page: 2, pageSize: 1, total: 2, truncated: false });
  });

  test('generates column names when the first row is not a valid header', () => {
    const result = parseCsvPreview('同名,同名\n值1,值2');
    expect(result.columns).toEqual(['列1', '列2']);
    expect(result.rows[0]).toEqual({ 列1: '同名', 列2: '同名' });
  });

  test('limits online previews to the first 1000 rows', () => {
    const body = Array.from({ length: 1005 }, (_, index) => `${index},值${index}`).join('\n');
    const result = parseCsvPreview(`编号,内容\n${body}`, 20, 50);
    expect(result.pagination.total).toBe(1000);
    expect(result.pagination.truncated).toBe(true);
    expect(result.rows).toHaveLength(50);
    expect(result.rows[49]).toEqual({ 编号: '999', 内容: '值999' });
  });
});

