param([int]$StartupDelaySeconds = 0)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'production\ziya-production-lib.ps1')
. (Join-Path $PSScriptRoot 'production\crm-production-lib.ps1')

$mutex = [System.Threading.Mutex]::new($false,'Local\ZiyaEnergyAuraProductionWatchdog')
$hasMutex = $false
try { $hasMutex = $mutex.WaitOne(0,$false) } catch {}
if (-not $hasMutex) { exit 0 }

try {
    if ($StartupDelaySeconds -gt 0) { Start-Sleep -Seconds $StartupDelaySeconds }

    $envPath = Join-Path $PSScriptRoot '.env'
    $cfg = Get-DotEnvMap -EnvPath $envPath
    $enabled = Get-EnvBoolValue -Map $cfg -Name 'PRODUCTION_WATCHDOG_ENABLED' -Default $true
    if (-not $enabled) { exit 0 }

    $port = Get-EnvIntValue -Map $cfg -Name 'AURA_PORT' -Default 4310 -Minimum 1
    $crmPort = Get-EnvIntValue -Map $cfg -Name 'CRM_PORT' -Default 4311 -Minimum 1
    $interval = [Math]::Max(15,(Get-EnvIntValue -Map $cfg -Name 'PRODUCTION_WATCHDOG_INTERVAL_SECONDS' -Default 30 -Minimum 15))
    $backupHours = [Math]::Max(1,(Get-EnvIntValue -Map $cfg -Name 'PRODUCTION_BACKUP_INTERVAL_HOURS' -Default 6 -Minimum 1))
    $retention = [Math]::Max(5,(Get-EnvIntValue -Map $cfg -Name 'PRODUCTION_BACKUP_RETENTION' -Default 30 -Minimum 5))
    $autoRestore = Get-EnvBoolValue -Map $cfg -Name 'PRODUCTION_AUTO_RESTORE_CORRUPT_DB' -Default $true
    $tonyAutostart = Get-EnvBoolValue -Map $cfg -Name 'PRODUCTION_TONY_AUTOSTART' -Default $true
    $db = Join-Path $PSScriptRoot 'data\aura.json'
    $crmDb = Join-Path $PSScriptRoot 'data\crm.json'
    $lastBackup = [datetime]::MinValue

    Write-ProductionLog -AuraRoot $PSScriptRoot -Message "Production watchdog online. Aura=:$port; CRM=:$crmPort; interval=${interval}s; backup=${backupHours}h; Tony autostart=$tonyAutostart."

    # Safe startup backup when the current state is valid.
    if (Test-JsonFileValid -Path $db) {
        try { $null = New-AuraStateBackup -AuraRoot $PSScriptRoot -Retention $retention -Reason 'startup'; $null = New-CrmStateBackup -AuraRoot $PSScriptRoot -Retention $retention -Reason 'startup'; $lastBackup = Get-Date } catch {}
    }

    while ($true) {
        try {
            # Refresh .env each cycle so safe production flags can be changed without rebuilding.
            $cfg = Get-DotEnvMap -EnvPath $envPath
            if (-not (Get-EnvBoolValue -Map $cfg -Name 'PRODUCTION_WATCHDOG_ENABLED' -Default $true)) {
                Write-ProductionLog -AuraRoot $PSScriptRoot -Message 'Watchdog disabled by configuration; exiting.'
                break
            }

            # State integrity check. Retry before declaring corruption to avoid reacting to a transient OneDrive/write window.
            if (Test-Path -LiteralPath $db -PathType Leaf) {
                $valid = $false
                for ($i=0; $i -lt 3; $i++) {
                    if (Test-JsonFileValid -Path $db) { $valid = $true; break }
                    Start-Sleep -Milliseconds 500
                }
                if (-not $valid) {
                    if ($autoRestore) {
                        try {
                            $used = Restore-AuraStateFromLatestBackup -AuraRoot $PSScriptRoot
                            Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message "Aura state corruption detected. Restored last valid backup: $used"
                        } catch {
                            Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message "Aura state corruption detected and automatic recovery failed: $($_.Exception.Message)"
                        }
                    } else {
                        Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message 'Aura state corruption detected. Automatic restore is disabled.'
                    }
                }
            }

            if (Test-Path -LiteralPath $crmDb -PathType Leaf) {
                $crmValid = $false
                for ($i=0; $i -lt 3; $i++) { if (Test-JsonFileValid -Path $crmDb) { $crmValid = $true; break }; Start-Sleep -Milliseconds 500 }
                if (-not $crmValid) {
                    if ($autoRestore) {
                        try { $usedCrm = Restore-CrmStateFromLatestBackup -AuraRoot $PSScriptRoot; Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message "CRM state corruption detected. Restored last valid backup: $usedCrm" }
                        catch { Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message "CRM state corruption detected and automatic recovery failed: $($_.Exception.Message)" }
                    } else { Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message 'CRM state corruption detected. Automatic restore is disabled.' }
                }
            }

            if (-not (Test-AuraRunning -Port $port)) {
                try {
                    $null = Start-AuraServerExternal -AuraRoot $PSScriptRoot -Port $port -Minimized
                    Write-ProductionLog -AuraRoot $PSScriptRoot -Level WARN -Message 'Aura was offline and was restarted by the production watchdog.'
                    Start-Sleep -Seconds 3
                } catch {
                    Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message "Aura restart failed: $($_.Exception.Message)"
                }
            }

            if (-not (Test-CrmUiRunning -Port $crmPort)) {
                try {
                    $null = Start-CrmUiExternal -AuraRoot $PSScriptRoot -Port $crmPort -Minimized
                    Write-ProductionLog -AuraRoot $PSScriptRoot -Level WARN -Message 'Ziya CRM UI was offline and was restarted by the production watchdog.'
                    Start-Sleep -Seconds 2
                } catch {
                    Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message "Ziya CRM restart failed: $($_.Exception.Message)"
                }
            }

            if ($tonyAutostart) {
                $tonyRoot = Find-TonyProjectRoot -AuraRoot $PSScriptRoot -EnvMap $cfg
                if ($tonyRoot -and -not (Test-TonyRunning -TonyRoot $tonyRoot)) {
                    try {
                        $null = Start-TonyExternal -TonyRoot $tonyRoot -Minimized
                        Write-ProductionLog -AuraRoot $PSScriptRoot -Level WARN -Message 'Tony was offline and was restarted externally by the production watchdog.'
                    } catch {
                        Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message "Tony restart failed: $($_.Exception.Message)"
                    }
                }
            }

            if ((Get-Date) - $lastBackup -ge [timespan]::FromHours($backupHours)) {
                try {
                    $target = New-AuraStateBackup -AuraRoot $PSScriptRoot -Retention $retention -Reason 'watchdog'
                    $crmTarget = New-CrmStateBackup -AuraRoot $PSScriptRoot -Retention $retention -Reason 'watchdog'
                    $lastBackup = Get-Date
                    Write-ProductionLog -AuraRoot $PSScriptRoot -Message "State backups created. Aura=$target; CRM=$crmTarget"
                } catch {
                    Write-ProductionLog -AuraRoot $PSScriptRoot -Level WARN -Message "Scheduled backup skipped/failed: $($_.Exception.Message)"
                }
            }
        } catch {
            Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message "Watchdog cycle error: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds $interval
    }
}
finally {
    if ($hasMutex) { try { $mutex.ReleaseMutex() } catch {} }
    $mutex.Dispose()
}
