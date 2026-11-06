/* v3.43 — internet switches + IT policy precedence (src/netPolicy.js).
   Run: node tools/test-net-policy.mjs */
const store = {};
globalThis.localStorage = { getItem: k => k in store ? store[k] : null, setItem: (k, v) => { store[k] = String(v); } };
const N = await import('../src/netPolicy.js');
let fail = 0;
const t = (name, v) => { console.log((v ? 'ok   ' : 'FAIL ') + name); if(!v) fail++; };
t('default: everything allowed', N.netAllowed('updates') && N.netAllowed('weather') && N.netAllowed('maps'));
N.setUserSetting('updates', false);
t('user off: no automatic update checks', !N.netAllowed('updates'));
t('user off: manual check still possible', !N.updatesBlocked());
N.setPolicy({ path: 'C:\\ProgramData\\Decargo\\policy.json', values: { updates: 'off', weather: 'on', maps: 'bogus' } });
t('policy off: blocks updates incl. manual', !N.netAllowed('updates') && N.updatesBlocked());
N.setUserSetting('weather', false);
t('policy on beats the user switch', N.netAllowed('weather') && N.policyOf('weather') === 'on');
t('unknown policy value ignored', N.policyOf('maps') === null && N.netAllowed('maps'));
N.setPolicy({ path: 'x', values: { updates: 'on' } });
t('policy on forces automatic checks', N.netAllowed('updates') && !N.updatesBlocked());
N.setPolicy(null);
t('no policy file: user settings apply', !N.netAllowed('updates') && !N.netAllowed('weather') && N.netAllowed('maps'));
await N.netReady();
t('netReady resolves', true);
if(fail){ console.log(fail + ' failed'); process.exit(1); }
