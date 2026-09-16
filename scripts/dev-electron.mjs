import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import waitOn from 'wait-on';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const serverUrl = 'http://127.0.0.1:5173';
let child;
let childReady = false;
let watcher;
let serverReady = false;
let buildVersion = 0;
let runningVersion = 0;
let restartRequested = false;
let stopping = false;
const formatHost = {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: () => root,
  getNewLine: () => '\n'
};

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  watcher?.close();
  if (child && child.exitCode === null) child.kill();
  process.exitCode = code;
}

function startOrRefresh() {
  if (stopping || !serverReady || !buildVersion) return;
  if (child) {
    if (!childReady) return;
    if (runningVersion !== buildVersion && !restartRequested) {
      restartRequested = true;
      console.log('[electron] Build updated. Restarting after the document close/save guard.');
      if (child.connected) child.send({ type: 'htmlpoint:dev-restart' });
      else console.log('[electron] Close the app to start the new build.');
    }
    return;
  }
  runningVersion = buildVersion;
  restartRequested = false;
  childReady = false;
  child = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: serverUrl },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    windowsHide: false
  });
  console.log(`[electron] Started build ${runningVersion} (PID ${child.pid}).`);
  child.on('message', (message) => {
    if (message?.type === 'htmlpoint:dev-ready') {
      childReady = true;
      startOrRefresh();
    }
  });
  child.once('error', (error) => { console.error(error); stop(1); });
  child.once('exit', (code) => {
    child = undefined;
    if (stopping) return;
    if (restartRequested) startOrRefresh();
    else stop(code ?? 1);
  });
}

// Successful watch builds emit main and preload before Electron can start/restart.
// Failed compilations leave the last working app running, without emitting partial JS.
const host = ts.createWatchCompilerHost(
  path.join(root, 'tsconfig.electron.json'),
  { noEmitOnError: true },
  ts.sys,
  ts.createSemanticDiagnosticsBuilderProgram,
  (diagnostic) => console.error(ts.formatDiagnosticsWithColorAndContext([diagnostic], formatHost)),
  (diagnostic) => console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
);
const afterProgramCreate = host.afterProgramCreate;
host.afterProgramCreate = (program) => {
  afterProgramCreate?.(program);
  if (!ts.getPreEmitDiagnostics(program.getProgram()).some((d) => d.category === ts.DiagnosticCategory.Error)) {
    buildVersion += 1;
    startOrRefresh();
  }
};
watcher = ts.createWatchProgram(host);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
try {
  await waitOn({ resources: [`http-get://${serverUrl.slice('http://'.length)}`], timeout: 30000 });
  serverReady = true;
  startOrRefresh();
} catch (error) {
  console.error('[electron] Vite did not become ready on port 5173.', error.message);
  stop(1);
}
