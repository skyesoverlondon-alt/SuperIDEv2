const { ok } = require('./_utils');

exports.handler = async function handler() {
  return ok({
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasGitHubToken: Boolean(process.env.GITHUB_TOKEN),
    hasNetlifyToken: Boolean(process.env.NETLIFY_TOKEN),
    defaultCodexModel: process.env.OPENAI_CODEX_MODEL || 'gpt-5.4',
    defaults: {
      ghOwner: process.env.DEFAULT_GH_OWNER || '',
      ghRepo: process.env.DEFAULT_GH_REPO || '',
      ghBranch: process.env.DEFAULT_GH_BRANCH || 'main',
      netlifySiteId: process.env.DEFAULT_NETLIFY_SITE_ID || ''
    }
  });
};
