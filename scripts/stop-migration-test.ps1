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
  $serverScript = [IO.Path]::GetFullPath((Join-Path $projectRoot "node_modules\next\dist\server\lib\start-server.js"))

  Assert-MortusTestPaths -ProjectRoot $projectRoot -TestDirectory $testDirectory -TestDatabase $testDatabase -MainDatabase $mainDatabase
  Assert-MortusNoReparsePoints $manifestPath
  $manifestExists = Test-Path -LiteralPath $manifestPath
  $manifest = $null
  if ($manifestExists) {
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Manifest is not a regular file; no process was stopped." }
    try { $manifest = Read-MortusTestManifest -ManifestPath $manifestPath } catch { throw "Manifest is invalid and was preserved; no process was stopped." }
    if ([IO.Path]::GetFullPath([string]$manifest.databasePath) -ine (Get-MortusFullPath $testDatabase) -or
        [IO.Path]::GetFullPath([string]$manifest.mainDatabasePath) -ine (Get-MortusFullPath $mainDatabase) -or
        $manifest.databaseUrl -cne "file:./.mortus-test/migration-test.db" -or
        $manifest.host -ne "127.0.0.1" -or [int]$manifest.port -ne $port -or
        [IO.Path]::GetFullPath([string]$manifest.nextCli) -ine $nextCli -or -not $manifest.nodePath) {
      throw "Manifest does not match this test environment; no process was stopped."
    }
  }

  $nodePath = if ($manifest) { [IO.Path]::GetFullPath([string]$manifest.nodePath) } else { [IO.Path]::GetFullPath((Get-Command node.exe -ErrorAction Stop).Source) }

  $processes = @(Get-MortusTestProcessInventory -NodePath $nodePath -NextCli $nextCli -Port $port -ServerScript $serverScript)
  $listeners = @(Get-MortusPortListeners -Port $port)
  Assert-MortusTestProcessRegistered -ManifestExists $manifestExists -ProcessInventory $processes

  $recordedPid = $null
  $mainProcess = $null
  $parentCreatedAt = $null
  $serverChild = $null
  $verifiedProcessIds = @()
  if ($manifest -and $null -ne $manifest.pid) {
    $recordedPid = [int]$manifest.pid
    $parentCreatedAt = [string]$manifest.processCreatedAt
    if (-not $parentCreatedAt) { throw "Manifest has no process creation time; preserved without stopping any process." }
    $recorded = @(Get-MortusProcessById -ProcessId $recordedPid)
    if ($recorded.Count -gt 1) { throw "PID query returned ambiguous results; manifest preserved." }
    if ($recorded.Count -eq 1) {
      if (-not (Test-MortusTestProcess $recorded[0] $nodePath $nextCli $port) -or (Get-MortusProcessCreatedAt $recorded[0]) -cne $parentCreatedAt) {
        throw "Registered PID is reused or does not match the recorded Next process; manifest preserved."
      }
      $mainProcess = $recorded[0]
      $verifiedProcessIds += $recordedPid
    }
    $children = @($processes | Where-Object { Test-MortusNextServerChild $_ $nodePath $serverScript $recordedPid $parentCreatedAt })
    if ($children.Count -gt 1) { throw "More than one direct Next server child matched the manifest; manifest preserved." }
    if ($children.Count -eq 1) {
      $serverChild = $children[0]
      $verifiedProcessIds += [int]$serverChild.ProcessId
    }
  }

  $unverifiedCandidates = @($processes | Where-Object { $verifiedProcessIds -notcontains [int]$_.ProcessId })
  if ($unverifiedCandidates.Count -gt 0) {
    throw "A Next process candidate exists but its relationship to the manifest cannot be proven; manifest preserved."
  }
  Assert-MortusPortListenersOwned -Listeners $listeners -VerifiedProcessIds ([int[]]$verifiedProcessIds)

  if ($mainProcess) {
    $manifest.state = "stopping"
    Write-MortusTestManifest -ManifestPath $manifestPath -Manifest $manifest
    Stop-MortusVerifiedTestProcess -ProcessInfo $mainProcess -NodePath $nodePath -NextCli $nextCli -Port $port -ExpectedCreatedAt $parentCreatedAt
  } elseif ($serverChild) {
    $manifest.state = "stopping"
    Write-MortusTestManifest -ManifestPath $manifestPath -Manifest $manifest
  }

  if ($serverChild) {
    $currentChild = @(Get-MortusProcessById -ProcessId ([int]$serverChild.ProcessId))
    if ($currentChild.Count -gt 0) {
      Stop-MortusVerifiedTestProcess -ProcessInfo $serverChild -NodePath $nodePath -NextCli $nextCli -Port $port -ExpectedCreatedAt $parentCreatedAt -Role "server-child" -ServerScript $serverScript -ParentProcessId $recordedPid
    }
  }

  $stopped = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $remainingProcesses = @(Get-MortusTestProcessInventory -NodePath $nodePath -NextCli $nextCli -Port $port -ServerScript $serverScript)
    $remainingListeners = @(Get-MortusPortListeners -Port $port)
    if ($remainingProcesses.Count -eq 0 -and $remainingListeners.Count -eq 0) { $stopped = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $stopped) { throw "Could not confirm Next processes and listening socket on port $port are stopped. Manifest preserved; database and logs untouched." }

  $finalProcesses = @(Get-MortusTestProcessInventory -NodePath $nodePath -NextCli $nextCli -Port $port -ServerScript $serverScript)
  $finalListeners = @(Get-MortusPortListeners -Port $port)
  Assert-MortusTestServerStopped -ProcessInventory $finalProcesses -PortListeners $finalListeners
  if ($null -ne $recordedPid -and @(Get-MortusProcessById -ProcessId $recordedPid).Count -gt 0) {
    throw "Registered PID exists again; manifest preserved."
  }
  if ($manifestExists) { Remove-MortusTestManifest -ManifestPath $manifestPath }
  Write-Output "Next test processes confirmed stopped. Database and logs preserved in $testDirectory."
}

$operationMutex = Enter-MortusTestOperation
try { Invoke-MigrationTestStop } finally { Exit-MortusTestOperation $operationMutex }
