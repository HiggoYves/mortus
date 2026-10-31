import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scriptsDirectory = resolve("scripts");
const safetyModule = join(scriptsDirectory, "migration-test-safety.psm1");

function runPowerShell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-NonInteractive", "-EncodedCommand", encoded], {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
}

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "mortus-script-safety-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("valida somente os caminhos previstos e rejeita destinos alternativos", () => {
  withFixture((root) => {
    const project = join(root, "project");
    const testDirectory = join(project, ".mortus-test");
    const testDatabase = join(testDirectory, "migration-test.db");
    const mainDatabase = join(project, "prisma", "mortus.db");
    mkdirSync(testDirectory, { recursive: true });
    mkdirSync(join(project, "prisma"), { recursive: true });
    writeFileSync(testDatabase, "fixture only");
    writeFileSync(mainDatabase, "main fixture only");

    const script = `
      $ErrorActionPreference = 'Stop'
      Import-Module ${psQuote(safetyModule)} -Force
      Assert-MortusTestPaths -ProjectRoot ${psQuote(project)} -TestDirectory ${psQuote(testDirectory)} -TestDatabase ${psQuote(testDatabase)} -MainDatabase ${psQuote(mainDatabase)}
      Assert-MortusDatabaseIsolated -TestDatabase ${psQuote(testDatabase)} -MainDatabase ${psQuote(mainDatabase)}
      $wrong = $false
      try { Assert-MortusTestPaths -ProjectRoot ${psQuote(project)} -TestDirectory ${psQuote(testDirectory)} -TestDatabase ${psQuote(mainDatabase)} -MainDatabase ${psQuote(mainDatabase) } } catch { $wrong = $true }
      if (-not $wrong) { throw 'accepted main database as the test target' }
    `;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});

