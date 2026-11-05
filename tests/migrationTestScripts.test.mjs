import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync, linkSync, copyFileSync, existsSync } from "node:fs";
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

function prepareStopFixture(root, pid = 98765, state = "stopping") {
  const project = join(root, "project");
  const scripts = join(project, "scripts");
  const testDirectory = join(project, ".mortus-test");
  const prismaDirectory = join(project, "prisma");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(testDirectory, { recursive: true });
  mkdirSync(prismaDirectory, { recursive: true });
  copyFileSync(join(scriptsDirectory, "migration-test-safety.psm1"), join(scripts, "migration-test-safety.psm1"));
  copyFileSync(join(scriptsDirectory, "stop-migration-test.ps1"), join(scripts, "stop-migration-test.ps1"));
  const testDatabase = join(testDirectory, "migration-test.db");
  const mainDatabase = join(prismaDirectory, "mortus.db");
  const stdoutLog = join(testDirectory, "server.stdout.log");
  const stderrLog = join(testDirectory, "server.stderr.log");
  writeFileSync(testDatabase, "isolated test fixture");
  writeFileSync(mainDatabase, "main database fixture");
  writeFileSync(stdoutLog, "test stdout fixture");
  writeFileSync(stderrLog, "test stderr fixture");
  const nextCli = join(project, "node_modules", "next", "dist", "bin", "next");
  const manifestPath = join(testDirectory, "server.json");
  writeFileSync(manifestPath, JSON.stringify({
    state,
    pid,
    databaseUrl: "file:./.mortus-test/migration-test.db",
    databasePath: testDatabase,
    mainDatabasePath: mainDatabase,
    host: "127.0.0.1",
    port: 3002,
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    processCreatedAt: "2026-10-31T00:00:00.000Z",
    nextCli,
    startedAt: "2026-10-31T00:00:00.000Z",
    error: "stale test fixture",
  }));
  return { project, testDirectory, testDatabase, mainDatabase, stdoutLog, stderrLog, manifestPath, nextCli };
}

