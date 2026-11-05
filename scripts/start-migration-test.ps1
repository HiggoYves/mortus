$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "migration-test-safety.psm1") -Force

function Invoke-MigrationTestStart {
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$testDirectory = Join-Path $projectRoot ".mortus-test"
$testDatabase = Join-Path $testDirectory "migration-test.db"
$mainDatabase = Join-Path $projectRoot "prisma\mortus.db"
$databaseUrl = "file:./.mortus-test/migration-test.db"
$manifestPath = Join-Path $testDirectory "server.json"
$stdoutPath = Join-Path $testDirectory "server.stdout.log"
$stderrPath = Join-Path $testDirectory "server.stderr.log"
$port = 3002
$nextCli = [IO.Path]::GetFullPath((Join-Path $projectRoot "node_modules\next\dist\bin\next"))
$serverScript = [IO.Path]::GetFullPath((Join-Path $projectRoot "node_modules\next\dist\server\lib\start-server.js"))
$nodePath = [IO.Path]::GetFullPath((Get-Command node.exe -ErrorAction Stop).Source)
$nextArguments = Get-MortusNextArgumentList -NextCli $nextCli -Port $port

Assert-MortusTestPaths -ProjectRoot $projectRoot -TestDirectory $testDirectory -TestDatabase $testDatabase -MainDatabase $mainDatabase
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules\.bin\prisma.cmd") -PathType Leaf)) {
  throw "Prisma local nÃ£o encontrado. Instale as dependÃªncias do projeto antes de iniciar este ambiente."
}
if (-not (Test-Path -LiteralPath $nextCli -PathType Leaf)) {
  throw "Next.js local nÃ£o encontrado. Instale as dependÃªncias do projeto antes de iniciar este ambiente."
}
if (Test-Path -LiteralPath $manifestPath) { throw "JÃ¡ existe um registro do ambiente de teste. Execute npm.cmd run test-env:stop primeiro." }

if (Test-Path -LiteralPath $testDirectory) {
  $directoryItem = Get-Item -Force -LiteralPath $testDirectory
  if (-not $directoryItem.PSIsContainer) { throw "O caminho reservado ao teste existe, mas nÃ£o Ã© um diretÃ³rio." }
}
New-Item -ItemType Directory -Path $testDirectory -Force | Out-Null
Assert-MortusTestPaths -ProjectRoot $projectRoot -TestDirectory $testDirectory -TestDatabase $testDatabase -MainDatabase $mainDatabase
if (Test-Path -LiteralPath $testDatabase) {
  $databaseItem = Get-Item -Force -LiteralPath $testDatabase
  if ($databaseItem.PSIsContainer) { throw "O caminho reservado ao banco de teste Ã© um diretÃ³rio." }
  Assert-MortusDatabaseIsolated -TestDatabase $testDatabase -MainDatabase $mainDatabase
}

# Fail closed if Windows cannot enumerate processes or listeners. This happens before any migration.
$processes = @(Get-MortusTestProcessInventory -NodePath $nodePath -NextCli $nextCli -Port $port -ServerScript $serverScript)
$listeners = @(Get-MortusPortListeners -Port $port)
Assert-MortusTestServerStopped -ProcessInventory $processes -PortListeners $listeners

$manifest = [ordered]@{
  state = "starting"
  pid = $null
  processCreatedAt = $null
  databaseUrl = $databaseUrl
  databasePath = (Get-MortusFullPath $testDatabase)
  mainDatabasePath = (Get-MortusFullPath $mainDatabase)
  host = "127.0.0.1"
  port = $port
  nodePath = [IO.Path]::GetFullPath($nodePath)
  nextCli = $nextCli
  startedAt = (Get-Date).ToString("o")
  error = $null
}
Write-MortusTestManifest -ManifestPath $manifestPath -Manifest $manifest

