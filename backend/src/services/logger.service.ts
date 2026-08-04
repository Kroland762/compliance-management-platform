import winston from 'winston';
import { config } from '../config';

const SENSITIVE_KEYS = /password|token|authorization|cookie|secret|connectionConfig|questionnaire|fileContent/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(child),
    ]));
  }
  return value;
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format((info) => redact(info) as winston.Logform.TransformableInfo)(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
  defaultMeta: { service: 'compliance-api', environment: config.nodeEnv },
});

export default logger;
