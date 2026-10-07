param([string]$AIYOURoot=(Join-Path $env:LOCALAPPDATA 'Codex Sidebar Enhancer'),[string]$NodePath)
$ErrorActionPreference='Stop'
if(-not $NodePath){$n=Get-Command node -ErrorAction SilentlyContinue;if($n){$NodePath=$n.Source}else{$NodePath=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'}}
if(-not(Test-Path -LiteralPath $NodePath -PathType Leaf)){throw '找不到 Node.js，请使用 -NodePath 指定 node.exe。'}
$installer=Join-Path $AIYOURoot 'scripts/install-theme.mjs'
if(-not(Test-Path -LiteralPath $installer -PathType Leaf)){throw '请先安装 AIYOUcodex，或使用 -AIYOURoot 指定安装目录。'}
& $NodePath $installer --package $PSScriptRoot --dry-run;if($LASTEXITCODE -ne 0){throw '主题包检查失败，尚未安装。'}
& $NodePath $installer --package $PSScriptRoot;if($LASTEXITCODE -ne 0){throw '主题安装失败。'}
Write-Host '主题已安装。打开 Codex 主题面板选择主题并保存。'
