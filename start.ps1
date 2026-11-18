$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    Write-Host '首次啟動：建立 Python 環境並安裝必要套件。'
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw '需要 Python 3.11 或以上版本。' }
}
& $python -c 'import fastapi, uvicorn, lxml, httpx' 2>$null
if ($LASTEXITCODE -ne 0) {
    & $python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw '套件安裝失敗，請確認網路後再試。' }
}
Write-Host 'PoW：http://127.0.0.1:8765。按 Ctrl+C 停止；關閉服務後文件與金鑰會從記憶體清除。'
& $python -m pow_app
