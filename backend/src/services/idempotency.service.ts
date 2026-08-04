import { createHash } from 'crypto';
import { Op, QueryTypes, type Transaction } from 'sequelize';
import sequelize from '../config/database';
import IdempotencyRecord from '../models/IdempotencyRecord';
import { AppError } from '../utils/http';
import { fileStorage } from './file-storage.service';

interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

class IdempotencyService {
  private requestHash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex');
  }

  requireKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key || key.length > 180) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', '请提供有效的 Idempotency-Key');
    }
    return key;
  }

  async execute<T extends Record<string, unknown>>(
    operation: string,
    idempotencyKey: string,
    userId: string,
    payload: unknown,
    handler: (transaction: Transaction) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = this.requestHash(payload);
    return sequelize.transaction(async (transaction) => {
      await sequelize.query(
        'SELECT pg_advisory_xact_lock(hashtextextended(:lockKey, 0))',
        {
          replacements: { lockKey: `${operation}:${userId}:${idempotencyKey}` },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const existing = await IdempotencyRecord.findOne({
        where: { operation, idempotencyKey, userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同请求');
        }
        return { value: existing.responseBody as T, replayed: true };
      }
      const value = await handler(transaction);
      await IdempotencyRecord.create({
        operation,
        idempotencyKey,
        requestHash,
        userId,
        resourceId: typeof value.resourceId === 'string' ? value.resourceId : null,
        responseBody: value,
      }, { transaction });
      return { value, replayed: false };
    });
  }

  async cleanupExpired(): Promise<number> {
    const rows = await IdempotencyRecord.findAll({
      where: { expiresAt: { [Op.lt]: new Date() } },
    });
    for (const row of rows) {
      const storageKey = row.responseBody?.storageKey;
      if (typeof storageKey === 'string') {
        await fileStorage.delete(storageKey).catch(() => undefined);
      }
    }
    if (!rows.length) return 0;
    return IdempotencyRecord.destroy({ where: { id: { [Op.in]: rows.map((row) => row.id) } } });
  }
}

export default new IdempotencyService();
