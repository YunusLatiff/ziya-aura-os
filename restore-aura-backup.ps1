param([switch]$Latest)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'production\ziya-production-lib.ps1')
if(-not $Latest){
    Write-Host 'This restores Aura state only. It does not touch Tony.' -ForegroundColor Yellow
    $answer=Read-Host 'Restore the latest valid Aura state backup? Type YES to continue'
    if($answer -cne 'YES'){Write-Host 'Restore cancelled.' -ForegroundColor Yellow;exit 0}
}
$used=Restore-AuraStateFromLatestBackup -AuraRoot $PSScriptRoot
Write-Host "Aura state restored from: $used" -ForegroundColor Green
