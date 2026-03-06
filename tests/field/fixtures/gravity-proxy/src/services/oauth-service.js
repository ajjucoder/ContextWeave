const tokenStore = require("../storage/token-store");

function verifyStateToken(state) {
  return state;
}

async function exchangeCode(code) {
  return { accessToken: code };
}

async function persistProviderToken(token) {
  return tokenStore.saveToken(token);
}

module.exports = {
  verifyStateToken,
  exchangeCode,
  persistProviderToken,
};
