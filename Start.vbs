Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
command = Chr(34) & base & "\runtime\node.exe" & Chr(34) & " " & Chr(34) & base & "\app\agent.mjs" & Chr(34) & " --ui"
shell.Run command, 0, False
