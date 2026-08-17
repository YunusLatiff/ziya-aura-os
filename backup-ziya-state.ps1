param([string]$Reason='manual')
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'production\ziya-production-lib.ps1')
. (Join-Path $PSScriptRoot 'production\crm-production-lib.ps1')
$cfg=Get-DotEnvMap -EnvPath (Join-Path $PSScriptRoot '.env')
$retention=[Math]::Max(5,(Get-EnvIntValue -Map $cfg -Name 'PRODUCTION_BACKUP_RETENTION' -Default 30 -Minimum 5))
$aura=New-AuraStateBackup -AuraRoot $PSScriptRoot -Retention $retention -Reason $Reason
$crm=New-CrmStateBackup -AuraRoot $PSScriptRoot -Retention $retention -Reason $Reason
Write-Host "Aura backup: $aura" -ForegroundColor Green
Write-Host "CRM backup : $crm" -ForegroundColor Green
