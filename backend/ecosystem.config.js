// PM2 Ecosystem Configuration
// 用法: pm2 start ecosystem.config.js --env production

module.exports = {
  apps: [{
    name: 'compliance',
    script: 'dist/index.js',
    cwd: __dirname,
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    max_memory_restart: '500M',
    error_file: '/var/log/compliance/err.log',
    out_file: '/var/log/compliance/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    // 优雅重启
    listen_timeout: 5000,
    kill_timeout: 3000,
    // 健康检查
    max_restarts: 10,
    restart_delay: 5000,
    // 根据CPU核心数自动调整
    instances: 'max',
  }],
};
