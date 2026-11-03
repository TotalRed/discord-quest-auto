Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
desktop = base & "\Discord Quest Auto.exe"
If fso.FileExists(desktop) Then
    shell.Run Chr(34) & desktop & Chr(34), 1, False
Else
    command = Chr(34) & base & "\runtime\node.exe" & Chr(34) & " " & Chr(34) & base & "\app\agent.mjs" & Chr(34) & " --ui"
    shell.Run command, 0, False
End If
