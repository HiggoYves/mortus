$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "migration-test-safety.psm1") -Force

function Invoke-MigrationTestDiscard {
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$testDirectory = Join-Path $projectRoot ".mortus-test"
$testDatabase = Join-Path $testDirectory "migration-test.db"
$mainDatabase = Join-Path $projectRoot "prisma\mortus.db"
$manifestPath = Join-Path $testDirectory "server.json"
$port = 3002
$nextCli = [IO.Path]::GetFullPath((Join-Path $projectRoot "node_modules\next\dist\bin\next"))

function Assert-TestEnvironmentStopped {
  Assert-MortusTestPaths -ProjectRoot $projectRoot -TestDirectory $testDirectory -TestDatabase $testDatabase -MainDatabase $mainDatabase
  Assert-MortusNoReparsePoints $manifestPath
  if (Test-Path -LiteralPath $manifestPath) {
    throw "Existe um registro de servidor; execute test-env:stop e confirme a parada antes de descartar."
  }
  $processes = @(Get-MortusTestProcessInventory -NextCli $nextCli -Port $port)
  $listeners = @(Get-MortusPortListeners -Port $port)
  Assert-MortusTestServerStopped -ProcessInventory $processes -PortListeners $listeners
}

Assert-TestEnvironmentStopped
if (-not (Test-Path -LiteralPath $testDirectory)) {
  Write-Output "O diretÃ³rio e o banco de teste nÃ£o existem; nada foi removido."
  return
}
if (-not (Test-Path -LiteralPath $testDatabase)) {
  Write-Output "O banco de teste nÃ£o existe; nada foi removido."
  return
}
$testItem = Get-Item -Force -LiteralPath $testDatabase
if ($testItem.PSIsContainer) { throw "O caminho do banco nÃ£o Ã© um arquivo regular; nada foi removido." }
Assert-MortusDatabaseIsolated -TestDatabase $testDatabase -MainDatabase $mainDatabase

$confirmation = Read-Host "Digite DISCARD MORTUS TEST DB para excluir somente o banco e auxiliares SQLite temporÃ¡rios"
if ($confirmation -cne "DISCARD MORTUS TEST DB") { Write-Output "Cancelado; nenhum arquivo foi removido."; return }

# Recheck process state and every path after the interactive pause, immediately before removal.
Assert-TestEnvironmentStopped
Assert-MortusDatabaseIsolated -TestDatabase $testDatabase -MainDatabase $mainDatabase
$expectedDirectory = Get-MortusFullPath $testDirectory
$expectedMain = Get-MortusFullPath $mainDatabase
$targets = @($testDatabase, "$testDatabase-journal", "$testDatabase-wal", "$testDatabase-shm")
foreach ($target in $targets) {
  $normalizedTarget = Get-MortusFullPath $target
  if ($normalizedTarget -ieq $expectedMain -or [IO.Path]::GetDirectoryName($normalizedTarget) -ine $expectedDirectory) {
    throw "Alvo rejeitado: somente o banco e auxiliares diretos de .mortus-test podem ser removidos."
  }
  Assert-MortusNoReparsePoints $normalizedTarget
  if (Test-Path -LiteralPath $normalizedTarget) {
    $item = Get-Item -Force -LiteralPath $normalizedTarget
    if ($item.PSIsContainer) { throw "Alvo rejeitado: '$normalizedTarget' nÃ£o Ã© um arquivo regular." }
    Remove-Item -LiteralPath $normalizedTarget -Force
  }
}
Write-Output "Somente o banco temporÃ¡rio e auxiliares foram descartados. prisma\mortus.db, logs e diretÃ³rio foram preservados."
}

$operationMutex = Enter-MortusTestOperation
try { Invoke-MigrationTestDiscard } finally { Exit-MortusTestOperation $operationMutex }
