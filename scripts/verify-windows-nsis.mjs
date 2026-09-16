import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT_EXE = 'HTMLpoint.exe';
const PRODUCT_NAME = 'HTMLpoint';

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const eq = process.argv.find((item) => item.startsWith(prefix));
  if (eq) return eq.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function resolveExisting(filePath) {
  return path.resolve(filePath);
}

function powershell(command, timeout = 60_000) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', windowsVerbatimArguments: false, timeout, windowsHide: true }
  );
  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    error: result.error ? String(result.error) : undefined
  };
}

function assertHarmlessTestDir(resolved) {
  const lower = resolved.toLowerCase();
  const forbiddenRoots = [
    path.resolve(process.env.USERPROFILE ?? '', 'Documents'),
    path.resolve(process.env.USERPROFILE ?? '', 'Desktop'),
    path.resolve(process.env.LOCALAPPDATA ?? '', 'Programs', PRODUCT_NAME),
    path.resolve(process.env.ProgramFiles ?? 'C:\\Program Files', PRODUCT_NAME),
    path.resolve(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', PRODUCT_NAME)
  ];
  for (const forbidden of forbiddenRoots) {
    const candidate = forbidden.toLowerCase();
    if (lower === candidate || lower.startsWith(`${candidate}\\`)) {
      throw new Error(`Refusing to use protected path as NSIS test directory: ${resolved}`);
    }
  }
  if (!/htmlpoint-nsis/i.test(resolved) && !/[\\/]artifacts[\\/]/i.test(resolved)) {
    throw new Error(`Install directory must be an artifacts or htmlpoint-nsis test path: ${resolved}`);
  }
}

function defaultInstaller() {
  const fromEnv = process.env.HTMLPOINT_NSIS_INSTALLER;
  if (fromEnv) return resolveExisting(fromEnv);
  const releaseDir = path.join(root, 'release');
  if (!existsSync(releaseDir)) return null;
  const matches = readdirSync(releaseDir)
    .filter((name) => /^HTMLpoint-Setup-.*-x64\.exe$/i.test(name))
    .map((name) => path.join(releaseDir, name))
    .sort();
  return matches[0] ?? null;
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).replaceAll('\\', '/'));
    }
  };
  walk(dir);
  return out.sort();
}

