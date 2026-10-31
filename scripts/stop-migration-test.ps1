$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "migration-test-safety.psm1") -Force

function Invoke-MigrationTestStop {
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$testDirectory = Join-Path $projectRoot ".mortus-test"
$testDatabase = Join-Path $testDirectory "migration-test.db"
$mainDatabase = Join-Path $projectRoot "prisma\mortus.db"
$manifestPath = Join-Path $testDirectory "server.json"
$port = 3002
$nextCli = [IO.Path]::GetFullPath((Join-Path $projectRoot "node_modules\next\dist\bin\next"))

Assert-MortusTestPaths -ProjectRoot $projectRoot -TestDirectory $testDirectory -TestDatabase $testDatabase -MainDatabase $mainDatabase
Assert-MortusNoReparsePoints $manifestPath
$manifestExists = Test-Path -LiteralPath $manifestPath
$manifest = $null
if ($manifestExists) {
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "O registro do servidor nÃ£o Ã© um arquivo regular; nenhum processo foi parado." }
  try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop } catch {
    throw "O registro do servidor estÃ¡ invÃ¡lido; foi preservado e nenhum processo foi parado."
  }
  if ([IO.Path]::GetFullPath([string]$manifest.databasePath) -ine (Get-MortusFullPath $testDatabase) -or
      [IO.Path]::GetFullPath([string]$manifest.mainDatabasePath) -ine (Get-MortusFullPath $mainDatabase) -or
      $manifest.databaseUrl -cne "file:./.mortus-test/migration-test.db" -or
      $manifest.host -ne "127.0.0.1" -or [int]$manifest.port -ne $port -or
      [IO.Path]::GetFullPath([string]$manifest.nextCli) -ine $nextCli) {
    throw "O registro nÃ£o corresponde ao ambiente de teste esperado; nenhum processo foi parado."
  }
}

$processes = @(Get-MortusTestProcessInventory -NextCli $nextCli -Port $port)
$listeners = @(Get-MortusPortListeners -Port $port)
Assert-MortusTestProcessRegistered -ManifestExists $manifestExists -ProcessInventory $processes
$chosenProcess = $null
if ($manifest -and $null -ne $manifest.pid) {
  $recordedPid = [int]$manifest.pid
  $recordedMatch = @($processes | Where-Object { [int]$_.ProcessId -eq $recordedPid })
  if ($recordedMatch.Count -gt 0) {
    $chosenProcess = $recordedMatch[0]
    while ($true) {
      $matchingParent = @($processes | Where-Object { [int]$_.ProcessId -eq [int]$chosenProcess.ParentProcessId })
      if ($matchingParent.Count -ne 1) { break }
      $chosenProcess = $matchingParent[0]
    }
  }
}
if (-not $chosenProcess -and $processes.Count -gt 0) {
  $candidateIds = @($processes | ForEach-Object { [int]$_.ProcessId })
  $roots = @($processes | Where-Object { $candidateIds -notcontains [int]$_.ParentProcessId })
  if ($roots.Count -eq 1) { $chosenProcess = $roots[0] }
  elseif ($roots.Count -gt 1) { throw "HÃ¡ mais de um processo Next candidato; nÃ£o Ã© possÃ­vel escolher com seguranÃ§a. Registro preservado." }
  else { throw "NÃ£o foi possÃ­vel identificar a raiz do processo Next. Registro preservado." }
}

if ($chosenProcess) {
  if ($manifest) {
    $manifest.state = "stopping"
    Write-MortusTestManifest -ManifestPath $manifestPath -Manifest ([ordered]@{
      state = $manifest.state; pid = [int]$chosenProcess.ProcessId
      databaseUrl = $manifest.databaseUrl; databasePath = $manifest.databasePath
      mainDatabasePath = $manifest.mainDatabasePath; host = $manifest.host; port = $manifest.port
      nodePath = $manifest.nodePath; nextCli = $manifest.nextCli; startedAt = $manifest.startedAt; error = $manifest.error
    })
  }
  # Target only the verified Next process tree. No force flag is used.
  $taskkillOutput = & taskkill.exe /PID ([int]$chosenProcess.ProcessId) /T 2>&1
  $taskkillExitCode = $LASTEXITCODE
  if ($taskkillExitCode -ne 0) {
    Write-Warning ($taskkillOutput -join " ")
  }
}

$stopped = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  $remainingProcesses = @(Get-MortusTestProcessInventory -NextCli $nextCli -Port $port)
  $remainingListeners = @(Get-MortusPortListeners -Port $port)
  if ($remainingProcesses.Count -eq 0 -and $remainingListeners.Count -eq 0) { $stopped = $true; break }
  Start-Sleep -Milliseconds 250
}
if (-not $stopped) { throw "NÃ£o foi possÃ­vel comprovar que o servidor e a porta $port foram liberados. O registro foi mantido; banco e logs nÃ£o foram alterados." }

if ($manifestExists) { Remove-MortusTestManifest -ManifestPath $manifestPath }
Write-Output "Servidor de teste comprovadamente parado. Banco e logs foram preservados em $testDirectory."
}

$operationMutex = Enter-MortusTestOperation
try { Invoke-MigrationTestStop } finally { Exit-MortusTestOperation $operationMutex }
