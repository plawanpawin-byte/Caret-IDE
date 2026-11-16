; Caret IDE installer (per-user, no administrator needed).
Unicode true
!include "MUI2.nsh"

!define NAME "Caret IDE"
!define EXE "Caret IDE.exe"
!define VERSION "0.8.0"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaretIDE"

Name "${NAME}"
OutFile "..\dist\Caret-IDE-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Caret IDE"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails nevershow

!define MUI_ICON "..\brand\icon.ico"
!define MUI_UNICON "..\brand\icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start Caret IDE"
; Always install into a folder called "Caret IDE", so uninstalling can never touch someone else's files.
Function DirLeave
  StrLen $0 "Caret IDE"
  StrCpy $1 $INSTDIR "" -$0
  StrCmp $1 "Caret IDE" +2
  StrCpy $INSTDIR "$INSTDIR\Caret IDE"
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

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\dist\Caret-IDE\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Caret"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"
  ; only our own folder is removed with everything inside; any other folder (older installs) loses just our files
  StrLen $0 "Caret IDE"
  StrCpy $1 $INSTDIR "" -$0
  StrCmp $1 "Caret IDE" 0 other
  RMDir /r "$INSTDIR"
  Goto done
  other:
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\Caret IDE.VisualElementsManifest.xml"
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