function mockWindowsQueries({ listeners = "not-found", recordedProcess = null } = {}) {
  const noMatches = listeners === "not-found"
    ? "$errorRecord = [Management.Automation.ErrorRecord]::new([Exception]::new('no connections'), 'CmdletizationQuery_NotFound_LocalPort,Get-NetTCPConnection', [Management.Automation.ErrorCategory]::ObjectNotFound, $null); throw $errorRecord"
    : listeners === "permission-denied"
      ? "$errorRecord = [Management.Automation.ErrorRecord]::new([UnauthorizedAccessException]::new('access denied'), 'HRESULT 0x80041003,Get-NetTCPConnection', [Management.Automation.ErrorCategory]::PermissionDenied, $null); throw $errorRecord"
      : listeners === "unexpected-cim-error"
        ? "$errorRecord = [Management.Automation.ErrorRecord]::new([Management.ManagementException]::new('CIM query failed'), 'UnexpectedCimFailure,Get-NetTCPConnection', [Management.Automation.ErrorCategory]::ResourceUnavailable, $null); throw $errorRecord"
        : "return @([pscustomobject]@{ LocalPort = 3002; State = 'Listen' })";
  const processById = recordedProcess
    ? `if ($Filter) { return @([pscustomobject]@{ ProcessId = ${recordedProcess.ProcessId}; ParentProcessId = 1; Name = '${recordedProcess.Name}'; ExecutablePath = '${recordedProcess.ExecutablePath ?? "C:\\Program Files\\nodejs\\node.exe"}'; CreationDate = [datetime]'${recordedProcess.CreationDate ?? "2026-10-31T00:00:00Z"}'; CommandLine = '${recordedProcess.CommandLine}' }) }`
    : "if ($Filter) { return @() }";
  return `
    function global:Get-CimInstance {
      [CmdletBinding()]
      param([string]$ClassName, [string]$Filter)
      ${processById}
      return @()
    }
    function global:Get-NetTCPConnection {
      [CmdletBinding()]
      param([int]$LocalPort, [string]$State)
      ${noMatches}
    }
  `;
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
    $right = [pscustomobject]@{ Name = 'node.exe'; ExecutablePath = 'C:\\work\\node.exe'; CreationDate = [datetime]'2026-10-31T00:00:00Z'; CommandLine = 'node "C:\\work\\node_modules\\next\\dist\\bin\\next" dev --hostname 127.0.0.1 --port 3002' }
    $wrong = [pscustomobject]@{ Name = 'node.exe'; ExecutablePath = 'C:\\work\\node.exe'; CreationDate = [datetime]'2026-10-31T00:00:00Z'; CommandLine = 'node unrelated.js --port 3002' }
    if (-not (Test-MortusTestProcess $right 'C:\\work\\node.exe' 'C:\\work\\node_modules\\next\\dist\\bin\\next' 3002)) { throw 'expected Mortus process was not recognized' }
    if (Test-MortusTestProcess $wrong 'C:\\work\\node.exe' 'C:\\work\\node_modules\\next\\dist\\bin\\next' 3002) { throw 'unrelated process was recognized' }
    $conhost = [pscustomobject]@{ Name = 'conhost.exe'; ExecutablePath = 'C:\\Windows\\System32\\conhost.exe'; CommandLine = 'conhost.exe 0xffffffff' }
    if (Test-MortusTestProcess $conhost 'C:\\work\\node.exe' 'C:\\work\\node_modules\\next\\dist\\bin\\next' 3002) { throw 'conhost was recognized as Mortus Node' }
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

test("monta argumentos separados para o Next e detecta concatenação entre dev e --hostname", () => {
  const script = `
    $ErrorActionPreference = 'Stop'
    Import-Module ${psQuote(safetyModule)} -Force
    $arguments = Get-MortusNextArgumentList -NextCli 'C:\\Mortus Project\\node_modules\\next\\dist\\bin\\next' -Port 3002
    $expected = '"C:\\Mortus Project\\node_modules\\next\\dist\\bin\\next" dev --hostname 127.0.0.1 --port 3002'
    if ($arguments -cne $expected) { throw "wrong Next arguments: $arguments" }
    if ($arguments -match 'dev--hostname|--hostname127\.0\.0\.1|--port3002') { throw 'Next arguments were concatenated' }
    $invalidPortRejected = $false
    try { Get-MortusNextArgumentList -NextCli 'C:\\next' -Port 0 } catch { $invalidPortRejected = $true }
    if (-not $invalidPortRejected) { throw 'invalid port was accepted' }
  `;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const start = readFileSync(join(scriptsDirectory, "start-migration-test.ps1"), "utf8");
  assert.match(start, /Get-MortusNextArgumentList[\s\S]*Start-Process[\s\S]*-ArgumentList \$nextArguments/);
  assert.doesNotMatch(start, /"dev--hostname|dev\s*\+\s*"--hostname/);
});

test("reconhece apenas ObjectNotFound do filtro TCP como ausência confiável de listeners", () => {
  const script = `
    $ErrorActionPreference = 'Stop'
    Import-Module ${psQuote(safetyModule)} -Force
    $noMatch = [Management.Automation.ErrorRecord]::new([Exception]::new('no matches'), 'CmdletizationQuery_NotFound,Get-NetTCPConnection', [Management.Automation.ErrorCategory]::ObjectNotFound, $null)
    $localPortNoMatch = [Management.Automation.ErrorRecord]::new([Exception]::new('no connections'), 'CmdletizationQuery_NotFound_LocalPort,Get-NetTCPConnection', [Management.Automation.ErrorCategory]::ObjectNotFound, $null)
    $permission = [Management.Automation.ErrorRecord]::new([Exception]::new('denied'), 'HRESULT 0x80041003,Get-NetTCPConnection', [Management.Automation.ErrorCategory]::PermissionDenied, $null)
    $otherMissing = [Management.Automation.ErrorRecord]::new([Exception]::new('unexpected missing item'), 'OtherObjectNotFound,Get-NetTCPConnection', [Management.Automation.ErrorCategory]::ObjectNotFound, $null)
    if (-not (Test-MortusNoTcpListenersError $noMatch)) { throw 'expected exact no-match query marker to be accepted' }
    if (-not (Test-MortusNoTcpListenersError $localPortNoMatch)) { throw 'exact LocalPort no-match marker was not accepted' }
    if (Test-MortusNoTcpListenersError $permission) { throw 'permission failure was treated as free port' }
    if (Test-MortusNoTcpListenersError $otherMissing) { throw 'unrelated ObjectNotFound was treated as free port' }
    $nearMiss = [Management.Automation.ErrorRecord]::new([Exception]::new('unexpected query'), 'CmdletizationQuery_NotFound_LocalAddress,Get-NetTCPConnection', [Management.Automation.ErrorCategory]::ObjectNotFound, $null)
    if (Test-MortusNoTcpListenersError $nearMiss) { throw 'unrecognized no-match variant was accepted' }
    $script:localPortNoMatch = $localPortNoMatch
    function global:Get-NetTCPConnection { param([int]$LocalPort,[string]$State) throw $script:localPortNoMatch }
    if (@(Get-MortusPortTcpConnections -Port 3002).Count -ne 0) { throw 'known LocalPort no-match was not converted to an empty collection' }
  `;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("remove manifesto órfão somente após confirmar PID ausente e porta sem listeners", () => {
  withFixture((root) => {
    const fixture = prepareStopFixture(root);
    const script = `${mockWindowsQueries()}\n& ${psQuote(join(fixture.project, "scripts", "stop-migration-test.ps1"))}`;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(fixture.testDatabase, "utf8"), "isolated test fixture");
    assert.equal(readFileSync(fixture.mainDatabase, "utf8"), "main database fixture");
    assert.equal(readFileSync(fixture.stdoutLog, "utf8"), "test stdout fixture");
    assert.equal(readFileSync(fixture.stderrLog, "utf8"), "test stderr fixture");
    assert.equal(existsSync(fixture.manifestPath), false);
  });
});

test("preserva manifesto órfão diante de falha TCP ou PID reaproveitado por processo desconhecido", () => {
  for (const scenario of [
    { name: "TCP permission failure", options: { listeners: "permission-denied" } },
    { name: "unexpected TCP CIM error", options: { listeners: "unexpected-cim-error" } },
    { name: "PID belongs to unrelated process", options: { recordedProcess: { ProcessId: 98765, Name: "powershell.exe", CommandLine: "powershell.exe unrelated.ps1" } } },
  ]) {
    withFixture((root) => {
      const fixture = prepareStopFixture(root);
      const script = `${mockWindowsQueries(scenario.options)}\n& ${psQuote(join(fixture.project, "scripts", "stop-migration-test.ps1"))}`;
      const result = runPowerShell(script);
      assert.notEqual(result.status, 0, scenario.name);
      assert.equal(existsSync(fixture.manifestPath), true, scenario.name);
      assert.equal(readFileSync(fixture.testDatabase, "utf8"), "isolated test fixture", scenario.name);
      assert.equal(readFileSync(fixture.mainDatabase, "utf8"), "main database fixture", scenario.name);
      assert.equal(readFileSync(fixture.stdoutLog, "utf8"), "test stdout fixture", scenario.name);
      assert.equal(readFileSync(fixture.stderrLog, "utf8"), "test stderr fixture", scenario.name);
    });
  }
});

test("encerra somente o PID Node verificado e nunca inclui conhost ou a árvore", () => {
  const script = `
    $ErrorActionPreference = 'Stop'
    Import-Module ${psQuote(safetyModule)} -Force
    $node = [pscustomobject]@{ ProcessId = 9804; Name = 'node.exe'; ExecutablePath = 'C:\\Program Files\\nodejs\\node.exe'; CreationDate = [datetime]'2026-10-31T00:00:00Z'; CommandLine = 'node "C:\\mortus\\node_modules\\next\\dist\\bin\\next" dev --hostname 127.0.0.1 --port 3002' }
    function global:Get-CimInstance { param([string]$ClassName,[string]$Filter) return @($node) }
    $captured = @()
    Stop-MortusVerifiedTestProcess -ProcessInfo $node -NodePath $node.ExecutablePath -NextCli 'C:\\mortus\\node_modules\\next\\dist\\bin\\next' -Port 3002 -ExpectedCreatedAt '2026-10-31T00:00:00.0000000Z' -Terminator { param($target) $script:captured += $target }
    if ($captured.Count -ne 1 -or $captured[0] -ne 9804) { throw 'terminator did not receive exactly the registered node PID' }
  `;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const safety = readFileSync(join(scriptsDirectory, "migration-test-safety.psm1"), "utf8");
  assert.match(safety, /taskkill\.exe \/PID \$targetPid/);
  assert.doesNotMatch(safety, /taskkill\.exe[^\r\n]*\/(?:T|F)\b/i);
});

test("recusa PID reutilizado, processo inexistente e falha de encerramento sem alvo real", () => {
  const script = `
    $ErrorActionPreference = 'Stop'
    Import-Module ${psQuote(safetyModule)} -Force
    $node = [pscustomobject]@{ ProcessId = 9804; Name = 'node.exe'; ExecutablePath = 'C:\\Program Files\\nodejs\\node.exe'; CreationDate = [datetime]'2026-10-31T00:00:00Z'; CommandLine = 'node "C:\\mortus\\node_modules\\next\\dist\\bin\\next" dev --hostname 127.0.0.1 --port 3002' }
    $called = $false
    function global:Get-CimInstance { param([string]$ClassName,[string]$Filter) return @($script:current) }
    $script:current = $node
    $failed = $false
    try { Stop-MortusVerifiedTestProcess -ProcessInfo $node -NodePath $node.ExecutablePath -NextCli 'C:\\mortus\\node_modules\\next\\dist\\bin\\next' -Port 3002 -ExpectedCreatedAt '2026-10-31T00:00:00.0000000Z' -Terminator { $script:called = $true; throw 'simulated termination failure' } } catch { $failed = $true }
    if (-not $failed -or -not $called) { throw 'simulated termination failure was not propagated' }
    $script:current = [pscustomobject]@{ ProcessId = 9804; Name = 'node.exe'; ExecutablePath = $node.ExecutablePath; CreationDate = [datetime]'2026-11-01T00:00:00Z'; CommandLine = $node.CommandLine }
    $called = $false; $failed = $false
    try { Stop-MortusVerifiedTestProcess -ProcessInfo $node -NodePath $node.ExecutablePath -NextCli 'C:\\mortus\\node_modules\\next\\dist\\bin\\next' -Port 3002 -ExpectedCreatedAt '2026-10-31T00:00:00.0000000Z' -Terminator { $script:called = $true } } catch { $failed = $true }
    if (-not $failed -or $called) { throw 'reused PID was not rejected before termination' }
    $script:current = @()
    $failed = $false
    try { Stop-MortusVerifiedTestProcess -ProcessInfo $node -NodePath $node.ExecutablePath -NextCli 'C:\\mortus\\node_modules\\next\\dist\\bin\\next' -Port 3002 -ExpectedCreatedAt '2026-10-31T00:00:00.0000000Z' -Terminator { $script:called = $true } } catch { $failed = $true }
    if (-not $failed) { throw 'missing PID was not rejected' }
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

test("le e regrava PSCustomObject do manifesto preservando todos os campos e processCreatedAt", () => {
  withFixture((root) => {
    const manifestPath = join(root, "server.json");
    const original = {
      state: "running",
      pid: 12980,
      processCreatedAt: "2026-11-05T13:33:25.0539140Z",
      databaseUrl: "file:./.mortus-test/migration-test.db",
      databasePath: join(root, ".mortus-test", "migration-test.db"),
      mainDatabasePath: join(root, "prisma", "mortus.db"),
      host: "127.0.0.1",
      port: 3002,
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      nextCli: join(root, "node_modules", "next", "dist", "bin", "next"),
      startedAt: "2026-11-05T13:33:25.0000000Z",
      error: null,
    };
    writeFileSync(manifestPath, JSON.stringify(original));
    const script = `
      $ErrorActionPreference = 'Stop'
      Import-Module ${psQuote(safetyModule)} -Force
      $manifest = Get-Content -LiteralPath ${psQuote(manifestPath)} -Raw | ConvertFrom-Json
      if ($manifest -isnot [System.Management.Automation.PSCustomObject]) { throw 'fixture did not reproduce ConvertFrom-Json PSCustomObject' }
      $manifest.state = 'stopping'
      Write-MortusTestManifest -ManifestPath ${psQuote(manifestPath)} -Manifest $manifest
      $saved = Read-MortusTestManifest -ManifestPath ${psQuote(manifestPath)}
      if ($saved.state -ne 'stopping' -or $saved.pid -ne 12980 -or $saved.processCreatedAt -ne '2026-11-05T13:33:25.0539140Z') { throw 'required process identity fields changed' }
      foreach ($field in @('databaseUrl','databasePath','mainDatabasePath','host','port','nodePath','nextCli','startedAt','error')) {
        if (-not $saved.Contains($field)) { throw "manifest field was dropped: $field" }
      }
    `;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const saved = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(saved.processCreatedAt, original.processCreatedAt);
    assert.equal(saved.pid, original.pid);
    assert.equal(saved.state, "stopping");
    for (const key of Object.keys(original)) assert.ok(Object.hasOwn(saved, key), `missing manifest field ${key}`);
  });
});

test("falhas de normalização e leitura preservam o arquivo do manifesto", () => {
  withFixture((root) => {
    const manifestPath = join(root, "server.json");
    const original = '{"state":"stopping","pid":12980,"processCreatedAt":"2026-11-05T13:33:25.0539140Z"}';
    writeFileSync(manifestPath, original);
    const script = `
      $ErrorActionPreference = 'Stop'
      Import-Module ${psQuote(safetyModule)} -Force
      $rejected = $false
      try { Write-MortusTestManifest -ManifestPath ${psQuote(manifestPath)} -Manifest ([pscustomobject]@{}) } catch { $rejected = $true }
      if (-not $rejected) { throw 'empty manifest object was accepted' }
      if ([IO.File]::ReadAllText(${psQuote(manifestPath)}) -cne ${psQuote(original)}) { throw 'failed write changed the existing manifest' }
      $rejected = $false
      try { Read-MortusTestManifest -ManifestPath ${psQuote(manifestPath + ".missing")} } catch { $rejected = $true }
      if (-not $rejected) { throw 'missing manifest was accepted' }
      if ([IO.File]::ReadAllText(${psQuote(manifestPath)}) -cne ${psQuote(original)}) { throw 'failed read changed the existing manifest' }
    `;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(manifestPath, "utf8"), original);
  });
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
  assert.match(stop, /Get-MortusTestProcessInventory[\s\S]*Get-MortusPortListeners/);
  assert.doesNotMatch(stop, /\/T\b|\/F\b/);
  assert.match(readFileSync(join(scriptsDirectory, "migration-test-safety.psm1"), "utf8"), /Test-MortusNextServerChild[\s\S]*ParentProcessId[\s\S]*Get-MortusProcessCreatedAt/);
  assert.match(readFileSync(join(scriptsDirectory, "migration-test-safety.psm1"), "utf8"), /taskkill\.exe \/PID \$targetPid/);
  assert.match(stop, /Assert-MortusTestProcessRegistered/);
  assert.doesNotMatch(stop, /taskkill\.exe[^\r\n]*\/F/i);
  assert.match(discard, /Assert-TestEnvironmentStopped[\s\S]*Read-Host[\s\S]*Assert-TestEnvironmentStopped[\s\S]*Remove-Item/);
  assert.doesNotMatch(discard, /Remove-Item[^\r\n]*-Recurse/i);
});

test("reconhece o Next filho validando executável, script, PID pai e data de criação", () => {
  const script = `
    $ErrorActionPreference = 'Stop'
    Import-Module ${psQuote(safetyModule)} -Force
    $nodePath = 'C:\\Program Files\\nodejs\\node.exe'
    $serverScript = 'C:\\mortus\\node_modules\\next\\dist\\server\\lib\\start-server.js'
    $parentTime = '2026-11-05T14:03:11.6826470Z'
    $child = [pscustomobject]@{ ProcessId=28492; ParentProcessId=15592; Name='node.exe'; ExecutablePath=$nodePath; CreationDate=[datetime]'2026-11-05T14:03:15Z'; CommandLine='node "C:\\mortus\\node_modules\\next\\dist\\server\\lib\\start-server.js"' }
    if (-not (Test-MortusNextServerChild $child $nodePath $serverScript 15592 $parentTime)) { throw 'expected direct Next child not recognized' }
    $wrongParent = [pscustomobject]@{ ProcessId=28493; ParentProcessId=1; Name='node.exe'; ExecutablePath=$nodePath; CreationDate=[datetime]'2026-11-05T14:03:15Z'; CommandLine=$child.CommandLine }
    if (Test-MortusNextServerChild $wrongParent $nodePath $serverScript 15592 $parentTime) { throw 'unrelated ParentProcessId accepted' }
    $wrongExecutable = [pscustomobject]@{ ProcessId=28494; ParentProcessId=15592; Name='node.exe'; ExecutablePath='C:\\other\\node.exe'; CreationDate=[datetime]'2026-11-05T14:03:15Z'; CommandLine=$child.CommandLine }
    if (Test-MortusNextServerChild $wrongExecutable $nodePath $serverScript 15592 $parentTime) { throw 'wrong node executable accepted' }
    $oldChild = [pscustomobject]@{ ProcessId=28495; ParentProcessId=15592; Name='node.exe'; ExecutablePath=$nodePath; CreationDate=[datetime]'2026-11-05T14:03:00Z'; CommandLine=$child.CommandLine }
    if (Test-MortusNextServerChild $oldChild $nodePath $serverScript 15592 $parentTime) { throw 'process older than parent accepted' }

    Assert-MortusPortListenersOwned -Listeners @([pscustomobject]@{ State='Listen'; OwningProcess=28492 }) -VerifiedProcessIds @([int]15592,[int]28492)
    $unknownRejected=$false
    try { Assert-MortusPortListenersOwned -Listeners @([pscustomobject]@{ State='Listen'; OwningProcess=99999 }) -VerifiedProcessIds @([int]15592,[int]28492) } catch { $unknownRejected=$true }
    if (-not $unknownRejected) { throw 'unknown listener owner accepted' }

    $script:connections = @(
      [pscustomobject]@{ LocalPort=3002; State='TimeWait'; OwningProcess=777 },
      [pscustomobject]@{ LocalPort=3002; State='Closed'; OwningProcess=888 },
      [pscustomobject]@{ LocalPort=3002; State='Listen'; OwningProcess=28492 }
    )
    function global:Get-NetTCPConnection { param([int]$LocalPort,[string]$State) return $script:connections }
    $listeners = @(Get-MortusPortListeners -Port 3002)
    if ($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne 28492) { throw 'residual TCP state was treated as a listener' }
  `;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("porta livre não mascara Next ativo e filho órfão recebe somente encerrador simulado", () => {
  const script = `
    $ErrorActionPreference = 'Stop'
    Import-Module ${psQuote(safetyModule)} -Force
    $nodePath = 'C:\\Program Files\\nodejs\\node.exe'
    $nextCli = 'C:\\mortus\\node_modules\\next\\dist\\bin\\next'
    $serverScript = 'C:\\mortus\\node_modules\\next\\dist\\server\\lib\\start-server.js'
    $parentTime = '2026-11-05T14:03:11.6826470Z'
    $child = [pscustomobject]@{ ProcessId=28492; ParentProcessId=15592; Name='node.exe'; ExecutablePath=$nodePath; CreationDate=[datetime]'2026-11-05T14:03:15Z'; CommandLine='node "C:\\mortus\\node_modules\\next\\dist\\server\\lib\\start-server.js"' }
    $blocked=$false
    try { Assert-MortusTestServerStopped -ProcessInventory @($child) -PortListeners @() } catch { $blocked=$true }
    if (-not $blocked) { throw 'active child with free port was treated as stopped' }

    $script:currentProcess=$child
    function global:Get-CimInstance { param([string]$ClassName,[string]$Filter) return @($script:currentProcess) }
    $captured=@()
    Stop-MortusVerifiedTestProcess -ProcessInfo $child -NodePath $nodePath -NextCli $nextCli -Port 3002 -ExpectedCreatedAt $parentTime -Role 'server-child' -ServerScript $serverScript -ParentProcessId 15592 -Terminator { param($targetPid) $script:captured += $targetPid }
    if ($captured.Count -ne 1 -or $captured[0] -ne 28492) { throw 'only the verified child PID should be passed to the injected terminator' }
  `;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
