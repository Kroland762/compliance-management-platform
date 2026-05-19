import { Sequelize } from 'sequelize';
import { config } from './index';

const sequelize = new Sequelize({
  dialect: 'postgres',
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  username: config.db.username,
  password: config.db.password,
  logging: false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: config.nodeEnv === 'production'
    ? { ssl: { require: true, rejectUnauthorized: true, ca: process.env.DB_CA_CERT } }
    : {},
});

export default sequelize;