$oldDatabaseUrl = $env:DATABASE_URL
$oldTestDatabaseUrl = $env:MORTUS_TEST_DATABASE_URL
$oldTestMode = $env:MORTUS_TEST_ENV
$serverProcess = $null
Push-Location $projectRoot
try {
  $env:DATABASE_URL = $databaseUrl
  $env:MORTUS_TEST_DATABASE_URL = $databaseUrl
  $env:MORTUS_TEST_ENV = "1"
  & (Join-Path $projectRoot "node_modules\.bin\prisma.cmd") migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "A migraÃ§Ã£o Prisma do banco temporÃ¡rio falhou (cÃ³digo $LASTEXITCODE)." }
  if (-not (Test-Path -LiteralPath $testDatabase -PathType Leaf)) { throw "Prisma nÃ£o criou o arquivo SQLite no caminho de teste esperado." }
  Assert-MortusTestPaths -ProjectRoot $projectRoot -TestDirectory $testDirectory -TestDatabase $testDatabase -MainDatabase $mainDatabase
  Assert-MortusDatabaseIsolated -TestDatabase $testDatabase -MainDatabase $mainDatabase

  $serverProcess = Start-Process -FilePath $nodePath -ArgumentList $nextArguments -WorkingDirectory $projectRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru
  $manifest.pid = $serverProcess.Id
  $processInfo = @(Get-MortusProcessById -ProcessId $serverProcess.Id)
  if ($processInfo.Count -ne 1 -or -not (Test-MortusTestProcess $processInfo[0] $nodePath $nextCli $port)) { throw "Não foi possível comprovar a identidade do processo Node iniciado; manifesto preservado." }
  $manifest.processCreatedAt = Get-MortusProcessCreatedAt $processInfo[0]
  if (-not $manifest.processCreatedAt) { throw "O Windows não forneceu a data de criação do processo; manifesto preservado." }
  Write-MortusTestManifest -ManifestPath $manifestPath -Manifest $manifest

  $responding = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if ($serverProcess.HasExited) { throw "O servidor Next.js encerrou durante a inicializaÃ§Ã£o. Consulte os logs em .mortus-test." }
    try {
      $health = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/events" -Method Get -UseBasicParsing -TimeoutSec 2
      $responding = $health.StatusCode -eq 200
    } catch { $responding = $false }
    if ($responding) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $responding) { throw "A API nÃ£o respondeu em 127.0.0.1:$port no prazo esperado. O registro de processo foi preservado para parada segura." }

  $manifest.state = "running"
  Write-MortusTestManifest -ManifestPath $manifestPath -Manifest $manifest
  Write-Output "Ambiente de teste iniciado: http://127.0.0.1:$port"
  Write-Output "DATABASE_URL: $databaseUrl"
  Write-Output "Banco de teste: $($manifest.databasePath)"
  Write-Output "Banco principal (nÃ£o utilizado): $($manifest.mainDatabasePath)"
  Write-Output "Confirme o destino com: Get-Content .mortus-test\server.json"
} catch {
  $failureMessage = $_.Exception.Message
  try {
    $manifest.state = "failed"
    $manifest.error = $failureMessage
    if ($serverProcess) { $manifest.pid = $serverProcess.Id }
    Write-MortusTestManifest -ManifestPath $manifestPath -Manifest $manifest
  } catch {
    # The pre-launch `starting` record remains available for recovery by test-env:stop.
  }
  try {
    & (Join-Path $PSScriptRoot "stop-migration-test.ps1")
  } catch {
    throw "Falha ao iniciar o ambiente: $failureMessage. A parada automÃ¡tica nÃ£o foi comprovada; o manifesto foi mantido. Execute test-env:stop com permissÃ£o para consultar e parar processos."
  }
  throw "Falha ao iniciar o ambiente de teste: $failureMessage. O servidor foi verificado como parado; o banco e os logs foram preservados."
} finally {
  Pop-Location
  $env:DATABASE_URL = $oldDatabaseUrl
  $env:MORTUS_TEST_DATABASE_URL = $oldTestDatabaseUrl
  $env:MORTUS_TEST_ENV = $oldTestMode
}
}

$operationMutex = Enter-MortusTestOperation
try { Invoke-MigrationTestStart } finally { Exit-MortusTestOperation $operationMutex }
