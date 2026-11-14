; Caret IDE installer (per-user, no administrator needed).
Unicode true
!include "MUI2.nsh"

!define NAME "Caret IDE"
!define EXE "Caret IDE.exe"
!define VERSION "0.6.5"
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
  RMDir /r "$INSTDIR"
SectionEnd
