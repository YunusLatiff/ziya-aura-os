Set-StrictMode -Version 3.0

function Get-DotEnvMap {
    param([Parameter(Mandatory=$true)][string]$EnvPath)
    $map = @{}
    if (-not (Test-Path -LiteralPath $EnvPath)) { return $map }
    foreach ($raw in Get-Content -LiteralPath $EnvPath -ErrorAction SilentlyContinue) {
        $line = [string]$raw
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $trim = $line.Trim()
        if ($trim.StartsWith('#')) { continue }
        $i = $trim.IndexOf('=')
        if ($i -lt 1) { continue }
        $name = $trim.Substring(0,$i).Trim()
        $value = $trim.Substring($i+1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            if ($value.Length -ge 2) { $value = $value.Substring(1,$value.Length-2) }
        } else {
            $value = [regex]::Replace($value,'\s+#.*$','')
        }
        $map[$name] = $value
    }
    return $map
}

function Get-EnvBoolValue {
    param(
        [hashtable]$Map,
        [string]$Name,
        [bool]$Default = $false
    )
    if (-not $Map.ContainsKey($Name)) { return $Default }
    return @('1','true','yes','on','enabled') -contains ([string]$Map[$Name]).Trim().ToLowerInvariant()
}

function Get-EnvIntValue {
    param(
        [hashtable]$Map,
        [string]$Name,
        [int]$Default,
        [int]$Minimum = 0
    )
    if (-not $Map.ContainsKey($Name)) { return $Default }
    $n = 0
    if ([int]::TryParse(([string]$Map[$Name]).Trim(), [ref]$n) -and $n -ge $Minimum) { return $n }
    return $Default
}

function Get-AgentsRoot {
    param([string]$StartPath = $PSScriptRoot)
    $current = [System.IO.DirectoryInfo]::new((Resolve-Path -LiteralPath $StartPath).Path)
    for ($i=0; $i -lt 12 -and $null -ne $current; $i++) {
        if ($current.Name -ieq 'Agents') { return $current.FullName }
        $current = $current.Parent
    }
    return $null
}

function Test-TonyProjectRoot {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
    $pkg = Join-Path $Path 'package.json'
    $start = Join-Path $Path 'start-tony.ps1'
    if (-not (Test-Path -LiteralPath $start -PathType Leaf)) { return $false }
    if (Test-Path -LiteralPath $pkg -PathType Leaf) {
        try {
            $json = Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json
            if ($json.name -eq 'tony-ziya-assessment-agent') { return $true }
        } catch {}
    }
    return (Test-Path -LiteralPath (Join-Path $Path 'src\index.ts') -PathType Leaf)
}

function Find-TonyProjectRoot {
    param(
        [string]$AuraRoot,
        [hashtable]$EnvMap
    )
    if ($null -eq $EnvMap) { $EnvMap = @{} }
    $explicit = $null
    foreach ($name in @('PRODUCTION_TONY_ROOT','TONY_MONITOR_ROOT')) {
        if ($EnvMap.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$EnvMap[$name])) {
            $explicit = ([string]$EnvMap[$name]).Trim('"',"'")
            break
        }
    }
    if ($explicit) {
        if (Test-TonyProjectRoot $explicit) { return (Resolve-Path -LiteralPath $explicit).Path }
        $candidate = Get-ChildItem -LiteralPath $explicit -Filter 'start-tony.ps1' -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { Test-TonyProjectRoot $_.DirectoryName } |
            Select-Object -First 1
        if ($candidate) { return $candidate.DirectoryName }
    }

    $agentsRoot = Get-AgentsRoot -StartPath $AuraRoot
    if (-not $agentsRoot) { return $null }
    $candidate = Get-ChildItem -LiteralPath $agentsRoot -Filter 'start-tony.ps1' -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'Tony-Ziya-Assessment-Agent' -and (Test-TonyProjectRoot $_.DirectoryName) } |
        Select-Object -First 1
    if ($candidate) { return $candidate.DirectoryName }
    return $null
}

function Test-AuraRunning {
    param([int]$Port = 4310)
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
    } catch { return $false }
}

