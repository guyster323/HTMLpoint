// Attach to an actual portable-wrapper child, whose NSIS launcher does not forward
// inspector output to Playwright's Electron launcher. Both endpoints are loopback.
const { chromium } = require('@playwright/test');

async function evaluateMain(inspectorUrl, expression) {
  const targets = await (await fetch(`${inspectorUrl}/json/list`)).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Main inspector timeout')); }, 10000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true } })));
    socket.addEventListener('message', (event) => {
      const response = JSON.parse(event.data);
      if (response.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (response.error || response.result.exceptionDetails) reject(new Error(JSON.stringify(response)));
      else resolve(response.result.result.value);
    });
    socket.addEventListener('error', () => { clearTimeout(timer); socket.close(); reject(new Error('Main inspector connection failed')); });
  });
}

async function attachElectron(cdpUrl, inspectorUrl) {
  for (const endpoint of [cdpUrl, inspectorUrl]) {
    if (new URL(endpoint).hostname !== '127.0.0.1') throw new Error('Test attachment requires loopback endpoints');
  }
  const browser = await chromium.connectOverCDP(cdpUrl);
  const electronModule = "process.getBuiltinModule('module').createRequire(process.execPath)('electron')";
  return {
    firstWindow: async () => browser.contexts()[0].pages()[0],
    evaluate: (fn, argument) => evaluateMain(inspectorUrl, `(${fn.toString()})(${electronModule}, ${JSON.stringify(argument) ?? 'undefined'})`),
    close: async () => {
      const disconnected = new Promise((resolve) => browser.once('disconnected', resolve));
      await evaluateMain(inspectorUrl, `setTimeout(() => ${electronModule}.app.exit(0), 50); true`);
      await Promise.race([disconnected, new Promise((resolve) => setTimeout(resolve, 5000))]);
      await browser.close();
    }
  };
}

module.exports = { attachElectron, evaluateMain };
