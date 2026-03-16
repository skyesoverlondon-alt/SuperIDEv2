function evalPosture(posture, policy){
  const reasons = [];
  if(!posture || typeof posture !== 'object'){
    return { status:'noncompliant', reasons:['missing-posture'], normalized:null };
  }

  const p = posture;

  const secureContext = !!p.secureContext;
  const webcrypto = !!p.webcrypto;
  const webauthn = !!p.webauthn;
  const platform = String(p.platform || '').slice(0,120);
  const browserMajor = (p.browser && Number(p.browser.major)) ? Number(p.browser.major) : null;
  const pwa = (p.pwa && typeof p.pwa === 'object') ? p.pwa : {};
  const standalone = !!pwa.standalone;

  const out = {
    version: Number(p.version || 1),
    ts: Number(p.ts || Date.now()),
    secureContext,
    webcrypto,
    webauthn,
    platform,
    browser: {
      name: (p.browser && p.browser.name) ? String(p.browser.name).slice(0,40) : '',
      major: browserMajor
    },
    timezone: p.timezone ? String(p.timezone).slice(0,80) : '',
    pwa: { standalone }
  };

  if(policy.requireSecureContext && !secureContext) reasons.push('insecure-context');
  if(!webcrypto) reasons.push('webcrypto-missing');
  if(policy.requireWebAuthn && !webauthn) reasons.push('webauthn-missing');

  if(Array.isArray(policy.allowedPlatforms) && policy.allowedPlatforms.length){
    const ok = policy.allowedPlatforms.includes(platform);
    if(!ok) reasons.push('platform-not-allowed');
  }

  if(policy.minBrowserMajor !== undefined && policy.minBrowserMajor !== null){
    const min = Number(policy.minBrowserMajor || 0);
    if(min > 0){
      if(!browserMajor) reasons.push('browser-version-unknown');
      else if(browserMajor < min) reasons.push('browser-too-old');
    }
  }

  return { status: reasons.length ? 'noncompliant' : 'compliant', reasons, normalized: out };
}

module.exports = { evalPosture };
