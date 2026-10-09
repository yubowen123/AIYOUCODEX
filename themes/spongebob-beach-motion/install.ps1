param(
  [string]$AIYOURoot=(Join-Path $env:LOCALAPPDATA 'Codex Sidebar Enhancer'),
  [string]$NodePath,
  [switch]$DryRun
)
$ErrorActionPreference='Stop'
if(-not $NodePath){
  $AIYOUThemeNodeCommand=Get-Command node -ErrorAction SilentlyContinue
  if($AIYOUThemeNodeCommand){$NodePath=$AIYOUThemeNodeCommand.Source}
  else{
    foreach($AIYOUThemeCandidate in @(
      (Join-Path $AIYOURoot 'runtime/node/node.exe'),
      (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')
    )){if(Test-Path -LiteralPath $AIYOUThemeCandidate -PathType Leaf){$NodePath=$AIYOUThemeCandidate;break}}
  }
}
if(-not $NodePath -or -not(Test-Path -LiteralPath $NodePath -PathType Leaf)){throw '找不到 Node.js 22.5+，请用 -NodePath 指定 node.exe。'}
$AIYOUThemeArguments=@((Join-Path $PSScriptRoot 'install.mjs'),'--root',$AIYOURoot)
if($DryRun){$AIYOUThemeArguments+='--dry-run'}
& $NodePath @AIYOUThemeArguments
if($LASTEXITCODE -ne 0){throw '主题检查 / 安装失败，请根据上方错误修正目录或版本。'}