test("rejeita banco de teste com hard link para evitar compartilhar arquivo físico", () => {
  withFixture((root) => {
    const project = join(root, "project");
    const testDirectory = join(project, ".mortus-test");
    const testDatabase = join(testDirectory, "migration-test.db");
    const mainDatabase = join(project, "prisma", "mortus.db");
    mkdirSync(testDirectory, { recursive: true });
    mkdirSync(join(project, "prisma"), { recursive: true });
    writeFileSync(mainDatabase, "main fixture only");
    linkSync(mainDatabase, testDatabase);
    const script = `
      $ErrorActionPreference = 'Stop'
      Import-Module ${psQuote(safetyModule)} -Force
      $rejected = $false
      try { Assert-MortusDatabaseIsolated -TestDatabase ${psQuote(testDatabase)} -MainDatabase ${psQuote(mainDatabase)} } catch { $rejected = $_.Exception.Message -like '*mais de um link*' -or $_.Exception.Message -like '*mesmo arquivo*' }
      if (-not $rejected) { throw 'did not reject shared physical database file' }
    `;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});

test("rejeita diretório de teste redirecionado por junction", () => {
  withFixture((root) => {
    const project = join(root, "project");
    const testDirectory = join(project, ".mortus-test");
    const redirected = join(root, "redirected");
    const mainDatabase = join(project, "prisma", "mortus.db");
    mkdirSync(project, { recursive: true });
    mkdirSync(redirected, { recursive: true });
    mkdirSync(join(project, "prisma"), { recursive: true });
    const script = `
      $ErrorActionPreference = 'Stop'
      Import-Module ${psQuote(safetyModule)} -Force
      New-Item -ItemType Junction -Path ${psQuote(testDirectory)} -Target ${psQuote(redirected)} | Out-Null
      $rejected = $false
      try { Assert-MortusTestPaths -ProjectRoot ${psQuote(project)} -TestDirectory ${psQuote(testDirectory)} -TestDatabase ${psQuote(join(testDirectory, "migration-test.db"))} -MainDatabase ${psQuote(mainDatabase)} } catch { $rejected = $_.Exception.Message -match 'reparse point' }
      if (-not $rejected) { throw 'did not reject redirected test directory' }
    `;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});

test("rejeita arquivo de banco redirecionado por link simbólico", (context) => {
  withFixture((root) => {
    const project = join(root, "project");
    const testDirectory = join(project, ".mortus-test");
    const testDatabase = join(testDirectory, "migration-test.db");
    const mainDatabase = join(project, "prisma", "mortus.db");
    const redirectedDatabase = join(root, "outside.db");
    mkdirSync(testDirectory, { recursive: true });
    mkdirSync(join(project, "prisma"), { recursive: true });
    writeFileSync(redirectedDatabase, "outside fixture only");
    try {
      symlinkSync(redirectedDatabase, testDatabase, "file");
    } catch (error) {
      context.skip(`Windows não permite criar o symlink de teste neste ambiente: ${error.code}`);
      return;
    }
    const script = `
      $ErrorActionPreference = 'Stop'
      Import-Module ${psQuote(safetyModule)} -Force
      $rejected = $false
      try { Assert-MortusTestPaths -ProjectRoot ${psQuote(project)} -TestDirectory ${psQuote(testDirectory)} -TestDatabase ${psQuote(testDatabase)} -MainDatabase ${psQuote(mainDatabase)} } catch { $rejected = $_.Exception.Message -match 'reparse point' }
      if (-not $rejected) { throw 'did not reject redirected test database file' }
    `;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});

test("falha fechada quando há processo, listener ou consulta de estado indisponível", () => {
  const script = `
    $ErrorActionPreference = 'Stop'
    Import-Module ${psQuote(safetyModule)} -Force
    Assert-MortusTestServerStopped -ProcessInventory @() -PortListeners @()
    foreach ($case in @(
      @{ Processes = @([pscustomobject]@{ ProcessId = 123 }); Listeners = @() },
      @{ Processes = @(); Listeners = @([pscustomobject]@{ LocalPort = 3002 }) },
      @{ Processes = $null; Listeners = @() }
    )) {
      $rejected = $false
      try { Assert-MortusTestServerStopped -ProcessInventory $case.Processes -PortListeners $case.Listeners } catch { $rejected = $true }
      if (-not $rejected) { throw 'unsafe server state was accepted' }
    }
    $right = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node "C:\\work\\node_modules\\next\\dist\\bin\\next" dev --hostname 127.0.0.1 --port 3002' }
    $wrong = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node unrelated.js --port 3002' }
    if (-not (Test-MortusTestProcess $right 'C:\\work\\node_modules\\next\\dist\\bin\\next' 3002)) { throw 'expected Mortus process was not recognized' }
    if (Test-MortusTestProcess $wrong 'C:\\work\\node_modules\\next\\dist\\bin\\next' 3002) { throw 'unrelated process was recognized' }
    if (-not (Test-MortusReparseItem ([pscustomobject]@{ Attributes = [IO.FileAttributes]::ReparsePoint }))) { throw 'reparse file attributes were not rejected' }
    if (Test-MortusReparseItem ([pscustomobject]@{ Attributes = [IO.FileAttributes]::Archive })) { throw 'ordinary file was misclassified as a reparse point' }
    Assert-MortusTestProcessRegistered -ManifestExists $true -ProcessInventory @($right)
    $unregisteredRejected = $false
    try { Assert-MortusTestProcessRegistered -ManifestExists $false -ProcessInventory @($right) } catch { $unregisteredRejected = $true }
    if (-not $unregisteredRejected) { throw 'unregistered process was accepted for automatic termination' }
  `;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("permite recuperar o mutex abandonado por um processo de inicialização interrompido", () => {
  const childScript = `Import-Module ${psQuote(safetyModule)} -Force; $mutex = Enter-MortusTestOperation; [Environment]::Exit(0)`;
  const childEncoded = Buffer.from(childScript, "utf16le").toString("base64");
  const script = `
    $ErrorActionPreference = 'Stop'
    $child = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NonInteractive','-EncodedCommand','${childEncoded}') -NoNewWindow -PassThru -Wait
    if ($child.ExitCode -ne 0) { throw 'could not create abandoned operation lock' }
    Import-Module ${psQuote(safetyModule)} -Force
    $mutex = Enter-MortusTestOperation
    Exit-MortusTestOperation $mutex
  `;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("registro guarda estado inicial e PID após falha simulada", () => {
  withFixture((root) => {
    const testDirectory = join(root, ".mortus-test");
    const manifestPath = join(testDirectory, "server.json");
    mkdirSync(testDirectory, { recursive: true });
    const script = `
      $ErrorActionPreference = 'Stop'
      Import-Module ${psQuote(safetyModule)} -Force
      $manifest = [ordered]@{ state = 'starting'; pid = $null; databasePath = ${psQuote(join(testDirectory, "migration-test.db"))}; error = $null }
      Write-MortusTestManifest -ManifestPath ${psQuote(manifestPath)} -Manifest $manifest
      $manifest.state = 'failed'
      $manifest.pid = 98765
      $manifest.error = 'simulated startup failure'
      Write-MortusTestManifest -ManifestPath ${psQuote(manifestPath)} -Manifest $manifest
      $saved = Get-Content -LiteralPath ${psQuote(manifestPath)} -Raw | ConvertFrom-Json
      if ($saved.state -ne 'failed' -or $saved.pid -ne 98765 -or $saved.error -ne 'simulated startup failure') { throw 'failed start was not left recoverable' }
    `;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.state, "failed");
    assert.equal(manifest.pid, 98765);
  });
});

test("os scripts não usam encerramento forçado amplo nem removem diretório recursivamente", () => {
  const start = readFileSync(join(scriptsDirectory, "start-migration-test.ps1"), "utf8");
  const stop = readFileSync(join(scriptsDirectory, "stop-migration-test.ps1"), "utf8");
  const discard = readFileSync(join(scriptsDirectory, "discard-migration-test-db.ps1"), "utf8");
  assert.match(start, /state\s*=\s*"starting"[\s\S]*Write-MortusTestManifest[\s\S]*Start-Process/);
  assert.match(stop, /Get-MortusTestProcessInventory[\s\S]*Get-MortusPortListeners[\s\S]*taskkill\.exe \/PID[\s\S]*\/T/);
  assert.match(stop, /Assert-MortusTestProcessRegistered/);
  assert.doesNotMatch(stop, /taskkill\.exe[^\r\n]*\/F/i);
  assert.match(discard, /Assert-TestEnvironmentStopped[\s\S]*Read-Host[\s\S]*Assert-TestEnvironmentStopped[\s\S]*Remove-Item/);
  assert.doesNotMatch(discard, /Remove-Item[^\r\n]*-Recurse/i);
});
