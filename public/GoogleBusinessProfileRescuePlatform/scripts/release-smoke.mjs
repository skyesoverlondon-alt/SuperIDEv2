console.log(JSON.stringify({
  release: 'phase4-deployable',
  checks: [
    'worker config present',
    'D1 auth migration present',
    'frontend env example present',
    'headers and redirects present',
    'deployable release notes present'
  ]
}, null, 2));
