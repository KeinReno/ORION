!macro NSIS_HOOK_PREINSTALL
  ; Tauri's regular process check follows this hook. Run it before probing
  ; the executable so the user can close a running instance first.
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  Push $0
  Push $1
  StrCpy $0 20
  orion_wait_for_executable:
    IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 orion_executable_ready
    ; OPEN_EXISTING with GENERIC_WRITE, without truncating the installed file.
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\${MAINBINARYNAME}.exe", i 0x40000000, i 7, p 0, i 3, i 0x80, p 0) p.r1'
    StrCmp $1 "-1" orion_executable_busy
    System::Call 'kernel32::CloseHandle(p r1)'
    Goto orion_executable_ready
  orion_executable_busy:
    IntOp $0 $0 - 1
    StrCmp $0 0 orion_executable_unavailable
    Sleep 250
    Goto orion_wait_for_executable
  orion_executable_unavailable:
    Pop $1
    Pop $0
    MessageBox MB_OK|MB_ICONSTOP "ORION Rust cannot write to $INSTDIR\${MAINBINARYNAME}.exe.$\r$\nClose ORION Rust and check that your account can modify this folder, then run setup again. No application files were replaced." /SD IDOK
    SetErrorLevel 1
    Abort
  orion_executable_ready:
    Pop $1
    Pop $0
!macroend
