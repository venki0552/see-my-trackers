// Fixture web server: one port, routes by Host header. Chrome maps hostnames here via --host-resolver-rules.
import http from 'node:http';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>News Fixture</title>
<script>
// --- minimal fake IAB TCF v2 CMP ---
(function(){
  var listeners = [], state = { eventStatus: 'cmpuishown', tcString: '', cmpId: 999, gdprApplies: true, purpose: { consents: {}, legitimateInterests: {} }, vendor: { consents: {} } };
  window.__tcfapi = function(cmd, v, cb){
    if (cmd === 'addEventListener') { listeners.push(cb); cb(JSON.parse(JSON.stringify(state)), true); }
    else if (cmd === 'ping') cb({ cmpLoaded: true }, true);
  };
  window.__fixtureChoose = function(accept){
    var c = {}; for (var i = 1; i <= 11; i++) c[i] = !!accept;
    state = { eventStatus: 'useractioncomplete', tcString: 'CPfixture', cmpId: 999, gdprApplies: true, purpose: { consents: c, legitimateInterests: {} }, vendor: { consents: { 1: !!accept } } };
    listeners.forEach(function(cb){ cb(JSON.parse(JSON.stringify(state)), true); });
    document.getElementById('banner').remove();
    setTimeout(function(){ afterChoice(); }, 400);
  };
})();
var UID = 'u8K2mQ9xZ4pL7rT3vW1y';
function px(src){ var i = new Image(); i.src = src; document.body.appendChild(i); }
function afterChoice(){
  px('http://p161.net/px?uid=' + UID + '&ev=pageview&cb=' + Date.now());
  px('http://mmtro.com/sync?partner_uid=' + UID + '&p=161');
  var s = document.createElement('script'); s.src = 'http://creative-serving.com/s.js'; document.head.appendChild(s);
  navigator.sendBeacon && navigator.sendBeacon('http://p161.net/beacon?uid=' + UID, 'x=1');
}
</script></head><body>
<h1>News Fixture</h1>
<div id="banner" style="border:1px solid #999;padding:10px">We use cookies.
  <button id="reject" onclick="__fixtureChoose(false)">Reject all</button>
  <button id="accept" onclick="__fixtureChoose(true)">Accept all</button></div>
<script>px('http://mmtro.com/pre?visitor=Pre9ChoiceVisitor77&v=1');</script>
<img src="http://cdnjs.cloudflare.com/logo.png">
</body></html>`;

const FP_SCRIPT = `(function(){ var c=document.createElement('canvas'); c.width=200; c.height=50; var x=c.getContext('2d'); x.fillText('fp',2,10); c.toDataURL(); })();`;

export function startServer(port = 8080) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    hits.push({ host, url: req.url, method: req.method, cookie: req.headers.cookie || '', gpc: req.headers['sec-gpc'] || '' });
    if (host === 'news-fixture.com') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    if (host === 'creative-serving.com' && req.url.startsWith('/s.js')) { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(FP_SCRIPT); }
    if (host === 'p161.net') {
      res.writeHead(200, { 'content-type': 'image/gif', 'set-cookie': ['uid=Zz81Kq2Lm3Np4Qr5; Max-Age=31536000; Path=/; SameSite=None'] });
      return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
    }
    res.writeHead(200, { 'content-type': 'image/gif' });
    res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
  });
  return new Promise((resolve) => srv.listen(port, () => resolve({ srv, hits })));
}

if (import.meta.url === `file://${process.argv[1]}`) startServer().then(() => console.log('fixture on :8080'));