function runSetup(installer, installDir) {
  const start = new Date();
  const result = spawnSync(installer, ['/S', '/currentuser', `/D=${installDir}`], {
    windowsVerbatimArguments: true,
    timeout: 180_000,
    windowsHide: true,
    encoding: 'utf8'
  });
  return {
    start: start.toISOString(),
    end: new Date().toISOString(),
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error) : undefined,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

function crashEvents(sinceIso) {
  const command = [
    `$start = [datetime]::Parse('${sinceIso}', $null, [System.Globalization.DateTimeStyles]::RoundtripKind)`,
    `$events = Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000,1001; StartTime=$start} -ErrorAction SilentlyContinue |`,
    `  Where-Object { $_.Message -match 'HTMLpoint-Setup' -or $_.Message -match 'System\\.dll' } |`,
    `  Select-Object -First 8 TimeCreated, Id, Message`,
    `if ($events) { $events | ConvertTo-Json -Depth 3 } else { '[]' }`
  ].join('; ');
  const result = powershell(command, 45_000);
  try {
    return { query: result, events: JSON.parse(result.stdout || '[]') };
  } catch {
    return { query: result, events: [], parseError: true };
  }
}

function shortcutTarget(linkPath) {
  if (!existsSync(linkPath)) return null;
  const escaped = linkPath.replaceAll("'", "''");
  const result = powershell(
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${escaped}'); $s.TargetPath`
  );
  return result.stdout || null;
}

function launchSmoke(exePath, profileDir) {
  mkdirSync(profileDir, { recursive: true });
  const started = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Start-Process -FilePath '${exePath.replaceAll("'", "''")}' -ArgumentList '--user-data-dir=${profileDir.replaceAll("'", "''")}','--force-renderer-accessibility' -PassThru; Start-Sleep -Seconds 8; $running = Get-Process -Id $p.Id -ErrorAction SilentlyContinue; $windows = @(Get-Process -Id $p.Id -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count; [pscustomobject]@{ Pid = $p.Id; Running = [bool]$running; HasWindow = $windows -gt 0; MainWindowTitle = ($running.MainWindowTitle) } | ConvertTo-Json`
    ],
    { encoding: 'utf8', timeout: 40_000, windowsHide: true }
  );
  let info = {};
  try {
    info = JSON.parse(started.stdout || '{}');
  } catch {
    info = { parseError: true, stdout: started.stdout, stderr: started.stderr };
  }
  if (info.Pid) {
    spawnSync('taskkill.exe', ['/PID', String(info.Pid), '/T', '/F'], { windowsHide: true });
  }
  return {
    status: started.status,
    stderr: started.stderr?.trim() ?? '',
    ...info
  };
}

function findUninstaller(installDir) {
  if (!existsSync(installDir)) return null;
  const matches = readdirSync(installDir).filter((name) => /^Uninstall .+\.exe$/i.test(name));
  return matches[0] ? path.join(installDir, matches[0]) : null;
}

function runUninstall(uninstaller) {
  const result = spawnSync(uninstaller, ['/S'], {
    windowsVerbatimArguments: true,
    timeout: 180_000,
    windowsHide: true,
    encoding: 'utf8'
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error) : undefined,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

function waitUntilGone(target, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!existsSync(target)) return true;
    spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', 'Start-Sleep -Milliseconds 400'], {
      windowsHide: true
    });
  }
  return !existsSync(target);
}

function protectedProductInstallPresent() {
  return existsSync(path.join(process.env.LOCALAPPDATA ?? '', 'Programs', PRODUCT_NAME, PRODUCT_EXE));
}

function parseArgs() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = resolveExisting(
    argValue('artifact-dir', path.join(root, 'artifacts', 'qa-2026-09-13', `nsis-run-${stamp}`))
  );
  const installDir = resolveExisting(
    argValue(
      'install-dir',
      path.join(root, 'artifacts', 'qa-2026-09-13', `htmlpoint-nsis-install-${stamp}`)
    )
  );
  return {
    installer: argValue('installer', defaultInstaller() ?? ''),
    installDir,
    artifactDir,
    skipLaunch: process.argv.includes('--skip-launch'),
    skipUninstall: process.argv.includes('--skip-uninstall')
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isCli) {
  // imported by tests
} else {
  const args = parseArgs();
  mkdirSync(args.artifactDir, { recursive: true });
  const report = {
    platform: process.platform,
    os: os.release(),
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    args,
    protectedProductInstallPresent: protectedProductInstallPresent(),
    files: {}
  };

  try {
    if (process.platform !== 'win32') {
      throw new Error('NSIS silent-install verification only runs on Windows');
    }
    if (!args.installer || !existsSync(args.installer)) {
      throw new Error(`Installer not found: ${args.installer || '(none)'}`);
    }
    mkdirSync(args.installDir, { recursive: true });
    args.installDir = path.resolve(args.installDir);
    args.installer = path.resolve(args.installer);
    args.artifactDir = path.resolve(args.artifactDir);
    assertHarmlessTestDir(args.installDir);
    report.installerHash = sha256(args.installer);
    report.installerBytes = statSync(args.installer).size;
    report.files.before = listFiles(args.installDir);
    report.install = runSetup(args.installer, args.installDir);
    report.files.afterInstall = existsSync(args.installDir) ? listFiles(args.installDir) : [];
    report.installedExe = path.join(args.installDir, PRODUCT_EXE);
    report.installedExeExists = existsSync(report.installedExe);
    if (report.install.status !== 0 || !report.installedExeExists) {
      report.crash = crashEvents(report.install.start);
    }
    if (report.installedExeExists && !args.skipLaunch) {
      report.launch = launchSmoke(report.installedExe, path.join(args.artifactDir, 'appdata-profile'));
    }
    if (report.installedExeExists && !args.skipUninstall) {
      const uninstaller = findUninstaller(args.installDir);
      report.uninstaller = uninstaller;
      if (!uninstaller) {
        throw new Error(`Uninstaller not found in ${args.installDir}`);
      }
      report.uninstall = runUninstall(uninstaller);
      report.uninstallerGone = waitUntilGone(uninstaller);
      report.installedExeGone = waitUntilGone(report.installedExe);
      report.files.afterUninstall = existsSync(args.installDir) ? listFiles(args.installDir) : [];
      const desktop = path.join(process.env.USERPROFILE ?? '', 'Desktop', `${PRODUCT_NAME}.lnk`);
      const startMenu = path.join(
        process.env.APPDATA ?? '',
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        `${PRODUCT_NAME}.lnk`
      );
      report.shortcuts = {
        desktop: existsSync(desktop) ? { path: desktop, target: shortcutTarget(desktop) } : null,
        startMenu: existsSync(startMenu) ? { path: startMenu, target: shortcutTarget(startMenu) } : null
      };
      for (const item of Object.values(report.shortcuts)) {
        if (!item?.target) continue;
        const target = path.resolve(item.target);
        if (target.toLowerCase().startsWith(`${args.installDir.toLowerCase()}\\`) || target.toLowerCase() === args.installDir.toLowerCase()) {
          rmSync(item.path, { force: true });
          item.removedBecauseTargetedTestInstall = true;
        }
      }
    }
    report.ok =
      report.install?.status === 0 &&
      report.installedExeExists === true &&
      (args.skipLaunch || report.launch?.Running === true) &&
      (args.skipUninstall || (report.uninstall?.status === 0 && report.installedExeGone === true));
  } catch (error) {
    report.ok = false;
    report.error = String(error?.stack || error);
  }
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(args.artifactDir, 'nsis-verification.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ reportPath, ok: report.ok, installStatus: report.install?.status ?? null, installedExeExists: report.installedExeExists ?? false }, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
