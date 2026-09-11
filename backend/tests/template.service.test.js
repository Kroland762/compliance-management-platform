import { describe, expect, test } from 'vitest';
import templateService from '../src/services/template.service';

describe('template import preview', () => {
  test('keeps every CSV column while suggesting configurable display columns and a stable key', () => {
    const csv = [
      '序号,控制域名,控制点,参考回答,检查内容,来源章节',
      'A.1,访问控制,身份鉴别,旧参考内容,核查登录策略,第5章',
      'A.2,访问控制,权限复核,旧参考内容,核查权限清单,第6章',
    ].join('\n');
    const preview = templateService.previewImport(Buffer.from(csv));
    expect(preview.rowCount).toBe(2);
    expect(preview.headers).toEqual(['序号', '控制域名', '控制点', '参考回答', '检查内容', '来源章节']);
    expect(preview.suggestedControlKeyField).toBe('序号');
    expect(preview.columnSchema.map((column) => column.key)).toEqual([
      'sequenceNumber', 'controlDomain', 'controlPoint', 'extraData.检查内容', 'extraData.来源章节',
    ]);
    expect(preview.sampleRows[0]['检查内容']).toBe('核查登录策略');
  });

  test('rejects a CSV before import when a required column is missing', () => {
    expect(() => templateService.previewImport(Buffer.from('序号,控制点\nA.1,身份鉴别')))
      .toThrow('CSV 缺少必填列: 控制域名');
  });
});
