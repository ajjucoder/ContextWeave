const {
  exchangeCode,
  persistProviderToken,
  verifyStateToken,
} = require("../services/oauth-service");

const oauthController = {
  handleOAuthCallback: async (req, res) => {
    verifyStateToken(req.query.state);
    const token = await exchangeCode(req.query.code);
    await persistProviderToken(token);
    return res.json({ ok: true });
  },

  refreshAccessToken: async (req, res) => {
    const token = await exchangeCode(req.body.refreshToken);
    return res.json(token);
  },
};

module.exports = { oauthController };
