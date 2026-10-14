param([string]$AIYOURoot=(Join-Path $env:LOCALAPPDATA 'Codex Sidebar Enhancer'),[string]$NodePath,[switch]$DryRun)
$ErrorActionPreference='Stop'
if(-not $NodePath){$n=Get-Command node -ErrorAction SilentlyContinue;if($n){$NodePath=$n.Source}else{$NodePath=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'}}
if(-not(Test-Path -LiteralPath $NodePath -PathType Leaf)){throw '找不到 Node.js，请用 -NodePath 指定 node.exe。'}
$argsForTheme=@((Join-Path $PSScriptRoot 'install.mjs'),'--root',$AIYOURoot)
if($DryRun){$argsForTheme+='--dry-run'}
& $NodePath @argsForTheme
if($LASTEXITCODE -ne 0){throw '主题检查或安装失败，请根据上方错误修正。'}