function Get-TonyProcesses {
    param([string]$TonyRoot)
    if ([string]::IsNullOrWhiteSpace($TonyRoot)) { return @() }
    $escapedRoot = [regex]::Escape($TonyRoot)
    $leaf = [regex]::Escape((Split-Path -Leaf $TonyRoot))
    try {
        return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and
            $_.Name -match '^(node|powershell|pwsh)(\.exe)?$' -and
            ($_.CommandLine -match $escapedRoot -or $_.CommandLine -match $leaf) -and
            ($_.CommandLine -match 'start-tony\.ps1|src[\\/]index\.ts|tsx')
        })
    } catch { return @() }
}

function Test-TonyRunning {
    param([string]$TonyRoot)
    return @(Get-TonyProcesses -TonyRoot $TonyRoot).Count -gt 0
}

function Start-TonyExternal {
    param(
        [Parameter(Mandatory=$true)][string]$TonyRoot,
        [switch]$Minimized
    )
    if (Test-TonyRunning -TonyRoot $TonyRoot) {
        return [pscustomobject]@{ Started=$false; AlreadyRunning=$true; ProjectRoot=$TonyRoot }
    }
    $script = Join-Path $TonyRoot 'start-tony.ps1'
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw "Tony start script not found: $script" }
    $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $script))
    $params = @{
        FilePath = 'powershell.exe'
        ArgumentList = $args
        WorkingDirectory = $TonyRoot
        PassThru = $true
    }
    if ($Minimized) { $params.WindowStyle = 'Minimized' }
    $p = Start-Process @params
    return [pscustomobject]@{ Started=$true; AlreadyRunning=$false; ProjectRoot=$TonyRoot; ProcessId=$p.Id }
}

function Start-AuraServerExternal {
    param(
        [Parameter(Mandatory=$true)][string]$AuraRoot,
        [int]$Port = 4310,
        [switch]$Minimized
    )
    if (Test-AuraRunning -Port $Port) {
        return [pscustomobject]@{ Started=$false; AlreadyRunning=$true; Port=$Port }
    }
    $server = Join-Path $AuraRoot 'src\server.mjs'
    if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw "Aura server not found: $server" }
    $escaped = $AuraRoot.Replace("'","''")
    $command = "Set-Location -LiteralPath '$escaped'; node src/server.mjs"
    $args = @('-NoProfile','-Command',$command)
    $params = @{
        FilePath = 'powershell.exe'
        ArgumentList = $args
        WorkingDirectory = $AuraRoot
        PassThru = $true
    }
    if ($Minimized) { $params.WindowStyle = 'Minimized' }
    $p = Start-Process @params
    return [pscustomobject]@{ Started=$true; AlreadyRunning=$false; Port=$Port; ProcessId=$p.Id }
}

function Test-CrmUiRunning {
    param([int]$Port = 4311)
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
    } catch { return $false }
}

function Start-CrmUiExternal {
    param(
        [Parameter(Mandatory=$true)][string]$AuraRoot,
        [int]$Port = 4311,
        [switch]$Minimized
    )
    if (Test-CrmUiRunning -Port $Port) {
        return [pscustomobject]@{ Started=$false; AlreadyRunning=$true; Port=$Port }
    }
    $server = Join-Path $AuraRoot 'src\crm-ui-server.mjs'
    if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw "CRM UI server not found: $server" }
    $escaped = $AuraRoot.Replace("'","''")
    $command = "Set-Location -LiteralPath '$escaped'; node src/crm-ui-server.mjs"
    $args = @('-NoProfile','-Command',$command)
    $params = @{
        FilePath = 'powershell.exe'
        ArgumentList = $args
        WorkingDirectory = $AuraRoot
        PassThru = $true
    }
    if ($Minimized) { $params.WindowStyle = 'Minimized' }
    $p = Start-Process @params
    return [pscustomobject]@{ Started=$true; AlreadyRunning=$false; Port=$Port; ProcessId=$p.Id }
}

function Get-WatchdogProcesses {
    param([string]$AuraRoot)
    $escaped = [regex]::Escape((Join-Path $AuraRoot 'ziya-watchdog.ps1'))
    try {
        return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and $_.CommandLine -match $escaped -and $_.Name -match '^(powershell|pwsh)(\.exe)?$'
        })
    } catch { return @() }
}

