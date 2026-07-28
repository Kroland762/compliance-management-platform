import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import sequelize from '../config/database';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: 'compliance_' });

export const httpDuration = new Histogram({
  name: 'compliance_http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

export const loginFailures = new Counter({
  name: 'compliance_login_failures_total',
  help: 'Failed login attempts',
  registers: [metricsRegistry],
});

export const uploadOperations = new Counter({
  name: 'compliance_upload_operations_total',
  help: 'Evidence upload outcomes',
  labelNames: ['outcome'],
  registers: [metricsRegistry],
});

export const syncOperations = new Counter({
  name: 'compliance_sync_operations_total',
  help: 'Data source sync outcomes',
  labelNames: ['outcome'],
  registers: [metricsRegistry],
});

export const scheduleOperations = new Counter({
  name: 'compliance_schedule_operations_total',
  help: 'Scheduled task outcomes',
  labelNames: ['outcome'],
  registers: [metricsRegistry],
});

new Gauge({
  name: 'compliance_database_pool_connections',
  help: 'Database pool connections',
  labelNames: ['state'],
  registers: [metricsRegistry],
  collect() {
    const pool = (sequelize as any).connectionManager?.pool;
    this.set({ state: 'used' }, pool?.using || 0);
    this.set({ state: 'idle' }, pool?.available || 0);
    this.set({ state: 'waiting' }, pool?.waiting || 0);
  },
});
