const { oauthController } = require("../controllers/oauth-controller");

function registerOAuthRoutes(app) {
  app.post("/oauth/callback", oauthController.handleOAuthCallback);
  app.post("/oauth/refresh", oauthController.refreshAccessToken);
}

module.exports = { registerOAuthRoutes };
