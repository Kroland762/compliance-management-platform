import SystemSetting from '../models/SystemSetting';

export interface SecuritySettings {
  maxLoginAttempts: number;
  lockDurationMinutes: number;
  idleTimeoutMinutes: number;
  auditLogRetentionDays: number; // 0 = 永久保留
}

const DEFAULTS: SecuritySettings = {
  maxLoginAttempts: 5,
  lockDurationMinutes: 15,
  idleTimeoutMinutes: 180,
  auditLogRetentionDays: 365,
};

class SettingsService {
  private cache: SecuritySettings | null = null;
  private cacheTime = 0;
  private readonly TTL = 30_000; // 30s cache

  /**
   * 获取安全设置（带缓存）
   */
  async getSecuritySettings(): Promise<SecuritySettings> {
    if (this.cache && Date.now() - this.cacheTime < this.TTL) return this.cache;

    const result: SecuritySettings = { ...DEFAULTS };

    const rows = await SystemSetting.findAll({
      where: {
        key: ['security.maxLoginAttempts', 'security.lockDurationMinutes', 'security.idleTimeoutMinutes', 'security.auditLogRetentionDays'],
      },
    });

    for (const row of rows) {
      switch (row.key) {
        case 'security.maxLoginAttempts':
          result.maxLoginAttempts = parseInt(row.value, 10) || DEFAULTS.maxLoginAttempts;
          break;
        case 'security.lockDurationMinutes':
          result.lockDurationMinutes = parseInt(row.value, 10) || DEFAULTS.lockDurationMinutes;
          break;
        case 'security.idleTimeoutMinutes':
          result.idleTimeoutMinutes = parseInt(row.value, 10) || DEFAULTS.idleTimeoutMinutes;
          break;
        case 'security.auditLogRetentionDays':
          result.auditLogRetentionDays = parseInt(row.value, 10);
          if (isNaN(result.auditLogRetentionDays)) result.auditLogRetentionDays = DEFAULTS.auditLogRetentionDays;
          break;
      }
    }

    this.cache = result;
    this.cacheTime = Date.now();
    return result;
  }

  /**
   * 更新安全设置
   */
  async updateSecuritySettings(settings: Partial<SecuritySettings>, userId: string): Promise<SecuritySettings> {
    const updates: Array<{ key: string; value: string }> = [];

    if (settings.maxLoginAttempts !== undefined) {
      const val = Math.max(1, Math.min(20, settings.maxLoginAttempts));
      updates.push({ key: 'security.maxLoginAttempts', value: String(val) });
    }
    if (settings.lockDurationMinutes !== undefined) {
      const val = Math.max(1, Math.min(1440, settings.lockDurationMinutes));
      updates.push({ key: 'security.lockDurationMinutes', value: String(val) });
    }
    if (settings.idleTimeoutMinutes !== undefined) {
      const val = Math.max(5, Math.min(1440, settings.idleTimeoutMinutes));
      updates.push({ key: 'security.idleTimeoutMinutes', value: String(val) });
    }
    if (settings.auditLogRetentionDays !== undefined) {
      const val = Math.max(0, Math.min(3650, settings.auditLogRetentionDays));
      updates.push({ key: 'security.auditLogRetentionDays', value: String(val) });
    }

    for (const u of updates) {
      await SystemSetting.upsert({
        key: u.key,
        value: u.value,
        updatedBy: userId,
        updatedAt: new Date(),
      });
    }

    // 清除缓存
    this.cache = null;
    this.cacheTime = 0;

    return this.getSecuritySettings();
  }

  /**
   * 获取单个设置值
   */
  async getValue(key: string, defaultValue: string = ''): Promise<string> {
    const row = await SystemSetting.findByPk(key);
    return row?.value || defaultValue;
  }
}

export default new SettingsService();
