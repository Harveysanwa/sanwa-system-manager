' Sanwa系统管理器 · 开机自启快捷方式创建助手（ASCII only, 由 server.js 通过 cscript 调用）
' 参数：WScript.Arguments(0)=lnk 路径, (1)=powershell 路径, (2)=start-hub.ps1 路径, (3)=工作目录, (4)=描述
Option Explicit

Dim shell, lnkPath, target, scriptPath, workDir, desc, argsStr, lnk, fso
If WScript.Arguments.Count < 4 Then WScript.Quit 2

lnkPath = WScript.Arguments(0)
target = WScript.Arguments(1)
scriptPath = WScript.Arguments(2)
workDir = WScript.Arguments(3)
desc = ""
If WScript.Arguments.Count >= 5 Then desc = WScript.Arguments(4)

argsStr = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """ -NoOpen"

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set lnk = shell.CreateShortcut(lnkPath)
lnk.TargetPath = target
lnk.Arguments = argsStr
lnk.WorkingDirectory = workDir
lnk.WindowStyle = 7
lnk.Description = desc
lnk.IconLocation = target & ",0"
lnk.Save

If fso.FileExists(lnkPath) Then
  WScript.Quit 0
Else
  WScript.Quit 1
End If
