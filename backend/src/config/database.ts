import { Sequelize } from 'sequelize';
import { config } from './index';

const isProd = config.nodeEnv === 'production';
const useSsl = config.db.ssl;

const sequelize = new Sequelize({
  dialect: 'postgres',
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  username: config.db.username,
  password: config.db.password,
  logging: isProd ? false : (msg: string) => { if (msg.includes('ERROR')) console.log(msg); },
  pool: {
    max: isProd ? 20 : 10,
    min: isProd ? 2 : 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: useSsl
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: true,
          ca: process.env.DB_CA_CERT || undefined,
        },
      }
    : {},
});

export default sequelize;
