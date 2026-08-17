$ErrorActionPreference='SilentlyContinue'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'production\ziya-production-lib.ps1')
$cfg=Get-DotEnvMap -EnvPath (Join-Path $PSScriptRoot '.env')
$auraPort=Get-EnvIntValue -Map $cfg -Name 'AURA_PORT' -Default 4310 -Minimum 1
$crmPort=Get-EnvIntValue -Map $cfg -Name 'CRM_PORT' -Default 4311 -Minimum 1
$tonyRoot=Find-TonyProjectRoot -AuraRoot $PSScriptRoot -EnvMap $cfg
$aura=Test-AuraRunning -Port $auraPort
$crm=Test-CrmUiRunning -Port $crmPort
$tony=if($tonyRoot){Test-TonyRunning -TonyRoot $tonyRoot}else{$false}
$watch=Test-WatchdogRunning -AuraRoot $PSScriptRoot
$task=Get-ScheduledTask -TaskName 'Ziya Energy Aura Production Supervisor' -ErrorAction SilentlyContinue
Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ' ZIYA ENERGY PRODUCTION STATUS' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ("Aura Dashboard : {0}  :{1}" -f $(if($aura){'ONLINE'}else{'OFFLINE'}),$auraPort) -ForegroundColor $(if($aura){'Green'}else{'Red'})
Write-Host ("Ziya CRM       : {0}  :{1}" -f $(if($crm){'ONLINE'}else{'OFFLINE'}),$crmPort) -ForegroundColor $(if($crm){'Green'}else{'Red'})
Write-Host ("Tony           : {0}" -f $(if($tony){'ONLINE'}else{'OFFLINE'})) -ForegroundColor $(if($tony){'Green'}else{'Red'})
Write-Host ("Watchdog       : {0}" -f $(if($watch){'ONLINE'}else{'OFFLINE'})) -ForegroundColor $(if($watch){'Green'}else{'Yellow'})
Write-Host ("Auto-start     : {0}" -f $(if($task){$task.State}else{'NOT INSTALLED'})) -ForegroundColor $(if($task){'Green'}else{'Yellow'})
if($tonyRoot){Write-Host "Tony root      : $tonyRoot" -ForegroundColor DarkGray}
Write-Host ''
