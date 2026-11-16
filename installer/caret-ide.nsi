; CaretStudio installer (per-user, no administrator needed).
Unicode true
!include "MUI2.nsh"

!define NAME "CaretStudio"
!define EXE "CaretStudio.exe"
!define VERSION "0.9.0"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaretStudio"
!define OLD_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaretIDE"

Name "${NAME}"
!ifdef TEST
  ; test build: installs into a temp folder and touches no shortcuts, registry, old install or user data
  OutFile "..\dist\test\CaretStudio-Setup-9.9.9.exe"
  InstallDir "$TEMP\cs-test\CaretStudio"
!else
  OutFile "..\dist\CaretStudio-Setup-${VERSION}.exe"
  InstallDir "$LOCALAPPDATA\Programs\CaretStudio"
!endif
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails nevershow

!define MUI_ICON "..\brand\icon.ico"
!define MUI_UNICON "..\brand\icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start CaretStudio"
; Always install into a folder called "CaretStudio", so uninstalling can never touch someone else's files.
Function DirLeave
  StrLen $0 "CaretStudio"
  StrCpy $1 $INSTDIR "" -$0
  StrCmp $1 "CaretStudio" +2
  StrCpy $INSTDIR "$INSTDIR\CaretStudio"
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${NAME}"
VIAddVersionKey "FileDescription" "${NAME} setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Caret"


; Wait (up to 2 minutes) until CaretStudio is closed, so its files can be replaced.
Function WaitForApp
  StrCpy $R0 0
  loop:
    ; full paths, so a "find" or "tasklist" earlier in PATH (Git for Windows has its own) cannot be picked by mistake
    nsExec::ExecToStack '"$SYSDIR\cmd.exe" /c ""$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${EXE}" /NH | "$SYSDIR\find.exe" /I "${EXE}""'
    Pop $0
    Pop $1
    StrCmp $0 "0" 0 done
    IntOp $R0 $R0 + 1
    IntCmp $R0 90 done
    Sleep 500
    Goto loop
  done:
FunctionEnd

; The app used to be called "Caret IDE": take that install away (its shortcuts and files); the user's data is kept.
Function RemoveOld
  ReadRegStr $0 HKCU "${OLD_KEY}" "UninstallString"
  StrCmp $0 "" gone
  ExecWait '$0 /S _?=$LOCALAPPDATA\Programs\Caret IDE'
  Delete "$LOCALAPPDATA\Programs\Caret IDE\Uninstall.exe"
  RMDir "$LOCALAPPDATA\Programs\Caret IDE"
  DeleteRegKey HKCU "${OLD_KEY}"
  gone:
FunctionEnd

; Chats and settings of "Caret IDE" move to CaretStudio the first time (only when CaretStudio has none yet).
Function KeepOldData
  IfFileExists "$APPDATA\CaretStudio\*.*" done
  IfFileExists "$APPDATA\Caret IDE\*.*" 0 done
  CreateDirectory "$APPDATA\CaretStudio"
  CopyFiles /SILENT "$APPDATA\Caret IDE\*.*" "$APPDATA\CaretStudio"
  done:
FunctionEnd

Section "Install"
  Call WaitForApp
!ifndef TEST
  Call RemoveOld
  Call KeepOldData
!endif
  SetOutPath "$INSTDIR"
!ifdef SMALL
  File /r "..\dist\small\*.*"   ; installer logic test with a tiny stand-in app
!else
  File /r "..\dist\CaretStudio\*.*"
!endif
  WriteUninstaller "$INSTDIR\Uninstall.exe"
!ifndef TEST
  CreateShortcut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Caret"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
!endif
  ; an update started from inside the app (silent): open the app again
  IfSilent 0 +2
!ifdef TEST
  Exec '"$INSTDIR\${EXE}" --user-data-dir=$TEMP\cs-test-ud'
  FileOpen $0 "$TEMP\cs-test-ran.txt" w   ; marker for the test: the "start the app again" step was reached
  FileClose $0
!else
  Exec '"$INSTDIR\${EXE}"'
!endif
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"
  ; only our own folder is removed with everything inside; any other folder (older installs) loses just our files
  StrLen $0 "CaretStudio"
  StrCpy $1 $INSTDIR "" -$0
  StrCmp $1 "CaretStudio" 0 other
  RMDir /r "$INSTDIR"
  Goto done
  other:
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\CaretStudio.VisualElementsManifest.xml"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.html"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\policies"
  RMDir "$INSTDIR"
  done:
SectionEnd
