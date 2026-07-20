# ============================================================================
#  RSP — build an update bundle on your laptop (Windows / PowerShell).
#
#  Usage:   powershell -File deploy\make_update.ps1
#  Output:  D:\rsp_project_v2\rsp_update.tar.gz
#
#  Then:    scp "D:\rsp_project_v2\rsp_update.tar.gz" vmadmin@<VM_IP>:~/
#           ssh vmadmin@<VM_IP> "bash /opt/rsp/deploy/apply_update.sh"
#
#  Packs: the backend source (no venv, no __pycache__, no .env) and the freshly
#  built frontend. Small (~2-3 MB) — dependencies aren't re-shipped.
#  If requirements.txt changed you ALSO need a new wheels bundle (the VM can't
#  reach PyPI) — rebuild the full offline bundle in that case.
# ============================================================================
$ErrorActionPreference = "Stop"

$repo  = Split-Path $PSScriptRoot -Parent          # ...\rsp
$stage = Join-Path (Split-Path $repo -Parent) "_update_stage"
$out   = Join-Path (Split-Path $repo -Parent) "rsp_update.tar.gz"

Write-Host "==> Building frontend..." -ForegroundColor Cyan
Push-Location (Join-Path $repo "frontend")
$build = npm run build 2>&1 | Out-String
Pop-Location
if ($build -notmatch "built in") { Write-Host $build; throw "Frontend build failed." }
Write-Host "    build OK"

Write-Host "==> Staging files..." -ForegroundColor Cyan
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
robocopy (Join-Path $repo "backend") (Join-Path $stage "backend") /E `
    /XD venv __pycache__ .pytest_cache /XF *.pyc .env /NFL /NDL /NJH /NJS | Out-Null
robocopy (Join-Path $repo "frontend\dist") (Join-Path $stage "frontend_dist") /E `
    /NFL /NDL /NJH /NJS | Out-Null
# ship deploy/ too, so apply_update.sh + nginx configs stay current on the VM
robocopy (Join-Path $repo "deploy") (Join-Path $stage "deploy") /E `
    /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -le 7) { $global:LASTEXITCODE = 0 }   # robocopy: 0-7 are success

# shell scripts must have LF endings or Linux fails them ("bad interpreter ^M")
Get-ChildItem (Join-Path $stage "deploy") -Filter *.sh -Recurse | ForEach-Object {
    $t = [IO.File]::ReadAllText($_.FullName) -replace "`r`n", "`n"
    [IO.File]::WriteAllText($_.FullName, $t)
}

Write-Host "==> Packing $out ..." -ForegroundColor Cyan
if (Test-Path $out) { Remove-Item -Force $out }
tar -czf $out -C $stage .
Remove-Item -Recurse -Force $stage

$size = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Host ""
Write-Host "Bundle ready: $out  ($size MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "  scp `"$out`" vmadmin@<VM_IP>:~/"
Write-Host "  ssh vmadmin@<VM_IP> `"bash /opt/rsp/deploy/apply_update.sh`""
