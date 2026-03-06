const { registerOAuthRoutes } = require("./routes/oauth");

function startServer(app) {
  registerOAuthRoutes(app);
}

module.exports = { startServer };
