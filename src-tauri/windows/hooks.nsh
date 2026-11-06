; Decargo — NSIS installer hooks (v3.43, IT review)
;
; Builds before 3.43 also claimed the generic .json file type for Decargo
; (per user: HKCU\Software\Classes\.json -> "json", class key
; HKCU\Software\Classes\json). 3.43 registers only .spica. When it is
; installed over an older build, give .json back to whatever owned it before
; (the installer kept that in the "json_backup" value) and remove our class
; key. Nothing is touched unless the .json class still points at Decargo.

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
    ReadRegStr $R3 HKCU "Software\Classes\.json" "json_backup"
    StrCmp $R3 "" 0 +3
      DeleteRegValue HKCU "Software\Classes\.json" ""
      Goto +2
      WriteRegStr HKCU "Software\Classes\.json" "" "$R3"
    DeleteRegValue HKCU "Software\Classes\.json" "json_backup"
    DeleteRegKey HKCU "Software\Classes\json"
    ; tell Explorer the file associations changed (SHCNE_ASSOCCHANGED)
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  decargo_json_done:
!macroend