function Test-WatchdogRunning {
    param([string]$AuraRoot)
    return @(Get-WatchdogProcesses -AuraRoot $AuraRoot).Count -gt 0
}

function Start-WatchdogExternal {
    param(
        [Parameter(Mandatory=$true)][string]$AuraRoot,
        [int]$StartupDelaySeconds = 0,
        [switch]$Hidden
    )
    if (Test-WatchdogRunning -AuraRoot $AuraRoot) {
        return [pscustomobject]@{ Started=$false; AlreadyRunning=$true }
    }
    $script = Join-Path $AuraRoot 'ziya-watchdog.ps1'
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw "Watchdog script not found: $script" }
    $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $script),'-StartupDelaySeconds',[string]$StartupDelaySeconds)
    $params = @{ FilePath='powershell.exe'; ArgumentList=$args; WorkingDirectory=$AuraRoot; PassThru=$true }
    if ($Hidden) { $params.WindowStyle = 'Hidden' } else { $params.WindowStyle = 'Minimized' }
    $p = Start-Process @params
    return [pscustomobject]@{ Started=$true; AlreadyRunning=$false; ProcessId=$p.Id }
}

function Test-JsonFileValid {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $null = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        return $true
    } catch { return $false }
}

function New-AuraStateBackup {
    param(
        [Parameter(Mandatory=$true)][string]$AuraRoot,
        [int]$Retention = 30,
        [string]$Reason = 'scheduled'
    )
    $source = Join-Path $AuraRoot 'data\aura.json'
    if (-not (Test-JsonFileValid -Path $source)) { throw "Aura state is not valid JSON; backup skipped: $source" }
    $backupDir = Join-Path $AuraRoot 'backups\aura-state'
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $safeReason = [regex]::Replace($Reason,'[^A-Za-z0-9_-]','-')
    $target = Join-Path $backupDir "aura-$stamp-$safeReason.json"
    Copy-Item -LiteralPath $source -Destination $target -Force
    if (-not (Test-JsonFileValid -Path $target)) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue; throw 'Backup verification failed.' }
    $files = @(Get-ChildItem -LiteralPath $backupDir -Filter 'aura-*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if ($Retention -gt 0 -and $files.Count -gt $Retention) {
        $files | Select-Object -Skip $Retention | Remove-Item -Force -ErrorAction SilentlyContinue
    }
    return $target
}

function Get-LatestValidAuraBackup {
    param([Parameter(Mandatory=$true)][string]$AuraRoot)
    $backupDir = Join-Path $AuraRoot 'backups\aura-state'
    if (-not (Test-Path -LiteralPath $backupDir -PathType Container)) { return $null }
    foreach ($f in @(Get-ChildItem -LiteralPath $backupDir -Filter 'aura-*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
        if (Test-JsonFileValid -Path $f.FullName) { return $f.FullName }
    }
    return $null
}

function Restore-AuraStateFromLatestBackup {
    param([Parameter(Mandatory=$true)][string]$AuraRoot)
    $db = Join-Path $AuraRoot 'data\aura.json'
    $latest = Get-LatestValidAuraBackup -AuraRoot $AuraRoot
    if (-not $latest) { throw 'No valid Aura state backup is available.' }
    $corruptDir = Join-Path $AuraRoot 'backups\corrupt-state'
    New-Item -ItemType Directory -Path $corruptDir -Force | Out-Null
    if (Test-Path -LiteralPath $db) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        Copy-Item -LiteralPath $db -Destination (Join-Path $corruptDir "aura-corrupt-$stamp.json") -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -LiteralPath $latest -Destination $db -Force
    if (-not (Test-JsonFileValid -Path $db)) { throw 'Restored Aura state did not pass JSON validation.' }
    return $latest
}

function Write-ProductionLog {
    param(
        [Parameter(Mandatory=$true)][string]$AuraRoot,
        [Parameter(Mandatory=$true)][string]$Message,
        [ValidateSet('INFO','WARN','ERROR')][string]$Level='INFO'
    )
    $logDir = Join-Path $AuraRoot 'logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),$Level,$Message
    Add-Content -LiteralPath (Join-Path $logDir 'production-supervisor.log') -Value $line -Encoding UTF8
}
