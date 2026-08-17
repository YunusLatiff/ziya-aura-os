$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$envPath=Join-Path $PSScriptRoot '.env'
if(-not(Test-Path -LiteralPath $envPath)){New-Item -ItemType File -Path $envPath -Force | Out-Null}

function Set-EnvValue([string]$Name,[string]$Value){
    $lines=@(Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue)
    $escapedName=[regex]::Escape($Name)
    $replacement="$Name=`"$Value`""
    $found=$false
    $out=@()
    foreach($line in $lines){
        if($line -match "^\s*$escapedName\s*="){$out+=$replacement;$found=$true}else{$out+=$line}
    }
    if(-not $found){$out+=$replacement}
    Set-Content -LiteralPath $envPath -Value $out -Encoding UTF8
}

Set-EnvValue 'RESEARCH_DAILY_BATCHES_PER_AGENT' '3'
Set-EnvValue 'RESEARCH_DAILY_BATCH_TIMEZONE' 'Africa/Johannesburg'

Write-Host ''
Write-Host 'Aura OS v0.8.7 lead-flow settings saved.' -ForegroundColor Green
Write-Host 'Vision daily batches : 3 maximum' -ForegroundColor Cyan
Write-Host 'Peter daily batches  : 3 maximum' -ForegroundColor Cyan
Write-Host 'MJ daily batches     : 3 maximum' -ForegroundColor Cyan
Write-Host 'Friday               : streaming review per lead' -ForegroundColor Cyan
Write-Host 'Pepper               : receives approved leads immediately' -ForegroundColor Cyan
Write-Host 'Ultron               : commercial-focus QA, less stylistically strict' -ForegroundColor Cyan
Write-Host ''
Write-Host 'NOTE: The existing 60 approved leads/month per researcher remains a hard cap.' -ForegroundColor Yellow
