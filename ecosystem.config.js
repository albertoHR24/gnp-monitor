module.exports = {
  apps: [
    {
      name: "gnp-monitor",
      script: "gnp-monitor.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "700M",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
