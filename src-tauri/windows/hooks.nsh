; Decargo — NSIS installer hooks (v3.43, IT review)
;
; Builds before 3.43 also claimed the generic .json file type for Decargo
; (per user: HKCU\Software\Classes\.json -> "json", class key
; HKCU\Software\Classes\json). 3.43 registers only .spica. When it is
; installed over an older build, remove Decargo's .json association (our
; per-user default and class key), so .json opens with the program Windows
; would use without Decargo. A genuine earlier owner kept in "json_backup" is
; put back. Nothing is touched unless the .json class still points at Decargo.

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R0 HKCU "Software\Classes\.json" ""
  StrCmp $R0 "json" 0 decargo_json_done
  ReadRegStr $R1 HKCU "Software\Classes\json\shell\open\command" ""
  ReadRegStr $R2 HKCU "Software\Classes\json" ""
  StrCmp $R1 "$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\"" decargo_json_ours
  StrCmp $R2 "Decargo Project (JSON)" decargo_json_ours
  StrCmp $R2 "SPICA TIDE Project (JSON)" decargo_json_ours
  StrCmp $R2 "SPICA TIDE Project" decargo_json_ours
  Goto decargo_json_done
  decargo_json_ours:
    ; every earlier install/update overwrote json_backup with our own "json",
    ; so in practice there is nothing to restore: drop the per-user default
    ; and Windows uses the program chosen for .json system-wide again
    ReadRegStr $R3 HKCU "Software\Classes\.json" "json_backup"
    StrCmp $R3 "" decargo_json_clear
    StrCmp $R3 "json" decargo_json_clear
      WriteRegStr HKCU "Software\Classes\.json" "" "$R3"
      Goto decargo_json_backup
    decargo_json_clear:
      DeleteRegValue HKCU "Software\Classes\.json" ""
    decargo_json_backup:
    DeleteRegValue HKCU "Software\Classes\.json" "json_backup"
    DeleteRegKey HKCU "Software\Classes\json"
    ; tell Explorer the file associations changed (SHCNE_ASSOCCHANGED)
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  decargo_json_done:
!macroend
