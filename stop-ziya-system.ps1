param([switch]$KeepTony)
$ErrorActionPreference='SilentlyContinue'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'production\ziya-production-lib.ps1')
$cfg=Get-DotEnvMap -EnvPath (Join-Path $PSScriptRoot '.env')
$auraPort=Get-EnvIntValue -Map $cfg -Name 'AURA_PORT' -Default 4310 -Minimum 1
$crmPort=Get-EnvIntValue -Map $cfg -Name 'CRM_PORT' -Default 4311 -Minimum 1

foreach($p in Get-WatchdogProcesses -AuraRoot $PSScriptRoot){Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue;Write-Host "[STOPPED] Watchdog $($p.ProcessId)" -ForegroundColor Green}

foreach($c in @(Get-NetTCPConnection -LocalPort $crmPort -State Listen -ErrorAction SilentlyContinue)){
    if($c.OwningProcess){Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue;Write-Host "[STOPPED] CRM $($c.OwningProcess)" -ForegroundColor Green}
}
foreach($c in @(Get-NetTCPConnection -LocalPort $auraPort -State Listen -ErrorAction SilentlyContinue)){
    if($c.OwningProcess){Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue;Write-Host "[STOPPED] Aura $($c.OwningProcess)" -ForegroundColor Green}
}

if(-not $KeepTony){
    $tonyRoot=Find-TonyProjectRoot -AuraRoot $PSScriptRoot -EnvMap $cfg
    if($tonyRoot){foreach($p in Get-TonyProcesses -TonyRoot $tonyRoot){Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue;Write-Host "[STOPPED] Tony-related process $($p.ProcessId)" -ForegroundColor Green}}
}
Write-Host 'Intentional shutdown complete. The Windows logon task will start the network again at the next logon unless uninstalled.' -ForegroundColor Cyan
