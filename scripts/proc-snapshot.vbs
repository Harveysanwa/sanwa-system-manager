' Sanwa系统管理器 · 进程快照（名称/路径/PID/内存），纯 cscript 调用 WMI，输出到临时文件
' 参数：WScript.Arguments(0)=输出文件路径
Option Explicit

Dim outFile, fso, wmi, col, p, f, line
If WScript.Arguments.Count < 1 Then WScript.Quit 2
outFile = WScript.Arguments(0)

Set fso = CreateObject("Scripting.FileSystemObject")
Set f = fso.CreateTextFile(outFile, True, False)

On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
If Err.Number <> 0 Then
  f.WriteLine("ERR|WMI|" & Err.Number)
  f.Close
  WScript.Quit 3
End If
Set col = wmi.ExecQuery("SELECT ProcessId,Name,ExecutablePath,WorkingSetSize FROM Win32_Process")
For Each p In col
  line = p.ProcessId & "|" & p.Name & "|" & p.ExecutablePath & "|" & p.WorkingSetSize
  f.WriteLine(line)
Next
f.Close
WScript.Quit 0
