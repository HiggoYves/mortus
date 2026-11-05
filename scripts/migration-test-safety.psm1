Set-StrictMode -Version Latest

if (-not ("MortusMigrationTest.FileIdentity" -as [type])) {
  $fileIdentitySource = @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace MortusMigrationTest {
  public static class FileIdentity {
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeFileTime { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeFileInfo {
      public uint Attributes;
      public NativeFileTime CreationTime;
      public NativeFileTime LastAccessTime;
      public NativeFileTime LastWriteTime;
      public uint VolumeSerialNumber;
      public uint FileSizeHigh;
      public uint FileSizeLow;
      public uint NumberOfLinks;
      public uint FileIndexHigh;
      public uint FileIndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, FileShare share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out NativeFileInfo info);
    public static string Get(string path, out uint numberOfLinks) {
      using (SafeFileHandle handle = CreateFile(path, 0, FileShare.ReadWrite | FileShare.Delete, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        NativeFileInfo info;
        if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        numberOfLinks = info.NumberOfLinks;
        return info.VolumeSerialNumber.ToString("X8") + ":" + info.FileIndexHigh.ToString("X8") + info.FileIndexLow.ToString("X8");
      }
    }
  }
}
'@
  Add-Type -TypeDefinition $fileIdentitySource -Language CSharp -ErrorAction Stop
}

function Get-MortusFullPath([string] $Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
  $trimmed = $fullPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  if ($trimmed -ieq $pathRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)) { return $pathRoot }
  return $trimmed
}

function Enter-MortusTestOperation {
  $mutex = [Threading.Mutex]::new($false, "Local\MortusMigrationTestEnvironment")
  $acquired = $false
  try {
    try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { throw "Another migration-test operation is still running." }
    return $mutex
  } catch {
    if ($acquired) { try { $mutex.ReleaseMutex() } catch {} }
    $mutex.Dispose()
    throw
  }
}

function Exit-MortusTestOperation($Mutex) {
  if ($Mutex) {
    try { $Mutex.ReleaseMutex() } finally { $Mutex.Dispose() }
  }
}

function Test-MortusReparseItem($Item) {
  return $null -ne $Item -and (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Assert-MortusDatabaseIsolated([string] $TestDatabase, [string] $MainDatabase) {
  if (-not (Test-Path -LiteralPath $TestDatabase -PathType Leaf)) { return }
  Assert-MortusNoReparsePoints $TestDatabase
  Assert-MortusNoReparsePoints $MainDatabase
  [uint32]$linkCount = 0
  $testIdentity = [MortusMigrationTest.FileIdentity]::Get($TestDatabase, [ref]$linkCount)
  if ($linkCount -ne 1) { throw "Banco de teste rejeitado: o arquivo possui mais de um link físico." }
  if (Test-Path -LiteralPath $MainDatabase -PathType Leaf) {
    [uint32]$mainLinkCount = 0
    $mainIdentity = [MortusMigrationTest.FileIdentity]::Get($MainDatabase, [ref]$mainLinkCount)
    if ($testIdentity -eq $mainIdentity) { throw "Banco de teste rejeitado: ele aponta para o mesmo arquivo físico do banco principal." }
  }
}

function Assert-MortusNoReparsePoints([string] $Path) {
  $cursor = Get-MortusFullPath $Path
  while ($cursor) {
    $item = $null
    try {
      $item = Get-Item -Force -LiteralPath $cursor -ErrorAction Stop
    } catch {
      if ($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) { throw }
    }
    if (Test-MortusReparseItem $item) {
        throw "Caminho rejeitado: existe junction, link simbólico ou outro reparse point em '$cursor'."
    }
    $parent = [IO.Directory]::GetParent($cursor)
    if (-not $parent -or $parent.FullName -ieq $cursor) { break }
    $cursor = $parent.FullName
  }
}

function Assert-MortusTestPaths {
  param(
    [Parameter(Mandatory)][string] $ProjectRoot,
    [Parameter(Mandatory)][string] $TestDirectory,
    [Parameter(Mandatory)][string] $TestDatabase,
    [Parameter(Mandatory)][string] $MainDatabase
  )

  $root = Get-MortusFullPath $ProjectRoot
  $expectedDirectory = Get-MortusFullPath (Join-Path $root ".mortus-test")
  $expectedTestDatabase = Get-MortusFullPath (Join-Path $expectedDirectory "migration-test.db")
  $expectedMainDatabase = Get-MortusFullPath (Join-Path $root "prisma\mortus.db")
  if ((Get-MortusFullPath $TestDirectory) -ine $expectedDirectory -or
      (Get-MortusFullPath $TestDatabase) -ine $expectedTestDatabase -or
      (Get-MortusFullPath $MainDatabase) -ine $expectedMainDatabase -or
      $expectedTestDatabase -ieq $expectedMainDatabase) {
    throw "Caminhos rejeitados: o ambiente precisa usar exatamente .mortus-test\migration-test.db e manter prisma\mortus.db fora do alvo."
  }
  Assert-MortusNoReparsePoints $root
  Assert-MortusNoReparsePoints $expectedDirectory
  Assert-MortusNoReparsePoints $expectedTestDatabase
  Assert-MortusNoReparsePoints $expectedMainDatabase
}

function Get-MortusNextArgumentList([string] $NextCli, [int] $Port) {
  if (-not $NextCli -or $Port -lt 1 -or $Port -gt 65535) { throw "Argumentos inválidos para iniciar o Next.js." }
  $quotedNextCli = '"' + $NextCli.Replace('"', '\"') + '"'
  return "$quotedNextCli dev --hostname 127.0.0.1 --port $Port"
}

function Test-MortusTestProcess($ProcessInfo, [string] $NodePath, [string] $NextCli, [int] $Port) {
  if (-not $ProcessInfo -or $ProcessInfo.Name -ine "node.exe" -or -not $ProcessInfo.CommandLine -or -not $ProcessInfo.ExecutablePath) { return $false }
  if ((Get-MortusFullPath ([string]$ProcessInfo.ExecutablePath)) -ine (Get-MortusFullPath $NodePath)) { return $false }
  $commandLine = [string]$ProcessInfo.CommandLine
  return $commandLine.IndexOf($NextCli, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine -match '(?i)(^|\s)dev(\s|$)' -and
    $commandLine -match '(?i)--hostname\s+"?127\.0\.0\.1"?' -and
    $commandLine -match "(?i)--port\s+`"?$Port`"?(\s|$)"
}

function Test-MortusNextServerChildImage($ProcessInfo, [string] $NodePath, [string] $ServerScript) {
  if (-not $ProcessInfo -or $ProcessInfo.Name -ine "node.exe" -or -not $ProcessInfo.CommandLine -or -not $ProcessInfo.ExecutablePath) { return $false }
  if ((Get-MortusFullPath ([string]$ProcessInfo.ExecutablePath)) -ine (Get-MortusFullPath $NodePath)) { return $false }
  $scriptToken = '(?i)(^|\s)"?' + [regex]::Escape((Get-MortusFullPath $ServerScript)) + '"?(\s|$)'
  return ([string]$ProcessInfo.CommandLine -match $scriptToken)
}

function Test-MortusNextServerChild($ProcessInfo, [string] $NodePath, [string] $ServerScript, [int] $ParentProcessId, [string] $ParentCreatedAt) {
  if (-not (Test-MortusNextServerChildImage $ProcessInfo $NodePath $ServerScript) -or [int]$ProcessInfo.ParentProcessId -ne $ParentProcessId) { return $false }
  $childCreatedAt = Get-MortusProcessCreatedAt $ProcessInfo
  if (-not $childCreatedAt -or -not $ParentCreatedAt) { return $false }
  try { return ([datetime]::Parse($childCreatedAt).ToUniversalTime() -gt [datetime]::Parse($ParentCreatedAt).ToUniversalTime()) } catch { return $false }
}

function Get-MortusProcessSnapshot {
  try { return @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop) } catch {
    throw "NÃ£o foi possÃ­vel consultar os processos do Windows; operaÃ§Ã£o interrompida sem tocar no banco."
  }
}

function Get-MortusTestProcessInventory([string] $NodePath, [string] $NextCli, [int] $Port, [string] $ServerScript) {
  try {
    $allProcesses = @(Get-MortusProcessSnapshot)
  } catch {
    throw "Não foi possível consultar os processos do Windows; operação interrompida sem tocar no banco."
  }
  @($allProcesses | Where-Object { (Test-MortusTestProcess $_ $NodePath $NextCli $Port) -or ($ServerScript -and (Test-MortusNextServerChildImage $_ $NodePath $ServerScript)) })
}

function Get-MortusProcessCreatedAt($ProcessInfo) {
  if (-not $ProcessInfo -or $null -eq $ProcessInfo.CreationDate) { return $null }
  try {
    $created = if ($ProcessInfo.CreationDate -is [string]) { [Management.ManagementDateTimeConverter]::ToDateTime([string]$ProcessInfo.CreationDate) } else { [datetime]$ProcessInfo.CreationDate }
    return $created.ToUniversalTime().ToString("o")
  } catch { return $null }
}

function Stop-MortusVerifiedTestProcess {
  param(
    [Parameter(Mandatory)]$ProcessInfo,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$NextCli,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$ExpectedCreatedAt,
    [ValidateSet("main", "server-child")][string]$Role = "main",
    [string]$ServerScript,
    [int]$ParentProcessId,
    [scriptblock]$Terminator
  )
  $targetPid = [int]$ProcessInfo.ProcessId
  $current = @(Get-MortusProcessById -ProcessId $targetPid)
  $identityMatches = if ($Role -eq "main") {
    $current.Count -eq 1 -and (Test-MortusTestProcess $current[0] $NodePath $NextCli $Port) -and (Get-MortusProcessCreatedAt $current[0]) -ceq $ExpectedCreatedAt
  } else {
    $current.Count -eq 1 -and (Test-MortusNextServerChild $current[0] $NodePath $ServerScript $ParentProcessId $ExpectedCreatedAt) -and (Get-MortusProcessCreatedAt $current[0]) -ceq (Get-MortusProcessCreatedAt $ProcessInfo)
  }
  if (-not $identityMatches -or (Get-MortusProcessCreatedAt $current[0]) -cne (Get-MortusProcessCreatedAt $ProcessInfo)) {
    throw "A identidade do processo mudou ou não pode ser comprovada; nenhum processo foi encerrado."
  }
  if ($Terminator) { & $Terminator $targetPid; return }
  $output = & taskkill.exe /PID $targetPid 2>&1
  if ($LASTEXITCODE -ne 0) { throw "O Windows não confirmou o encerramento do PID $targetPid. $($output -join ' ')" }
}

function Get-MortusProcessById([int] $ProcessId) {
  try {
    @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop)
  } catch {
    throw "Não foi possível confirmar o estado do PID $ProcessId; operação interrompida sem tocar no banco."
  }
}

function Test-MortusNoTcpListenersError($ErrorRecord) {
  if (-not $ErrorRecord -or $ErrorRecord.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) { return $false }
  return ([string]$ErrorRecord.FullyQualifiedErrorId -in @(
    "CmdletizationQuery_NotFound,Get-NetTCPConnection",
    "CmdletizationQuery_NotFound_LocalPort,Get-NetTCPConnection"
  ))
}

function Get-MortusPortTcpConnections([int] $Port) {
  try {
    return @(Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop)
  } catch {
    if (Test-MortusNoTcpListenersError $_) { return @() }
    throw "Não foi possível confirmar o estado da porta $Port; operação interrompida sem tocar no banco."
  }
}

function Get-MortusPortListeners([int] $Port) {
  $connections = @(Get-MortusPortTcpConnections -Port $Port)
  @($connections | Where-Object { [string]$_.State -eq "Listen" })
}

function Assert-MortusPortListenersOwned {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Listeners,
    [Parameter(Mandatory)][AllowEmptyCollection()][int[]]$VerifiedProcessIds
  )
  foreach ($listener in $Listeners) {
    if ($null -eq $listener.OwningProcess -or $VerifiedProcessIds -notcontains [int]$listener.OwningProcess) {
      throw "A porta está vinculada a outro processo ou não foi possível comprovar o proprietário. Manifesto preservado."
    }
  }
}

function Assert-MortusTestServerStopped {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]] $ProcessInventory,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]] $PortListeners
  )
  if ($null -eq $ProcessInventory -or $null -eq $PortListeners) {
    throw "Estado do servidor desconhecido; não é seguro continuar."
  }
  if ($ProcessInventory.Count -gt 0 -or $PortListeners.Count -gt 0) {
    throw "Servidor de teste ativo ou porta ocupada; pare o ambiente e confirme novamente."
  }
}

function Assert-MortusTestProcessRegistered([bool] $ManifestExists, [AllowEmptyCollection()][object[]] $ProcessInventory) {
  if ($null -eq $ProcessInventory) { throw "Não foi possível provar o registro do processo; operação interrompida." }
  if (-not $ManifestExists -and $ProcessInventory.Count -gt 0) {
    throw "Há um processo Next correspondente, mas não existe manifesto que prove ser esta instância. Nenhum processo foi encerrado."
  }
}

function ConvertTo-MortusTestManifestDictionary($Manifest) {
  $result = [ordered]@{}
  if ($Manifest -is [System.Collections.IDictionary]) {
    foreach ($key in $Manifest.Keys) { $result[[string]$key] = $Manifest[$key] }
    return $result
  }
  if ($Manifest -is [System.Management.Automation.PSCustomObject]) {
    foreach ($property in $Manifest.PSObject.Properties) {
      if ($property.MemberType -notin @("NoteProperty", "Property")) { continue }
      $result[[string]$property.Name] = $property.Value
    }
    if ($result.Count -gt 0) { return $result }
  }
  throw "Manifest must be a non-empty JSON object or dictionary."
}

function Read-MortusTestManifest([string] $ManifestPath) {
  Assert-MortusNoReparsePoints $ManifestPath
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { throw "Manifest file was not found." }
  try {
    $parsed = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    return ConvertTo-MortusTestManifestDictionary $parsed
  } catch {
    throw "Manifest JSON is invalid or has an unsupported root type."
  }
}

function Write-MortusTestManifest([string] $ManifestPath, $Manifest) {
  $normalizedManifest = ConvertTo-MortusTestManifestDictionary $Manifest
  Assert-MortusNoReparsePoints (Split-Path -Parent $ManifestPath)
  Assert-MortusNoReparsePoints $ManifestPath
  $temporaryPath = "$ManifestPath.$([guid]::NewGuid().ToString('N')).tmp"
  $json = $normalizedManifest | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
  try {
    Assert-MortusNoReparsePoints $ManifestPath
    if (Test-Path -LiteralPath $ManifestPath) {
      $backupPath = "$ManifestPath.$([guid]::NewGuid().ToString('N')).bak"
      [IO.File]::Replace($temporaryPath, $ManifestPath, $backupPath)
      if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath -Force }
    } else {
      [IO.File]::Move($temporaryPath, $ManifestPath)
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
  }
}

function Remove-MortusTestManifest([string] $ManifestPath) {
  Assert-MortusNoReparsePoints $ManifestPath
  if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) { Remove-Item -LiteralPath $ManifestPath -Force }
}

Export-ModuleMember -Function Get-MortusFullPath, Enter-MortusTestOperation, Exit-MortusTestOperation, Test-MortusReparseItem, Assert-MortusDatabaseIsolated, Assert-MortusNoReparsePoints, Assert-MortusTestPaths, Get-MortusNextArgumentList, Test-MortusTestProcess, Test-MortusNextServerChildImage, Test-MortusNextServerChild, Get-MortusProcessSnapshot, Get-MortusTestProcessInventory, Get-MortusProcessById, Get-MortusProcessCreatedAt, Stop-MortusVerifiedTestProcess, Test-MortusNoTcpListenersError, Get-MortusPortTcpConnections, Get-MortusPortListeners, Assert-MortusPortListenersOwned, Assert-MortusTestServerStopped, Assert-MortusTestProcessRegistered, ConvertTo-MortusTestManifestDictionary, Read-MortusTestManifest, Write-MortusTestManifest, Remove-MortusTestManifest
