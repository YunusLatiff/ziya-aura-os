function New-CrmStateBackup {
    param([Parameter(Mandatory=$true)][string]$AuraRoot,[int]$Retention=30,[string]$Reason='scheduled')
    $source=Join-Path $AuraRoot 'data\crm.json'
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { return $null }
    if (-not (Test-JsonFileValid -Path $source)) { throw "CRM state is not valid JSON; backup skipped: $source" }
    $backupDir=Join-Path $AuraRoot 'backups\crm-state'; New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $safeReason=[regex]::Replace($Reason,'[^A-Za-z0-9_-]','-'); $target=Join-Path $backupDir "crm-$stamp-$safeReason.json"
    Copy-Item -LiteralPath $source -Destination $target -Force
    if (-not (Test-JsonFileValid -Path $target)) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue; throw 'CRM backup verification failed.' }
    $files=@(Get-ChildItem -LiteralPath $backupDir -Filter 'crm-*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if ($Retention -gt 0 -and $files.Count -gt $Retention) { $files | Select-Object -Skip $Retention | Remove-Item -Force -ErrorAction SilentlyContinue }
    return $target
}
function Get-LatestValidCrmBackup {
    param([Parameter(Mandatory=$true)][string]$AuraRoot)
    $backupDir=Join-Path $AuraRoot 'backups\crm-state'; if (-not (Test-Path -LiteralPath $backupDir -PathType Container)) { return $null }
    foreach($f in @(Get-ChildItem -LiteralPath $backupDir -Filter 'crm-*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)){ if(Test-JsonFileValid -Path $f.FullName){return $f.FullName} }
    return $null
}
function Restore-CrmStateFromLatestBackup {
    param([Parameter(Mandatory=$true)][string]$AuraRoot)
    $db=Join-Path $AuraRoot 'data\crm.json'; $latest=Get-LatestValidCrmBackup -AuraRoot $AuraRoot; if(-not $latest){throw 'No valid CRM backup is available.'}
    $corruptDir=Join-Path $AuraRoot 'backups\corrupt-crm'; New-Item -ItemType Directory -Path $corruptDir -Force | Out-Null
    if(Test-Path -LiteralPath $db){$stamp=Get-Date -Format 'yyyyMMdd-HHmmss';Copy-Item -LiteralPath $db -Destination (Join-Path $corruptDir "crm-corrupt-$stamp.json") -Force -ErrorAction SilentlyContinue}
    Copy-Item -LiteralPath $latest -Destination $db -Force; if(-not(Test-JsonFileValid -Path $db)){throw 'Restored CRM state did not pass JSON validation.'}; return $latest
}
